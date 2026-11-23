import type {Prisma} from "@prisma/client";
import {AppError} from "./errors";
import type {Actor} from "@/modules/core/model";
import {audit} from "./audit";
// Caller must have authorized the document action. Uses the caller's one
// transaction so an aborted document does not consume its number.
export async function nextDocumentNumber(tx:Prisma.TransactionClient,actor:Actor,companyId:string,docType:string,fiscalYearId:string) {
  const key=`${companyId}/${docType}/${fiscalYearId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},1))`;
  const fiscal=await tx.fiscalYear.findFirst({where:{id:fiscalYearId,companyId,deletedAt:null,isClosed:false}});
  const series=await tx.numberSeries.findFirst({where:{companyId,docType,deletedAt:null}});
  if(!fiscal || !series) throw new AppError(400,"An open financial year and number series are required");
  let sequence=await tx.sequence.findFirst({where:{companyId,docType,fiscalYearId,deletedAt:null}});
  if(!sequence) sequence=await tx.sequence.create({data:{companyId,seriesId:series.id,docType,fiscalYearId,prefix:series.prefix,format:series.format,padding:series.padding,createdBy:actor.id,updatedBy:actor.id}});
  const updated=await tx.sequence.update({where:{id:sequence.id},data:{nextNumber:{increment:1},updatedBy:actor.id}});
  const fy=`${String(fiscal.startDate.getUTCFullYear()).slice(-2)}-${String(fiscal.endDate.getUTCFullYear()).slice(-2)}`;
  const number=sequence.format.replaceAll("{PREFIX}",sequence.prefix).replaceAll("{TYPE}",docType).replaceAll("{FY}",fy).replaceAll("{NUMBER}",sequence.nextNumber.toString().padStart(sequence.padding,"0"));
  await audit(tx,actor,companyId,"UPDATE","sequences",sequence.id,sequence,updated);
  return number;
}
