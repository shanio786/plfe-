import ExcelJS from "exceljs";
export async function excelBuffer(rows:Record<string,unknown>[],name:string) {
  const workbook=new ExcelJS.Workbook();
  workbook.creator="PLFE Business System";
  const sheet=workbook.addWorksheet(name.slice(0,31));
  const keys=[...new Set([...rows.flatMap(r=>Object.keys(r)),...(name==="parties"?["province"]:[])])].filter(k=>!["deletedAt","createdBy","updatedBy","companyId","user","rule"].includes(k));
  sheet.columns=keys.map(key=>({header:key,key,width:24}));
  for(const row of rows) sheet.addRow(Object.fromEntries(keys.map(key=>{
    const value=row[key];
    return [key,value==null?"":typeof value==="object"?JSON.stringify(value):String(value)];
  })));
  sheet.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};
  sheet.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF174D3E"}};
  sheet.views=[{state:"frozen",ySplit:1}];
  sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:Math.max(keys.length,1)}};
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
