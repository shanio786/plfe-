import {audit} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import type {Actor} from "@/modules/core/model";
import {meta,type Tx} from "./model";

/** The provisioning guard must be held before any company ledger lock. */
export async function linkCounterparties(tx:Tx,actor:Actor,companyId:string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(71007101)`;
  const own=await tx.company.findUniqueOrThrow({where:{id:companyId}});
  const others=await tx.company.findMany({where:{id:{not:companyId},active:true,deletedAt:null},orderBy:{id:"asc"}});
  for(const other of others) {
    for(const [company,counterparty] of [[own,other],[other,own]]) {
      for(const [parentCode,type,label] of [["1600","ASSET","Due from"],["2500","LIABILITY","Due to"]] as const) {
        const parent=await tx.account.findFirst({where:{companyId:company.id,code:parentCode,isGroup:true,deletedAt:null,active:true}});
        if(!parent)throw new AppError(409,`${company.name}: configure active group account ${parentCode} first`);
        await tx.$queryRaw`SELECT id FROM accounts WHERE id=${parent.id}::uuid FOR UPDATE`;
        if(await tx.account.findFirst({where:{companyId:company.id,parentId:parent.id,counterpartyCompanyId:counterparty.id}}))continue;
        // Include inactive/archived codes: an allocated number is never recycled.
        const rows=await tx.account.findMany({where:{companyId:company.id},select:{code:true}});
        const used=new Set(rows.map(r=>r.code));
        const prefix=parentCode.slice(0,-1);
        let n=1;
        while(used.has(`${prefix}${n}`))n++;
        const account=await tx.account.create({data:{companyId:company.id,code:`${prefix}${n}`,name:`${label} ${counterparty.name}`,type,parentId:parent.id,counterpartyCompanyId:counterparty.id,...meta(actor)}});
        await audit(tx,actor,company.id,"CREATE","accounts",account.id,null,account);
      }
    }
  }
}
