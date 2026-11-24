import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import {inflateRawSync} from "node:zlib";
import {AppError} from "@/lib/errors";

export const importMaxRows=2000,importMaxBytes=2097152;
export type ImportIssue={row:number;column:string;reason:string};
export type ImportCell={text:string;error?:string};
export type ImportFile={headers:string[];rows:ImportCell[][];errors:ImportIssue[];totalRows:number};
const fail=(message:string):never=>{throw new AppError(400,message);};
function checkXml(name:string,data:Buffer) {
  if(!name.endsWith(".xml")&&!name.endsWith(".rels"))return;
  const xml=data.toString("utf8");
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))fail("Workbook DTDs/entities are not supported");
  if(/macroEnabled|vbaProject/i.test(xml)||name.endsWith(".rels")&&/\bTargetMode\s*=\s*["']External["']/i.test(xml))
    fail("Macros and external workbook relationships are not imported");
  if(/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
    const rows=xml.match(/<(?:\w+:)?row\b/g)?.length??0;
    if(rows>importMaxRows+1)fail(`Use at most ${importMaxRows} data rows`);
    if((xml.match(/<(?:\w+:)?c\b/g)?.length??0)>(importMaxRows+1)*24)fail("Workbook has too many cell nodes");
    for(const match of xml.matchAll(/<(?:\w+:)?c\b[^>]*\br=["']([A-Z]+)(\d+)["']/g)) {
      const col=[...match[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
      if(col>24||Number(match[2])>importMaxRows+1)fail(`Workbook cells must fit within 24 columns and ${importMaxRows+1} rows, including the header`);
    }
  }
  return xml;
}
/** Inspect AND bounded-inflate each member before ExcelJS can load it. ZIP central
 * sizes alone are untrusted; maxOutputLength prevents misleading ZIP bombs. */
function safeWorkbookZip(bytes:Buffer) {
  if(bytes.readUInt32LE(0)!==0x04034b50)fail("Use a genuine .xlsx workbook, not a renamed file");
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0||end+22+bytes.readUInt16LE(end+20)!==bytes.length)fail("Invalid workbook ZIP directory");
  const entries=bytes.readUInt16LE(end+10),directorySize=bytes.readUInt32LE(end+12),directory=bytes.readUInt32LE(end+16);
  if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==entries||
    !entries||entries>100||directory+directorySize!==end)fail("Multi-volume, ZIP64 or oversized workbook containers are not supported");
  let offset=directory,total=0,sheets=0;const names=new Set<string>(),numeric=new Map<string,string>();
  for(let n=0;n<entries;n++) {
    if(offset+46>end||bytes.readUInt32LE(offset)!==0x02014b50)fail("Malformed workbook member directory");
    const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),compressed=bytes.readUInt32LE(offset+20),
      expanded=bytes.readUInt32LE(offset+24),nameLength=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),
      comment=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42);
    if(offset+46+nameLength+extra+comment>end)fail("Malformed workbook member name");
    const name=bytes.subarray(offset+46,offset+46+nameLength).toString("utf8");
    total+=expanded;
    if(flags&1||![0,8].includes(method)||expanded>8*1024*1024||total>16*1024*1024||
      expanded>Math.max(compressed,1)*200||names.has(name)||/(?:^\/|\\|(?:^|\/)\.\.(?:\/|$)|\0)/.test(name))
      fail("Workbook contains encrypted, duplicated, unsafe or excessively expanded members");
    if(/(?:vba|externalLinks|activeX|embeddings)/i.test(name))fail("Macros, external links and embedded executable objects are not imported");
    names.add(name);
    if(local+30>directory||bytes.readUInt32LE(local)!==0x04034b50)fail("Malformed workbook member");
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    if(start+compressed>directory)fail("Workbook member exceeds its container");
    const packed=bytes.subarray(start,start+compressed);
    let data:Buffer;
    try {data=method===0?packed:inflateRawSync(packed,{maxOutputLength:Math.max(1,expanded)});}
    catch {fail("Workbook member is corrupt or exceeds its declared safe size");}
    if(data!.length!==expanded)fail("Workbook member has an inconsistent expanded size");
    const xml=checkXml(name,data!);
    if(xml&&/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
      if(++sheets>1)fail("Import a single worksheet without hidden or orphan worksheets");
      for(const match of xml.matchAll(/<(?:\w+:)?c\b([^>]*?[^/>])>([\s\S]*?)<\/(?:\w+:)?c>/g)) {
        const ref=match[1].match(/\br=["']([A-Z]+\d+)["']/)?.[1],type=match[1].match(/\bt=["']([^"']+)["']/)?.[1];
        const value=match[2].match(/<(?:\w+:)?v\b[^>]*>([^<]*)<\/(?:\w+:)?v>/)?.[1];
        if(ref&&value!==undefined&&(!type||type==="n"))numeric.set(ref,value.trim());
      }
    }
    offset+=46+nameLength+extra+comment;
  }
  if(offset!==end)fail("Unexpected workbook directory data");
  return numeric;
}
function csvRows(text:string) {
  const rows:string[][]=[];let row:string[]=[],cell="",quoted=false,closed=false;
  function finishCell(){row.push(cell);cell="";closed=false;if(row.length>24)fail("Use at most 24 import columns");}
  function finishRow(){finishCell();rows.push(row);row=[];if(rows.length>importMaxRows+2)fail(`Use at most ${importMaxRows} data rows`);}
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted) {
      if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(c==='"'){quoted=false;closed=true;}
      else cell+=c;
    } else if(c===",")finishCell();
    else if(c==="\r"||c==="\n"){finishRow();if(c==="\r"&&text[i+1]==="\n")i++;}
    else if(c==='"'){if(cell||closed)fail(`Malformed quote in CSV row ${rows.length+1}`);quoted=true;}
    else if(closed){if(!/\s/.test(c))fail(`Unexpected text after a quote in CSV row ${rows.length+1}`);}
    else cell+=c;
    if(cell.length>4000)fail(`Cell in row ${rows.length+1} exceeds 4,000 characters`);
  }
  if(quoted)fail("CSV has an unclosed quoted cell");
  if(cell||row.length||closed)finishRow();
  return rows;
}
function cell(value:ExcelJS.CellValue):ImportCell {
  if(value==null)return {text:""};
  if(typeof value==="string")return {text:value};
  if(typeof value==="boolean")return {text:String(value)};
  if(typeof value==="number")return {text:"",error:"Numeric cells require their exact raw workbook digits"};
  return {text:"",error:typeof value==="object"&&("formula" in value||"sharedFormula" in value)?
    "Formula cells are not imported; replace formulas with static values":"Use plain text, booleans or safely representable numbers, not dates, errors, hyperlinks or rich objects"};
}
export async function readImportFile(filename:string,bytes:Buffer):Promise<ImportFile> {
  if(bytes.length>importMaxBytes||bytes.length<1)fail("Import a nonempty CSV/XLSX file of at most 2 MiB");
  if(/[\x00-\x1f\x7f/\\]/.test(filename))fail("Unsafe import filename");
  let values:ImportCell[][]=[],errors:ImportIssue[]=[];
  if(/\.csv$/i.test(filename)) {
    let text:string;
    try {text=new TextDecoder("utf-8",{fatal:true}).decode(bytes).replace(/^\uFEFF/,"");}
    catch {fail("Use a UTF-8 comma-separated CSV file");}
    values=csvRows(text!).map(row=>row.map(text=>({text})));
  } else if(/\.xlsx$/i.test(filename)) {
    if(bytes.length<22)fail("Invalid XLSX workbook");
    const numeric=safeWorkbookZip(bytes),Exact=Decimal.clone({precision:50});
    const workbook=new ExcelJS.Workbook();
    try {await workbook.xlsx.load(bytes as any);}catch {fail("Invalid or unsupported XLSX workbook");}
    if(workbook.worksheets.length!==1||workbook.worksheets[0].state!=="visible")
      fail("Import exactly one visible worksheet; hidden/additional sheets are not accepted");
    const sheet=workbook.worksheets[0];
    if(sheet.rowCount>importMaxRows+1||sheet.columnCount>24)fail(`Use at most ${importMaxRows} data rows and 24 columns`);
    for(let r=1;r<=sheet.rowCount;r++) {
      const row=sheet.getRow(r);
      if(row.hidden&&row.actualCellCount)errors.push({row:r,column:"row",reason:"Hidden rows are not imported; unhide and review them first"});
      values.push(Array.from({length:sheet.columnCount},(_,i)=>{
        const c=row.getCell(i+1);
        if(typeof c.value!=="number")return cell(c.value);
        // ExcelJS .value is a JS float. Read the original OOXML numeric lexeme
        // instead, then validate/normalize with decimal.js WITHOUT rounding.
        const raw=numeric.get(c.address);
        try {
          if(!raw||!/^[-+]?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?$/.test(raw))throw Error();
          const value=new Exact(raw);
          if(!value.isFinite()||value.abs().gte("1000000000000000000")||value.decimalPlaces()>18)throw Error();
          return {text:value.toFixed()};
        } catch{return {text:"",error:"Unsafe or unsupported raw numeric precision; format this cell as exact text"};}
      }));
    }
    sheet.columns.forEach((column,i)=>{if(column.hidden)errors.push({row:1,column:String(i+1),reason:"Hidden columns are not imported; unhide and review them first"});});
  } else fail("Only UTF-8 .csv and ordinary .xlsx files are supported; not XLS, XLSM or renamed files");
  while(values.length&&values[values.length-1].every(c=>!c.text&&!c.error))values.pop();
  if(values.length<2)fail("Provide a header row and at least one data row");
  if(values.length>importMaxRows+1)fail(`Use at most ${importMaxRows} data rows`);
  const header=values.shift()!;
  while(header.length&&!header[header.length-1].text.trim()&&!header[header.length-1].error&&
    values.every(row=>!row[header.length-1]?.text&&!row[header.length-1]?.error)) {
    const index=header.length-1;header.pop();values.forEach(row=>{if(row.length>index)row.pop();});
  }
  const headers=header.map(c=>c.text.trim());
  for(const [i,c] of header.entries())if(c.error)errors.push({row:1,column:String(i+1),reason:c.error});
  values.forEach((row,index)=>row.forEach((c,column)=>{
    if(c.error)errors.push({row:index+2,column:headers[column]||String(column+1),reason:c.error});
    if(c.text.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(c.text))
      errors.push({row:index+2,column:headers[column]||String(column+1),reason:"Cell is too long or contains unsafe control characters"});
    const phone=headers[column]==="phone"&&/^\+\d[\d ()-]*$/.test(c.text.trim());
    if((/^[\t\r\n]/.test(c.text)||/^[=+\-@]/.test(c.text.trimStart()))&&!phone)
      errors.push({row:index+2,column:headers[column]||String(column+1),reason:"Formula-like leading characters are not imported as data"});
  }));
  return {headers,rows:values,errors,totalRows:values.length};
}
