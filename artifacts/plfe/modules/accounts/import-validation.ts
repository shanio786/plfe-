import {randomUUID} from "node:crypto";
import {Prisma} from "@prisma/client";
import {AppError} from "@/lib/errors";
import {accountSchema,partySchema} from "./schema";
import {checkAccount} from "./masters";
import type {Tx} from "./model";
import type {ImportFile,ImportIssue} from "./import-file";

export const importTemplates={
  parties:["code","name","companyName","phone","email","city","province","ntn","strn","address","creditDays",
    "isCustomer","isSupplier","isExhibitor","isSponsor","isStaff","openingBalance","openingSide"],
  chart:["code","name","type","parentCode","isGroup","isCash","isBank"]
} as const;
export type ImportKind=keyof typeof importTemplates;
export type NormalizedImportRow={row:number;values:Record<string,any>;parentCode?:string|null};
export async function validateImportRows(tx:Tx,companyId:string,kind:ImportKind,file:ImportFile,canOpen:boolean,booksOpened:boolean) {
  const errors:ImportIssue[]=[...file.errors],plans:NormalizedImportRow[]=[],rawCodes:{row:number;code:string}[]=[];
  const allowed=importTemplates[kind] as readonly string[],seenHeaders=new Set<string>();
  for(const header of file.headers) {
    if(!allowed.includes(header))errors.push({row:1,column:header||"header",reason:"Unknown/blank column; use the downloaded template. Company ids and cross-company references are never imported"});
    if(seenHeaders.has(header))errors.push({row:1,column:header||"header",reason:"Duplicate column"});
    seenHeaders.add(header);
  }
  for(const required of ["code","name",...(kind==="chart"?["type"]:[])])
    if(!seenHeaders.has(required))errors.push({row:1,column:required,reason:"Required template column is missing"});
  const booleanKeys=kind==="chart"?["isGroup","isCash","isBank"]:["isCustomer","isSupplier","isExhibitor","isSponsor","isStaff"];
  for(const [index,cells] of file.rows.entries()) {
    const row=index+2,raw:Record<string,any>={};
    file.headers.forEach((key,i)=>{if(allowed.includes(key)&&cells[i]?.text.trim())raw[key]=cells[i].text.trim();});
    // Include codes from otherwise-invalid rows when finding every duplicate.
    // Never send an already-rejected NUL-bearing text parameter to PostgreSQL.
    if(raw.code&&!raw.code.includes("\0"))rawCodes.push({row,code:raw.code});
    if(cells.slice(file.headers.length).some(c=>c.text||c.error))errors.push({row,column:"row",reason:"Data extends past the named header columns"});
    for(const key of booleanKeys)if(raw[key]!==undefined) {
      if(!["true","false"].includes(raw[key].toLowerCase())) {
        errors.push({row,column:key,reason:"Use true or false, not an ambiguous numeric/yes/no flag"});delete raw[key];
      } else raw[key]=raw[key].toLowerCase()==="true";
    }
    const parsed=(kind==="chart"?accountSchema:partySchema).safeParse(raw);
    if(!parsed.success) {
      for(const issue of parsed.error.issues)errors.push({row,column:issue.path.join(".")||"row",reason:issue.message});
      continue;
    }
    const values:any=parsed.data;
    if(values.code.includes("\0"))continue;
    if(kind==="parties") {
      values.openingBalance=new Prisma.Decimal(values.openingBalance).toFixed(4);
      if(new Prisma.Decimal(values.openingBalance).gt("0")) {
        if(!raw.openingSide)errors.push({row,column:"openingSide",reason:"Choose RECEIVABLE or PAYABLE explicitly for a nonzero opening amount"});
        if(!canOpen)errors.push({row,column:"openingBalance",reason:"Only an authorized Owner/Accountant can stage guided-opening amounts"});
        if(booksOpened)errors.push({row,column:"openingBalance",reason:"Books are already open; guided opening cannot receive new staged amounts"});
        const validRole=values.openingSide==="RECEIVABLE"?[values.isCustomer,values.isExhibitor,values.isSponsor,values.isStaff].some(Boolean):values.isSupplier||values.isStaff;
        if(!validRole)errors.push({row,column:"openingSide",reason:"The party must have the customer/supplier/staff role appropriate to this opening side"});
      }
      plans.push({row,values});
    } else {
      delete values.parentId;
      plans.push({row,values,parentCode:raw.parentCode??null});
    }
  }
  const existing:any[]=kind==="chart"?await tx.account.findMany({where:{companyId}}):await tx.party.findMany({where:{companyId}});
  const inputCodes=[...new Set([...rawCodes.map(r=>r.code),...plans.flatMap(p=>[p.values.code,...(p.parentCode&&!p.parentCode.includes("\0")?[p.parentCode]:[])])])];
  // Match PostgreSQL's actual lower(code) unique-index semantics, including its
  // Unicode/collation behavior, rather than guessing with JS case conversion.
  const table=kind==="chart"?"accounts":"parties";
  const keys=await tx.$queryRaw<{code:string;key:string}[]>(Prisma.sql`
    SELECT code,lower(code) AS key FROM ${Prisma.raw(table)} WHERE company_id=${companyId}::uuid
    ${inputCodes.length?Prisma.sql`UNION ALL SELECT code,lower(code) AS key FROM(VALUES ${Prisma.join(inputCodes.map(code=>Prisma.sql`(${code})`))})v(code)`:Prisma.empty}`);
  const fold=new Map(keys.map(k=>[k.code,k.key]));
  const byCode=new Map<string,{row:number;code:string}[]>();
  for(const p of rawCodes) {
    const key=fold.get(p.code)!;byCode.set(key,[...(byCode.get(key)??[]),p]);
    if(existing.some(e=>fold.get(e.code)===key))errors.push({row:p.row,column:"code",reason:"This company already has this code, including retained archived history; imports create new records only"});
  }
  for(const group of byCode.values())if(group.length>1)
    group.forEach(p=>errors.push({row:p.row,column:"code",reason:"Duplicate code in this file (case-insensitive)"}));
  if(kind==="chart") {
    const virtual=new Map<string,any>(),nodes=new Map<string,any>(),ids=new Map<NormalizedImportRow,string>();
    for(const e of existing.filter(e=>!e.deletedAt))nodes.set(fold.get(e.code)!,e);
    for(const p of plans) {
      const id=randomUUID();ids.set(p,id);
      const node={...p.values,id,parentId:null};virtual.set(id,node);
      if(!nodes.has(fold.get(p.values.code)!))nodes.set(fold.get(p.values.code)!,node);
    }
    for(const p of plans) {
      const node=virtual.get(ids.get(p)!);
      const parent=p.parentCode?nodes.get(fold.get(p.parentCode)!):null;
      if(p.parentCode&&!parent)errors.push({row:p.row,column:"parentCode",reason:"Parent must exist in this company's chart or be a valid group row in this same file"});
      else {node.parentId=parent?.id??null;if(parent)p.parentCode=parent.code;}
    }
    for(const p of plans)try {
      await checkAccount(tx,companyId,virtual.get(ids.get(p)!),undefined,virtual);
    } catch(error) {
      if(!(error instanceof AppError))throw error;
      errors.push({row:p.row,column:"parentCode/type/group",reason:error.message});
    }
  }
  const unique=new Map(errors.map(e=>[JSON.stringify(e),e]));
  return {errors:[...unique.values()],plans};
}
