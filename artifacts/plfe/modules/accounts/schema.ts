import {z} from "zod";
import Decimal from "decimal.js";

const text=z.string().trim().min(1).max(200);
const optional=z.string().trim().max(2000).nullish().transform(v=>v||null);
const uuid=z.string().uuid();
const dimension=uuid.nullish().transform(v=>v||null);
export const amount=z.string().regex(/^\d{1,14}(\.\d{1,4})?$/,"Use a positive decimal with at most four decimal places");
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const tags={departmentId:dimension,eventId:dimension,outletId:dimension};
export const accountSchema=z.object({code:text,name:text,type:z.enum(["ASSET","LIABILITY","EQUITY","INCOME","EXPENSE"]),parentId:dimension,defaultTaxId:dimension,isGroup:z.boolean().default(false),isBank:z.boolean().default(false),isCash:z.boolean().default(false),active:z.boolean().default(true)});
export const departmentSchema=z.object({code:text,name:text,active:z.boolean().default(true)});
export const outletSchema=z.object({
  code:z.string().trim().regex(/^[A-Za-z0-9-]{1,30}$/,"Use a code of up to 30 letters, numbers or hyphens").transform(s=>s.toUpperCase()),
  name:z.string().trim().min(1,"Enter the outlet name").max(200,"Keep the outlet name to 200 characters"),
  type:z.enum(["SHOWROOM","COUNTER","GATE","OFFICE"],{error:"Choose Showroom, Counter, Gate or Office"}),
  address:z.string().trim().max(2000,"Keep the address to 2,000 characters").nullish().transform(v=>v||null),
  active:z.boolean().default(true)
});
export const journalSchema=z.object({code:text,name:text,type:z.enum(["SALES","PURCHASE","BANK","CASH","GENERAL"]),active:z.boolean().default(true)});
export const provinces=["Punjab","Sindh","Khyber Pakhtunkhwa","Balochistan","Islamabad Capital Territory"] as const;
const province=z.preprocess(v=>v===""?null:v,z.enum(provinces).nullish());
export const taxSchema=z.object({
  code:z.string().trim().regex(/^[A-Za-z0-9-]{1,30}$/,"Use a tax code of up to 30 letters, numbers or hyphens").transform(v=>v.toUpperCase()),
  name:text,kind:z.enum(["FEDERAL_SALES","PROVINCIAL_SERVICES","WITHHOLDING"]),
  authority:z.enum(["FBR","PRA","SRB","KPRA","BRA"]),
  percentage:z.string().regex(/^\d{1,3}(\.\d{1,6})?$/,"Enter a percentage with up to six decimal places").refine(v=>/^\d{1,3}(\.\d{1,6})?$/.test(v)&&new Decimal(v).lte("100"),"The percentage cannot exceed 100"),
  applicability:z.enum(["SALES","PURCHASES","BOTH"]),province:z.enum(["ALL",...provinces]),
  outputAccountId:uuid,inputAccountId:uuid,isDefault:z.boolean().default(true),
  effectiveFrom:day,effectiveTo:z.union([day,z.literal("")]).nullish().transform(v=>v||null),
  active:z.boolean().default(true),previousVersionId:dimension
});
export const partySchema=z.object({code:text,name:text,companyName:optional,linkedCompanyId:dimension,phone:optional,email:z.union([z.email(),z.literal("")]).nullish().transform(v=>v||null),city:optional,province,ntn:optional,strn:optional,
  taxTreatment:z.enum(["STANDARD","EXEMPT","ZERO_RATED"]).default("STANDARD"),taxExemptionReason:optional,taxCertificateRef:optional,
  address:optional,creditDays:z.coerce.number().int().min(0).max(3650).default(0),isCustomer:z.boolean().default(true),isSupplier:z.boolean().default(false),isExhibitor:z.boolean().default(false),isSponsor:z.boolean().default(false),isStaff:z.boolean().default(false),active:z.boolean().default(true),openingBalance:amount.default("0.0000"),openingSide:z.enum(["RECEIVABLE","PAYABLE"]).default("RECEIVABLE")});
export const documentLineSchema=z.object({accountId:uuid,description:text,qty:amount.default("1.0000"),rate:amount,
  taxId:dimension,taxSelection:z.enum(["AUTO","SELECTED","CLEARED"]).default("AUTO"),withholdingTaxId:dimension,originalLineId:dimension,...tags});
