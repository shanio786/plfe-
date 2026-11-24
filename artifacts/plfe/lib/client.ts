// Same-origin API contract. No platform SDK or workspace dependency.
export type RecordData = { id: string; [key: string]: any };
export type Identity = { user: {id:string;name:string;email:string;isOwner:boolean;mustChangePassword:boolean}; companies:RecordData[] };
export type PageData = {rows:RecordData[];total:number;page:number;pageSize:number};
export const API = "/api/plfe";
export async function api<T = any>(path:string, init?:RequestInit):Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init, headers: {...(init?.body instanceof FormData ? {} : {"Content-Type":"application/json"}), ...init?.headers},
    credentials:"same-origin", cache:"no-store"
  });
  const body = await res.json();
  if(!res.ok) throw Object.assign(new Error(body.error || "Request failed"), {status:res.status,details:body.details});
  return body;
}
export function list(company:string,resource:string,params:URLSearchParams){return api<PageData>(`/${company}/${resource}?${params}`);}
export function save(company:string,resource:string,data:unknown){return api(`/${company}/${resource}`,{method:"POST",body:JSON.stringify(data)});}
