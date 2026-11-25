/**
 * Returns one company's books to zero so it can be handed over clean on its
 * go-live day.
 *
 * Demo documents are DELETED, not reversed. The no-hard-deletion rule protects
 * real financial history; demo documents are test fixtures. If they were only
 * reversed, the client's live ledgers would open with test entries and their
 * reversals in them, and their first real invoice would be numbered twenty-one
 * instead of one. That is not a clean handover.
 *
 * Two guards make that safe, and neither can be argued away:
 *   - it refuses to run against anything but a development or test database;
 *   - it refuses once that company's books have been declared open.
 *
 * What survives is everything a brand-new company would already have: its
 * users, roles, chart of accounts, outlets, journals, number series, taxes,
 * posting settings and approval rules. Audit logs are append-only by design and
 * are kept, so the fact that demo data once existed stays on the record.
 *
 * Usage: npm run reset:company -- --company PLFE --confirm PLFE
 */
import {Prisma} from "@prisma/client";
import {db} from "../lib/db";
import {AppError} from "../lib/errors";

const argument=(name:string)=>{
  const index=process.argv.indexOf(`--${name}`);
  return index>=0?(process.argv[index+1]??"").trim():"";
};

/** Only a development or test database. Never anything else, for any reason. */
function assertDisposableDatabase() {
  if(process.env.NODE_ENV==="production")
    throw new AppError(403,"This resets a company's books and never runs in production");
  const url=process.env.PLFE_DATABASE_URL||process.env.DATABASE_URL;
  if(!url)throw new AppError(500,"No database is configured");
  const name=new URL(url).pathname.replace(/^\//,"");
  const disposable=/_(test|dev)$/.test(name)||process.env.NODE_ENV==="development";
  if(!disposable)
    throw new AppError(403,`Refusing to reset books in "${name}". Point DATABASE_URL at a database ending in _test or _dev, or set NODE_ENV=development`);
  return {name,reason:/_(test|dev)$/.test(name)?`the database name "${name}" marks it disposable`:"NODE_ENV is development"};
}

// Every table the reset empties, in the order foreign keys allow.
const GUARDED=["companies","accounts","parties","journal_entries","journal_lines","invoices","invoice_lines",
  "bills","bill_lines","payments","payment_allocations","cash_counts","intercompany_transfers",
  "opening_records","opening_reviews","opening_staged_amounts","import_previews","attachments","approvals"];

async function main() {
  const code=argument("company"),confirm=argument("confirm");
  if(!code)throw new AppError(400,"Name the company: --company PLFE --confirm PLFE");
  if(code!==confirm)throw new AppError(400,"Type the same company code twice to confirm: --company PLFE --confirm PLFE");
  const database=assertDisposableDatabase();
  const company=await db.company.findFirst({where:{code:{equals:code,mode:"insensitive"},deletedAt:null}});
  if(!company)throw new AppError(404,`No company with code ${code}`);
  if(company.booksOpenedAt)
    throw new AppError(409,`${company.name} declared its books open on ${company.booksOpenedAt.toISOString().slice(0,10)}. Its history is real and is never deleted`);

  const id=company.id;
  const removed=await db.$transaction(async tx=>{
    // The protective triggers exist to stop anybody editing posted history. This
    // maintenance path removes fixtures wholesale, so they are lifted for the
    // length of this transaction only and restored before it commits.
    for(const table of GUARDED)await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    const counted:Record<string,number>={};
    const run=async(label:string,fn:()=>Promise<{count:number}>)=>{counted[label]=(counted[label]??0)+(await fn()).count;};

    await run("payment allocations",()=>tx.paymentAllocation.deleteMany({where:{companyId:id}}));
    await run("cash counts",()=>tx.cashCount.deleteMany({where:{companyId:id}}));
    await run("intercompany movements",()=>tx.intercompanyTransfer.deleteMany({
      where:{OR:[{companyId:id},{counterpartyCompanyId:id}]}}));
    await run("opening staged amounts",()=>tx.openingStagedAmount.deleteMany({where:{companyId:id}}));
    await run("opening reviews",()=>tx.openingReview.deleteMany({where:{companyId:id}}));
    await run("opening records",()=>tx.openingRecord.deleteMany({where:{companyId:id}}));
    await run("import previews",()=>tx.importPreview.deleteMany({where:{companyId:id}}));
    await run("invoice lines",()=>tx.invoiceLine.deleteMany({where:{companyId:id}}));
    await run("bill lines",()=>tx.billLine.deleteMany({where:{companyId:id}}));
    // Credit and debit notes point at their original, so they go first.
    await run("invoices",()=>tx.invoice.deleteMany({where:{companyId:id,kind:{not:"INVOICE"}}}));
    await run("invoices",()=>tx.invoice.deleteMany({where:{companyId:id}}));
    await run("bills",()=>tx.bill.deleteMany({where:{companyId:id,kind:{not:"BILL"}}}));
    await run("bills",()=>tx.bill.deleteMany({where:{companyId:id}}));
    await run("payments",()=>tx.payment.deleteMany({where:{companyId:id}}));
    await run("journal lines",()=>tx.journalLine.deleteMany({where:{companyId:id}}));
    await run("parties",()=>tx.party.deleteMany({where:{companyId:id}}));
    // Reversals point at the entry they reverse, so they go first.
    await run("journal entries",()=>tx.journalEntry.deleteMany({where:{companyId:id,reversalOfId:{not:null}}}));
    await run("journal entries",()=>tx.journalEntry.deleteMany({where:{companyId:id}}));
    await run("attachments",()=>tx.attachment.deleteMany({where:{companyId:id}}));
    await run("approvals",()=>tx.approval.deleteMany({where:{companyId:id}}));

    // Numbering starts again at one, so the first real document is number one.
    const sequences=await tx.sequence.updateMany({where:{companyId:id},data:{nextNumber:1}});
    counted["number series reset"]=sequences.count;
    // Go-live and the lock date are set again when the books are opened for real.
    await tx.company.update({where:{id},data:{goLiveDate:null,booksOpenedAt:null,booksOpenedBy:null,
      booksOpenEvidence:Prisma.DbNull,lockDate:null}});
    for(const table of GUARDED)await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    return counted;
  },{timeout:120000});

  const [lines,entries,accounts,journals,series,taxes,outlets]=await Promise.all([
    db.journalLine.count({where:{companyId:id}}),db.journalEntry.count({where:{companyId:id}}),
    db.account.count({where:{companyId:id,deletedAt:null}}),db.journal.count({where:{companyId:id,deletedAt:null}}),
    db.numberSeries.count({where:{companyId:id,deletedAt:null}}),db.tax.count({where:{companyId:id,deletedAt:null}}),
    db.outlet.count({where:{companyId:id,deletedAt:null}})]);
  if(lines||entries)throw new AppError(500,"The books are not empty after the reset; nothing was committed in vain, but investigate before using this company");

  const out=process.stdout;
  out.write(`${company.name} (${company.code}) reset to zero.\n`);
  out.write(`Allowed because ${database.reason}.\n\nRemoved:\n`);
  for(const [label,count] of Object.entries(removed))if(count)out.write(`  ${count} ${label}\n`);
  // Resetting one company of a pair leaves the other company's half of any
  // intercompany movement behind. Say so plainly rather than let the group
  // report disagree later with no explanation.
  const facing=await db.journalLine.findMany({where:{companyId:{not:id},deletedAt:null,
    account:{counterpartyCompanyId:id},entry:{status:"POSTED",deletedAt:null}},
    select:{company:{select:{code:true,name:true}}},distinct:["companyId"]});
  if(facing.length) {
    out.write(`\nStill facing this company: ${facing.map(f=>f.company.code).join(", ")}.\n`);
    out.write("      Their side of those movements was not touched, so group balances will not\n");
    out.write("      agree until they are reset too. Reset every company before go-live.\n");
  }
  out.write(`\nKept: ${accounts} accounts, ${journals} journals, ${series} number series, ${taxes} taxes, ${outlets} outlets,\n`);
  out.write("      every user, role, permission, posting setting and approval rule, and the audit log.\n");
  out.write("Trial balance: zero — the company has no journal entries.\n");
  out.write("Go-live date and lock date cleared; the next document will be number one.\n");
}

main()
  .catch(e=>{process.stderr.write(`${e instanceof AppError?e.message:"Company reset failed."}\n`);process.exitCode=1;})
  .finally(()=>db.$disconnect());
