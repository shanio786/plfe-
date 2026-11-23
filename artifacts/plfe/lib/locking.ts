import {Prisma} from "@prisma/client";
import {AppError} from "./errors";

const tables = ["companies","users","sessions","branches","roles","user_company_roles","number_series","fiscal_years","approval_rules","attachments"] as const;
type LockTable = typeof tables[number];

// Lock before reading an audit before-image. Ordinary UPDATE/DELETE statements
// also respect these row locks, including technical writes outside this service.
export async function lockRow(tx:Prisma.TransactionClient,table:LockTable,id:string,companyId?:string) {
  if(!tables.includes(table) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
    throw new AppError(400,"Invalid record id");
  const scope=companyId?Prisma.sql`AND company_id=${companyId}::uuid`:Prisma.empty;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id=${id}::uuid ${scope} FOR UPDATE`);
}
