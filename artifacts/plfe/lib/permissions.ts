import {Prisma} from "@prisma/client";
import {AppError} from "./errors";
import type {Actor} from "@/modules/core/model";
export async function companyScope(tx:Prisma.TransactionClient,actor:Actor,companyCode:string,permission?:string) {
  const current=await tx.user.findFirst({where:{id:actor.id,active:true,deletedAt:null}});
  if(!current) throw new AppError(401,"Sign in required");
  actor.isOwner=current.isOwner;
  actor.mustChangePassword=current.mustChangePassword;
  if(current.mustChangePassword) throw new AppError(403,"Change your password before continuing");
  const company=await tx.company.findFirst({where:{code:{equals:companyCode,mode:"insensitive"},deletedAt:null,...(current.isOwner?{}:{active:true})}});
  if(!company) throw new AppError(404,"Company not found");
  if(!current.isOwner) {
    const memberships=await tx.userCompanyRole.findMany({where:{companyId:company.id,userId:actor.id,role:{deletedAt:null}},include:{role:{include:{grants:true}}}});
    if(!memberships.length) throw new AppError(403,"You do not have access to this company");
    if(permission && !memberships.some(m=>m.role.grants.some(g=>g.permissionCode===permission))) throw new AppError(403,"You do not have permission for this action");
  }
  return company;
}
export async function permissionsFor(tx:Prisma.TransactionClient,actor:Actor,companyId:string) {
  if(actor.isOwner) return (await tx.permission.findMany()).map(p=>p.code);
  const grants=await tx.rolePermission.findMany({where:{companyId,role:{deletedAt:null,memberships:{some:{userId:actor.id,companyId}}}}});
  return [...new Set(grants.map(g=>g.permissionCode))];
}
