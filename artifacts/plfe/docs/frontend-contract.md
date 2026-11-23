# Phase 1 frontend contract

This artifact is being converted to a standalone Next.js 15 App Router app, NOT Vite. Application root artifacts/plfe. Use app/, modules/core/components/, lib/. Do not use src/App.tsx or generated workspace client imports. Root alias @/* is this artifact root; existing shadcn components will be under components/ui/.

Same-origin prefix /api/plfe. lib/client.ts defines api(), list(), save(), Identity, PageData.

- GET /session: {user:{id,name,email,isOwner,mustChangePassword},companies:[company records]}; 401 if unauthenticated.
- POST /session {email,password}; DELETE /session logout.
- POST /password {currentPassword,newPassword}; password must be 10+ chars, a letter and a digit.
- GET /:company/overview {company,stats:{branches,users,roles,pendingApprovals,attachments},recentActivity:[],permissions:string[],fiscalYear:object|null}.
- GET /:company/:resource?search=&page=1&pageSize=10&sort=createdAt&direction=desc&status= returns {rows,total,page,pageSize}. Add export=xlsx to download Excel.
- POST /:company/:resource with fields creates record; include id to update; include {id,operation:"delete"} to soft delete, links hard delete.
- resources: companies, branches, users, roles, memberships, numbering, fiscal-years, periods, approval-rules, approvals, attachments, audit, sessions, permissions.
- companies: id,code,name,legalName,ntn,strn,address,phone,email,logoAttachmentId,currency,fyStartMonth,active,lockDate.
- branches: id,code,name,type(OFFICE|SHOWROOM|WAREHOUSE|EVENT_SITE),address,phone,active.
- users: id,name,email,phone,photoStorageKey,active,isOwner,mustChangePassword,roles:string[]. POST create also password,roleIds:string[]. Update roleIds affects ONLY selected company. POST {id,operation:"reset-password",password} resets password. Only Owner can set isOwner and globally deactivate cross-company identities. Non-owner admins can manage roles only inside their company.
- roles: id,name,description,isSystem,permissionCodes:string[]. POST permissionCodes replaces grants in transaction. all 11 seeded.
- permissions: [{id:code,code,description}] read only global catalogue (rows envelope).
- memberships: id,userId,roleId,userName,roleName. POST creates/removes link.
- numbering: id,docType,prefix,format,padding; example format {PREFIX}/{TYPE}/{FY}/{NUMBER}. Counters read-only included sequences array. No allocation button; service used by later documents.
- fiscal-years: id,name,startDate,endDate,isClosed. POST dates YYYY-MM-DD generates 12 periods. Phase 3 close controls NOT built.
- periods: read-only date ranges.
- approval-rules: id,docType,action,approverPermissionCode,thresholdAmount (decimal STRING),active. Payment default 500000.0000 PKR.
- approvals: id,docType,docId,action,status(PENDING|APPROVED|REJECTED|CANCELLED),requestedBy,requesterName,requestNote,decidedBy,decisionNote,requestedAt. POST {id,operation:"approve"|"reject"|"withdraw",note}. Phase1 real workflow support BRANCH/deactivate: create with {docType:"BRANCH",docId,action:"deactivate",requestNote}; authorized second person approval deactivates branch atomically. Do not fake later document approvals.
- audit: id,action,tableName,recordId,userId,actorName,beforeJson,afterJson,createdAt,ip; read only, detail dialog.
- sessions: id,userId,userName,createdAt,lastSeenAt,expiresAt,ip,device,isCurrent; POST {id,operation:"revoke"}. No raw/hash token exposed.
- attachments: GET list; POST multipart via /:company/attachments {file,docType:"COMPANY"|"BRANCH",docId}; download /:company/files/:id. DELETE via normal POST {id,operation:"delete"}. Protected disk storage. Company logo upload same endpoint then save company logoAttachmentId.

All API errors {error:string}. HTTP 401/403/409. No demo login bypass and no fake seed data in UI; login required. Initial page "/" should render polished login if unauthenticated or company selection if signed in. /login, /change-password, /[company]/admin/[[...section]] with sections overview, companies, branches, users, roles, numbering, fiscal-years, approval-rules, approvals, attachments, audit, profile, sessions. Route group /(portal) has no URL segment.

User explicitly wants Tailwind + shadcn, TanStack Table lists server-side filtering/paging/sorting/export, react-hook-form + zod shared validation (import modules/core/schema.ts; parent will implement; coordinate expected names or use form schema locally moved into same shared schema file if needed). All screen text in lib/labels.ts. Dates Asia/Karachi dd-MM-yyyy. Never money as JS number: threshold strings only, display using string formatter. No business logic in components. Forms only collect input and call services via API.
