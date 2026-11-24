const masters=["chart","party","department","journal"];
const documents=["invoice","bill","payment","entry"];
export const accountsPermissions=[
  ...masters.flatMap(r=>["read","create","update","delete"].map(a=>`accounts.${r}.${a}`)),
  ...documents.flatMap(r=>["read","create","update","delete","post","cancel"].map(a=>`accounts.${r}.${a}`)),
  "accounts.payment.allocate","accounts.settings.read","accounts.settings.update",
  "accounts.outlet.read","accounts.outlet.create","accounts.outlet.update",
  "accounts.tax.read","accounts.tax.create","accounts.tax.update",
  "accounts.report.read","accounts.approval.approve"
];
export const accountsReadPermissions=[
  "accounts.chart.read","accounts.party.read","accounts.department.read","accounts.journal.read","accounts.outlet.read",
  "accounts.tax.read",
  "accounts.invoice.read","accounts.bill.read","accounts.payment.read","accounts.entry.read","accounts.report.read"
];
