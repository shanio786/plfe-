export type Actor = {id:string;name:string;email:string;isOwner:boolean;mustChangePassword:boolean;sessionId?:string;ip?:string;device?:string};
export const resources = ["companies","branches","users","roles","memberships","numbering","fiscal-years","periods","approval-rules","approvals","attachments","audit","sessions","permissions"] as const;
export type Resource = typeof resources[number];
