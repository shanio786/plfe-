// One source template, copied into each company. Later module permissions are
// introduced with those modules, never granted through wildcards.
export const permissionCodes = [
  "core.company.read","core.company.create","core.company.update",
  "core.branch.read","core.branch.create","core.branch.update","core.branch.delete",
  "core.user.read","core.user.create","core.user.update","core.user.reset",
  "core.role.read","core.role.create","core.role.update","core.role.delete",
  "core.membership.read","core.membership.create","core.membership.delete",
  "core.numbering.read","core.numbering.create","core.numbering.update","core.numbering.delete",
  "core.fiscal.read","core.fiscal.create","core.fiscal.update",
  "core.approvalRule.read","core.approvalRule.create","core.approvalRule.update",
  "core.approval.read","core.approval.create","core.approval.approve",
  "core.attachment.read","core.attachment.create","core.attachment.delete",
  "core.audit.read","core.session.read","core.session.revoke"
];
const readOnly = ["core.company.read","core.branch.read"];
export const roleTemplates = [
  {name:"Owner",description:"Full company administration. Global ownership requires the Owner flag.",permissions:permissionCodes},
  {name:"Admin",description:"Company users, roles and settings.",permissions:permissionCodes.filter(p=>p!=="core.company.create")},
  ...["Accountant","Event Manager","Sales Executive","HR","Showroom Manager","Cashier","Gate Staff","Web Editor","Viewer"].map(name=>({
    name,description:"Operational permissions are added when the relevant module is built.",permissions:readOnly
  }))
];
