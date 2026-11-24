import {test} from "node:test";
import assert from "node:assert/strict";
import {amount,money,date} from "../modules/core/components/format";
import {recordFormSchema} from "../modules/core/form-schema";
import {outletSchema,accountSchema,partySchema,departmentSchema,journalSchema} from "../modules/accounts/schema";
import {z} from "zod";

test("Accounting money uses Rs, grouped thousands, two decimals and bracketed negatives",()=>{
  assert.equal(money("1234567"),"Rs 1,234,567.00");
  assert.equal(money("1234567.1"),"Rs 1,234,567.10");
  assert.equal(money("-1234567.1250"),"(Rs 1,234,567.13)");
  assert.equal(money("0.0000"),"Rs 0.00");
  assert.equal(money("-0.0001"),"Rs 0.00");
});
test("Presentation rounds exactly without losing large-value precision or carry digits",()=>{
  assert.equal(money("99999999999999.9950"),"Rs 100,000,000,000,000.00");
  assert.equal(money("999.9999"),"Rs 1,000.00");
  assert.equal(money("-999.9950"),"(Rs 1,000.00)");
  assert.equal(amount("0000.1050"),"0.11");
  assert.equal(amount("1.2344"),"1.23");
});
test("Missing values are distinct from zero and accounting dates use one day-month-year format",()=>{
  assert.equal(money(null),"—");
  assert.equal(money(undefined),"—");
  assert.equal(money(""),"—");
  assert.equal(date("2026-11-24"),"24-11-2026");
  assert.equal(date(null),"—");
});
test("Every accounting master can open in edit mode without an invalid Zod password mask",()=>{
  for(const schema of [outletSchema,accountSchema,partySchema,departmentSchema,journalSchema]) {
    const edited=recordFormSchema(schema,true);
    assert.equal(edited,schema);
    assert.doesNotThrow(()=>edited.safeParse({}));
  }
  assert.ok(recordFormSchema(outletSchema,true).safeParse({code:"EDIT",name:"Renamed outlet",type:"GATE",active:false}).success);
  const identity=z.object({name:z.string().min(1),password:z.string().min(10)});
  assert.equal(recordFormSchema(identity,false).safeParse({name:"TEST identity"}).success,false);
  assert.equal(recordFormSchema(identity,true).safeParse({name:"TEST identity"}).success,true);
});
