import assert from "node:assert/strict";
import {db} from "../../lib/db";
import {config} from "../../lib/config";
import {saveAccountRecord} from "../../modules/accounts/service";
import type {Actor} from "../../modules/core/model";

// Synthetic evidence is deliberately visible and confined to disposable books.
// This configures the real services; it never disables a tax or posting guard.
export const testTaxEvidence={taxTreatment:"ZERO_RATED",taxExemptionReason:"TEST ONLY — synthetic zero-rated fixture, not a legal exemption",taxCertificateRef:"TEST-NOT-A-REAL-CERTIFICATE"};
export async function setupTestTax(owner:Actor,companyCode:string,prepareDemoParties=true) {
  assert.ok(new URL(config.databaseUrl||"").pathname.endsWith("_test"),"Synthetic tax configuration is restricted to disposable _test databases");
  const company=await db.company.findFirstOrThrow({where:{code:companyCode,deletedAt:null}});
  async function account(code:string,type:string,preferred:string) {
    return await db.account.findFirst({where:{companyId:company.id,code:preferred,type,active:true,isGroup:false,isCash:false,isBank:false,deletedAt:null}})??
      await db.account.findFirst({where:{companyId:company.id,code,deletedAt:null}})??
      saveAccountRecord(owner,companyCode,"chart",{code,name:`TEST ONLY ${type} tax account`,type});
  }
  if(!await db.tax.findFirst({where:{companyId:company.id,code:"TEST-NOT-LEGAL-ZERO"}})) {
    const input=await account("TEST-TAX-INPUT","ASSET","1500"),output=await account("TEST-TAX-OUTPUT","LIABILITY","2300");
    await saveAccountRecord(owner,companyCode,"taxes",{code:"TEST-NOT-LEGAL-ZERO",name:"TEST ONLY — synthetic rate, not current law",
      kind:"FEDERAL_SALES",authority:"FBR",percentage:"0",applicability:"BOTH",province:"ALL",
      inputAccountId:input.id,outputAccountId:output.id,isDefault:true,effectiveFrom:"1900-01-01",active:true});
  }
  if(prepareDemoParties)for(const customer of [true,false]) {
    const code=customer?"TEST-P2-CUSTOMER":"TEST-P2-SUPPLIER";
    const before=await db.party.findFirst({where:{companyId:company.id,code,deletedAt:null}});
    await saveAccountRecord(owner,companyCode,"parties",{...(before??{}),id:before?.id,code,
      name:before?.name??`TEST DATA — ${customer?"customer":"supplier"}`,isCustomer:customer,isSupplier:!customer,
      ...testTaxEvidence,openingBalance:before?.openingBalance.toFixed(4)??"0.0000"});
  }
}