export const invoiceSchema=z.object({kind:z.enum(["INVOICE","CREDIT_NOTE"]).default("INVOICE"),partyId:uuid,date:day,dueDate:day,originalId:dimension,narration:optional,taxOverrideReason:optional,lines:z.array(documentLineSchema).min(1).max(200)});
export const billSchema=invoiceSchema.extend({kind:z.enum(["BILL","DEBIT_NOTE"]).default("BILL")});
export const ledgerLineSchema=z.object({accountId:uuid,debit:amount.default("0.0000"),credit:amount.default("0.0000"),partyId:dimension,memo:optional,...tags});
export const entrySchema=z.object({journalId:uuid,kind:z.enum(["JOURNAL","CASH","BANK","TRANSFER","EXPENSE"]).default("JOURNAL"),date:day,narration:optional,lines:z.array(ledgerLineSchema).min(2).max(200)});
export const allocationSchema=z.object({invoiceId:dimension,billId:dimension,amount});
export const duplicateConfirmationSchema=z.object({confirmed:z.literal(true),token:z.string().min(1).max(8192),note:z.string().trim().min(10,"Write a duplicate-payment reason of at least ten characters").max(2000)});
export const paymentSchema=z.object({direction:z.enum(["RECEIPT","PAYMENT"]),method:z.enum(["CASH","BANK"]),partyId:uuid,date:day,settlementAccountId:uuid,amount,narration:optional,...tags,allocations:z.array(allocationSchema).max(200).default([]),duplicateConfirmation:duplicateConfirmationSchema.optional()});
/** Settings are also re-saved from a stored row, where an amount arrives as a
 * Decimal rather than a string. Absent means "leave this as it is"; an empty
 * value means "clear it". */
const keptUuid=z.preprocess(v=>v===undefined?undefined:v===""?null:v,z.union([uuid,z.null()]).optional());
const keptAmount=z.preprocess(
  v=>v===undefined||v===null||v===""?undefined
    :typeof v==="string"?v
    :typeof (v as {toFixed?:unknown}).toFixed==="function"?(v as {toFixed:(n:number)=>string}).toFixed(4)
    :String(v),
  amount.optional());
export const settingsSchema=z.object({receivableAccountId:uuid,payableAccountId:uuid,openingEquityAccountId:uuid,salesJournalId:uuid,purchaseJournalId:uuid,generalJournalId:uuid,cashJournalId:uuid,bankJournalId:uuid,
  cashDifferenceAccountId:keptUuid,cashDifferenceThreshold:keptAmount});
/** A counted drawer. Denominations are evidence only; the counted amount rules. */
export const denominationSchema=z.object({value:amount,count:z.coerce.number().int().min(0).max(1000000)});
export const cashCountSchema=z.object({accountId:uuid,date:day,countedAmount:amount,
  denominations:z.array(denominationSchema).max(40).default([]),
  explanation:z.string().trim().max(2000).nullish().transform(v=>v||null)});
/** One movement between two group companies; both sides are written together. */
export const intercompanySchema=z.object({counterpartyCompanyId:uuid,
  kind:z.enum(["PAY_ON_BEHALF","RECEIVE_ON_BEHALF","TRANSFER"],{error:"Choose paid on behalf, received on behalf or a plain transfer"}),
  date:day,amount,
  reason:z.string().trim().min(10,"Write a reason of at least ten characters").max(2000),
  settlementAccountId:uuid,counterpartyAccountId:uuid});
/** An expo. Its code is permanent because its amounts are filed under it. */
export const eventSchema=z.object({
  code:z.string().trim().regex(/^[A-Za-z0-9-]{1,30}$/,"Use an event code of up to 30 letters, numbers or hyphens").transform(v=>v.toUpperCase()),
  name:z.string().trim().min(1,"Name the event").max(200),
  city:optional,venue:optional,
  edition:z.coerce.number().int().min(1).max(999).nullish().transform(v=>v||null),
  startDate:day,endDate:day,
  status:z.enum(["PLANNED","OPEN","RUNNING","CLOSED","CANCELLED"]).default("PLANNED"),
  budgetIncome:amount.default("0.0000"),budgetCost:amount.default("0.0000"),
  notes:optional,active:z.boolean().default(true)
});
export const accountResources=["chart","parties","departments","journals","outlets","taxes","events","invoices","bills","payments","entries","settings"] as const;
export type AccountResource=typeof accountResources[number];
