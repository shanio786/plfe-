"use client";
import {api,type RecordData,type PageData} from "@/lib/client";
export type AccountsPage=PageData&{summary?:Record<string,any>};
export function accountList(company:string,resource:string,params:URLSearchParams=new URLSearchParams()){return api<AccountsPage>(`/${company}/accounts/${resource}?${params}`);}
export function accountGet(company:string,resource:string,id:string){return api<RecordData>(`/${company}/accounts/${resource}/${id}`);}
export function accountSave(company:string,resource:string,data:unknown){return api<RecordData>(`/${company}/accounts/${resource}`,{method:"POST",body:JSON.stringify(data)});}
export function accountReport(company:string,report:string,params:URLSearchParams){return api<AccountsPage>(`/${company}/accounts/reports/${report}?${params}`);}
export function accountOverview(company:string){return api<RecordData>(`/${company}/accounts/overview`);}
