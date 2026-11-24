import {z} from "zod";
const text = z.string().trim().min(1).max(200);
const optional = z.string().trim().max(2000).optional().nullable();
const uuid = z.string().uuid();
export const loginSchema = z.object({email:z.string().email().transform(s=>s.toLowerCase().trim()),password:z.string().min(1).max(200)});
export const passwordSchema = z.object({currentPassword:z.string().min(1),newPassword:z.string().min(10).max(200).regex(/[a-zA-Z]/).regex(/[0-9]/),confirm:z.string().optional()}).refine(v=>v.confirm===undefined||v.newPassword===v.confirm,{message:"Passwords must match",path:["confirm"]});
export const companySchema = z.object({
  code:z.string().trim().regex(/^[A-Za-z0-9-]{2,30}$/).transform(s=>s.toUpperCase()),name:text,legalName:text,
  ntn:optional,strn:optional,address:optional,phone:optional,email:z.union([z.string().email(),z.literal("")]).optional().nullable(),
  logoAttachmentId:uuid.optional().nullable(),currency:z.string().length(3).transform(s=>s.toUpperCase()).default("PKR"),
  businessType:z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,49}$/).default("EVENTS"),
  fyStartMonth:z.coerce.number().int().min(1).max(12).default(7),active:z.boolean().default(true)
});
export const branchSchema = z.object({code:text,name:text,type:z.enum(["OFFICE","SHOWROOM","WAREHOUSE","EVENT_SITE"]),address:optional,phone:optional,active:z.boolean().default(true)});
export const roleSchema = z.object({name:text,description:optional,permissionCodes:z.array(z.string().max(150)).default([])});
export const userSchema = z.object({name:text,email:z.string().email().transform(s=>s.toLowerCase().trim()),phone:optional,photoAttachmentId:uuid.nullable().optional(),active:z.boolean().default(true),isOwner:z.boolean().optional(),password:z.string().max(200).optional(),roleIds:z.array(uuid).optional()});
export const profileSchema = z.object({name:text,phone:z.string().trim().max(50).nullable().optional()});
export const numberingSchema = z.object({docType:z.string().regex(/^[A-Z][A-Z0-9_]{0,49}$/),prefix:text,format:z.string().min(1).max(200).refine(s=>s.includes("{NUMBER}"),"Include {NUMBER}"),padding:z.coerce.number().int().min(1).max(12).default(4)});
export const fiscalYearSchema = z.object({name:text,startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),endDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)});
export const approvalRuleSchema = z.object({docType:text,action:text,approverPermissionCode:text,thresholdAmount:z.union([z.string().regex(/^\d{1,14}(\.\d{1,4})?$/),z.literal("").transform(()=>null)]).nullable().optional(),active:z.boolean().default(true)});
export const listSchema = z.object({search:z.string().max(200).default(""),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(10),sort:z.string().default("createdAt"),direction:z.enum(["asc","desc"]).default("desc"),status:z.string().max(50).optional()});
