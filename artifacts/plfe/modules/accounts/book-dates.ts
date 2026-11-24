import {AppError} from "@/lib/errors";
import {dateOnly,type Tx} from "./model";
import {accountingToday} from "./time";

/** Applies to drafts as well as every direct posting path. Historical opening
 * invoices are created only by their separate guided service; their LEDGER date
 * still passes this guard, while their original issue/due dates are evidence. */
export async function assertGoLiveDate(tx:Tx,companyId:string,value:string|Date) {
  const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{goLiveDate:true}});
  const date=dateOnly(value);
  if(!company.goLiveDate)throw new AppError(400,"Configure this company's go-live date on the first day of an existing financial period before saving financial documents");
  if(date<company.goLiveDate)throw new AppError(400,`Financial documents cannot be dated before go-live ${company.goLiveDate.toISOString().slice(0,10)}. Use guided opening for historical outstanding invoices/bills`);
}
export async function openingReversalDate(tx:Tx,companyId:string) {
  const company=await tx.company.findUniqueOrThrow({where:{id:companyId}});
  if(!company.goLiveDate)throw new AppError(409,"Opening source has no configured go-live date");
  const today=accountingToday();
  // Before declaration a corrected opening must also be correct AS AT go-live,
  // not rely on a later-period reversal to make today's equity look like zero.
  return !company.booksOpenedAt||today<company.goLiveDate?company.goLiveDate:today;
}
