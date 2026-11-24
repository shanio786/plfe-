type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
type Row = readonly [string, string, AccountType, string | null, string];

// Group shorthand is distinct from the immutable, existing company code.
export const groupCompanies = [
  {code:"PLFE", name:"Pakistan Lifestyle Furniture Expo", startMonth:7, retail:false},
  {code:"SE", name:"STYLE EVENTS", startMonth:7, retail:false},
  {code:"LPE", name:"Lifestyle Property Expo", startMonth:7, retail:false},
  {code:"LEV", name:"Lifestyle Event", startMonth:1, retail:false},
  {code:"PFE", name:"Pak Furniture Expo", startMonth:1, retail:false},
  {code:"ZAHRA-HOME", name:"Zahra Home", startMonth:1, retail:true}
] as const;

export const isRetailCompany = (code:string) => ["ZH","ZAHRA-HOME"].includes(code.toUpperCase());

/** Separate company-owned rows; never share account IDs across companies. */
export function chartTemplate(companyCode:string):Row[] {
  const retail=isRetailCompany(companyCode);
  const rows:Row[]=[
    ["1000","Assets","ASSET",null,"group"],
    ["1100","Cash in hand","ASSET","1000","group"],
    ...(retail ? [
      ["1110","POS cash - Showroom 1","ASSET","1100","cash"],
      ["1120","POS cash - Showroom 2","ASSET","1100","cash"],
      ["1130","Card receivable","ASSET","1000",""]
    ] as Row[] : [["1101","Cash in hand - Head Office","ASSET","1100","cash"]] as Row[]),
    ["1150","Petty cash","ASSET","1000","cash"],
    ["1200","Bank accounts","ASSET","1000","group"],
    ["1201","Bank current account","ASSET","1200","bank"],
    ["1300",retail?"Accounts receivable - customers":"Accounts receivable - exhibitors","ASSET","1000",""],
    ...(!retail ? [["1310","Accounts receivable - sponsors","ASSET","1000",""]] as Row[] : []),
    ["1400","Advances to vendors","ASSET","1000",""],
    ...(!retail ? [["1410","Venue security deposits","ASSET","1000",""]] as Row[] : []),
    ["1500","Input sales tax","ASSET","1000",""],
    ["1510","Advance income tax / withholding tax deducted by customers","ASSET","1000",""],
    ["1600","Due from group companies","ASSET","1000","group"],
    ...(retail ? [
      ["1700","Inventory","ASSET","1000","group"],
      ["1701","Inventory - Showroom 1","ASSET","1700",""],
      ["1702","Inventory - Showroom 2","ASSET","1700",""]
    ] as Row[] : []),
    ["1800","Fixed assets","ASSET","1000",""],
    ["1890","Accumulated depreciation","ASSET","1000",""],
    ["2000","Liabilities","LIABILITY",null,"group"],
    ["2100","Accounts payable - vendors","LIABILITY","2000",""],
    ["2200",retail?"Customer advances for furniture booked and delivered later":"Advances from exhibitors","LIABILITY","2000",""],
    ["2300","Output sales tax","LIABILITY","2000",""],
    ["2310","Withholding tax payable","LIABILITY","2000",""],
    ["2400","Salaries payable","LIABILITY","2000",""],
    ["2500","Due to group companies","LIABILITY","2000","group"],
    ["2600","Director's current account","LIABILITY","2000",""],
    ["3000","Equity","EQUITY",null,"group"],
    ["3100","Capital","EQUITY","3000",""],
    ["3200","Owner's drawings","EQUITY","3000",""],
    ["3900","Retained earnings","EQUITY","3000",""],
    ["3990","Opening balance equity","EQUITY","3000",""],
    ["4000","Income","INCOME",null,"group"],
    ["4100",retail?"Showroom sales":"Booth / stall sales","INCOME","4000",""],
    ...(retail ? [["4110","Online sales","INCOME","4000",""]] as Row[] : [
      ["4200","Sponsorship income","INCOME","4000",""],
      ["4300","Visitor ticket income","INCOME","4000",""],
      ["4400","Advertising / branding income","INCOME","4000",""]
    ] as Row[]),
    ["4900",retail?"Sales returns and discounts":"Discounts given","INCOME","4000",""],
    ["5000",retail?"Cost of goods sold":"Direct event costs","EXPENSE",null,"group"],
    ...(retail ? [
      ["5100","Cost of goods sold","EXPENSE","5000",""],
      ["5110","Freight inwards","EXPENSE","5000",""],
      ["5120","Stock adjustments","EXPENSE","5000",""]
    ] as Row[] : [
      ["5100","Venue rent","EXPENSE","5000",""],
      ["5200","Marketing - outdoor","EXPENSE","5000",""],
      ["5210","Marketing - digital and social media","EXPENSE","5000",""],
      ["5220","Marketing - TV, radio and print","EXPENSE","5000",""],
      ["5300","Carpets and stall fabrication","EXPENSE","5000",""],
      ["5400","Electricity and generators","EXPENSE","5000",""],
      ["5500","Security, ushers and janitorial","EXPENSE","5000",""],
      ["5600","Travel, hotel and food for event staff","EXPENSE","5000",""],
      ["5700","Event operations - other","EXPENSE","5000",""]
    ] as Row[]),
    ["6000","Operating expenses","EXPENSE",null,"group"],
    ["6100","Salaries and wages","EXPENSE","6000",""],
    ["6200","Office rent and utilities","EXPENSE","6000",""],
    ["6300","Vehicles - fuel and maintenance","EXPENSE","6000",""],
    ["6400","Communication and internet","EXPENSE","6000",""],
    ["6500","Legal and professional","EXPENSE","6000",""],
    ["6600","Printing, stationery and courier","EXPENSE","6000",""],
    ["6900","Depreciation","EXPENSE","6000",""],
    ["7000","Other income and expenses","EXPENSE",null,"group"],
    ["7100","Bank charges","EXPENSE","7000",""],
    ...(retail ? [["7200","POS cash differences","EXPENSE","7000",""]] as Row[] : [])
  ];
  // Stable suffixes across every company; exclude only the company's own row.
  groupCompanies.forEach((other,index)=>{
    if(other.code===companyCode || isRetailCompany(other.code)&&retail)return;
    rows.push([`160${index+1}`,`Due from ${other.name}`,"ASSET","1600",""]);
    rows.push([`250${index+1}`,`Due to ${other.name}`,"LIABILITY","2500",""]);
  });
  return rows;
}
export const journalTemplate=[
  ["SALES","Sales journal","SALES"],["PURCHASE","Purchase journal","PURCHASE"],
  ["GENERAL","General journal","GENERAL"],["CASH","Cash journal","CASH"],["BANK","Bank journal","BANK"]
] as const;
export const accountsDocumentTypes=["INV","CN","BILL","DN","REC","PAY","JE","JV","CV","BV","TRF","EXP","REV"];
