import {audit} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import type {Actor} from "@/modules/core/model";
import {outletSchema} from "./schema";
import {ledgerLock,meta,type Tx} from "./model";

/** Company ledger lock serializes outlet provisioning with normal postings. */
async function provisionOutletAccounts(tx:Tx,actor:Actor,outlet:{id:string;companyId:string;name:string;active:boolean}) {
  await ledgerLock(tx,outlet.companyId);
  for(const [parentCode,label,isCash] of [["1100","POS cash",true],["1700","Inventory",false]] as const) {
    const parent=await tx.account.findFirst({where:{companyId:outlet.companyId,code:parentCode,isGroup:true,type:"ASSET",active:true,deletedAt:null}});
    if(!parent)throw new AppError(409,`Configure the active ${label.toLowerCase()} parent account ${parentCode} before creating an outlet`);
    await tx.$queryRaw`SELECT id FROM accounts WHERE id=${parent.id}::uuid FOR UPDATE`;
    const existing=await tx.account.findFirst({where:{companyId:outlet.companyId,parentId:parent.id,outletId:outlet.id}});
    if(existing)continue;
    const codes=await tx.account.findMany({where:{companyId:outlet.companyId},select:{code:true}});
    const used=new Set(codes.map(a=>a.code));
    let next=1;const prefix=parentCode.slice(0,-1);
    while(used.has(`${prefix}${next}`))next++;
    const account=await tx.account.create({data:{companyId:outlet.companyId,code:`${prefix}${next}`,name:`${label} - ${outlet.name}`,type:"ASSET",parentId:parent.id,isCash,active:outlet.active,outletId:outlet.id,...meta(actor)}});
    await audit(tx,actor,outlet.companyId,"CREATE","accounts",account.id,null,account);
  }
}

/** Called only by the authorized Accounts write boundary, in its transaction. */
export async function saveOutlet(tx:Tx,actor:Actor,companyId:string,raw:any) {
  if(raw.operation&&raw.operation!=="save")throw new AppError(405,"Outlets cannot be deleted; deactivate them instead");
  await ledgerLock(tx,companyId);
  const data=outletSchema.parse(raw);
  const before=raw.id?await tx.outlet.findFirst({where:{id:raw.id,companyId,deletedAt:null}}):null;
  if(raw.id&&!before)throw new AppError(404,"Outlet not found in this company");
  if(before&&before.code!==data.code)throw new AppError(409,"An outlet code is permanent; edit its name or deactivate the outlet");
  if(!before) {
    const existing=await tx.outlet.findFirst({where:{companyId,code:data.code}});
    if(existing) {
      if(existing.name!==data.name||existing.type!==data.type||existing.address!==data.address||existing.active!==data.active)
        throw new AppError(409,"This outlet code already exists; open that outlet to edit it");
      await provisionOutletAccounts(tx,actor,existing);
      return tx.outlet.findUniqueOrThrow({where:{id:existing.id},include:{accounts:{include:{parent:true},orderBy:{code:"asc"}}}});
    }
  }
  const outlet=before?await tx.outlet.update({where:{id:before.id,companyId},data:{...data,updatedBy:actor.id}}):await tx.outlet.create({data:{...data,companyId,...meta(actor)}});
  await audit(tx,actor,companyId,before?"UPDATE":"CREATE","outlets",outlet.id,before,outlet);
  await provisionOutletAccounts(tx,actor,outlet);
  if(before)for(const account of await tx.account.findMany({where:{companyId,outletId:outlet.id},include:{parent:true}})) {
    const name=`${account.parent!.code==="1100"?"POS cash":"Inventory"} - ${outlet.name}`;
    if(account.name!==name||account.active!==outlet.active) {
      const after=await tx.account.update({where:{id:account.id,companyId},data:{name,active:outlet.active,updatedBy:actor.id}});
      await audit(tx,actor,companyId,"UPDATE","accounts",account.id,account,after);
    }
  }
  return tx.outlet.findUniqueOrThrow({where:{id:outlet.id},include:{accounts:{include:{parent:true},orderBy:{code:"asc"}}}});
}
