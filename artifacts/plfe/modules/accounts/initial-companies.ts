// Initial configuration only. Runtime behavior never branches on these codes.
export const groupCompanies = [
  {code:"PLFE",name:"Pakistan Lifestyle Furniture Expo",startMonth:7,businessType:"EVENTS"},
  {code:"SE",name:"STYLE EVENTS",startMonth:7,businessType:"EVENTS"},
  {code:"LPE",name:"Lifestyle Property Expo",startMonth:7,businessType:"EVENTS"},
  {code:"LEV",name:"Lifestyle Event",startMonth:1,businessType:"EVENTS"},
  {code:"PFE",name:"Pak Furniture Expo",startMonth:1,businessType:"EVENTS"},
  {code:"ZAHRA-HOME",name:"Zahra Home",startMonth:1,businessType:"RETAIL"}
] as const;
