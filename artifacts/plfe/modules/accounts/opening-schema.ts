import {z} from "zod";
import {openingStages} from "./opening-state";
import {decimal} from "./balances";
const id=z.uuid(),day=z.iso.date();
export const openingMoney=z.string().trim().regex(/^-?\d{1,14}(?:\.\d{1,4})?$/,"Use an exact amount with at most fourteen digits and four decimal places").transform(v=>decimal(v).toFixed(4));
export const openingReason=z.string().trim().min(10,"Write a reason of at least ten characters").max(2000);
const base={operation:z.literal("post"),requestKey:id};
const cash={...base,accountId:id,amount:openingMoney};
const party={...base,partyId:id,amount:openingMoney,originalReference:z.string().trim().min(1).max(150),
  originalDate:day,dueDate:day,stagedImportId:id.optional()};
export const openingPostSchema=z.discriminatedUnion("stage",[
  z.object({...cash,stage:z.literal("CASH")}).strict(),
  z.object({...cash,stage:z.literal("BANK"),statementReference:z.string().trim().min(3).max(300)}).strict(),
  z.object({...party,stage:z.literal("RECEIVABLES")}).strict(),
  z.object({...party,stage:z.literal("PAYABLES")}).strict(),
  z.object({...base,stage:z.literal("STOCK"),outletId:id,stockCode:z.string().trim().min(1).max(80),
    description:z.string().trim().min(1).max(300),quantity:openingMoney,unitCost:openingMoney}).strict(),
  z.object({...base,stage:z.literal("JOURNAL"),lines:z.array(z.object({accountId:id,debit:openingMoney,credit:openingMoney,
    memo:z.string().trim().max(300).optional()}).strict()).min(1).max(100)}).strict()
]);
export const openingOperationSchema=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("configure"),goLiveDate:day}).strict(),
  z.object({operation:z.literal("review"),stage:z.enum(openingStages),reason:openingReason,locationIds:z.array(id).max(2000).optional()}).strict(),
  z.object({operation:z.literal("reopen-review"),stage:z.enum(openingStages),reason:openingReason}).strict(),
  z.object({operation:z.literal("declare"),confirmed:z.literal(true)}).strict(),
  z.object({operation:z.literal("cancel-staged"),id,reason:openingReason}).strict()
]);
