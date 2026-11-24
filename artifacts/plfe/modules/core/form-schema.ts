/** Zod 4 rejects partial/omit masks naming absent fields. Only identity forms
 * with a real create-time password field need it optional during edit. */
export function recordFormSchema(schema:any,isEdit:boolean) {
  return isEdit&&schema?.shape?.password&&typeof schema.partial==="function"
    ?schema.partial({password:true}):schema;
}
