-- No legal rates, exemptions, balances or operator identities are seeded here.
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code text NOT NULL,name text NOT NULL,version integer NOT NULL DEFAULT 1,
  kind text NOT NULL,authority text NOT NULL,percentage numeric(9,6) NOT NULL,
  applicability text NOT NULL,province text NOT NULL DEFAULT 'ALL',
  output_account_id uuid NOT NULL,input_account_id uuid NOT NULL,
  is_default boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL,effective_to date,active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid,deleted_at timestamptz,
  UNIQUE(id,company_id),UNIQUE(company_id,code,version),
  FOREIGN KEY(output_account_id,company_id) REFERENCES accounts(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(input_account_id,company_id) REFERENCES accounts(id,company_id) ON DELETE RESTRICT,
  CHECK(code ~ '^[A-Z0-9-]{1,30}$' AND length(btrim(name))>0 AND version>0),
  CHECK(percentage>=0 AND percentage<=100),
  CHECK(applicability IN ('SALES','PURCHASES','BOTH')),
  CHECK(effective_to IS NULL OR effective_to>=effective_from),
  CHECK(
    (kind='FEDERAL_SALES' AND authority='FBR' AND province='ALL') OR
    (kind='WITHHOLDING' AND authority='FBR' AND province='ALL' AND NOT is_default) OR
    (kind='PROVINCIAL_SERVICES' AND
      ((authority='PRA' AND province='Punjab') OR (authority='SRB' AND province='Sindh') OR
       (authority='KPRA' AND province='Khyber Pakhtunkhwa') OR (authority='BRA' AND province='Balochistan')))
  )
);
CREATE INDEX taxes_company_effective ON taxes(company_id,kind,active,effective_from);
ALTER TABLE taxes ADD CONSTRAINT tax_family_versions_no_overlap
  EXCLUDE USING gist(company_id WITH =,code WITH =,daterange(effective_from,effective_to,'[]') WITH &&)
  WHERE(active AND deleted_at IS NULL);
-- Separate applicability exclusions make BOTH overlap SALES and PURCHASES,
-- while still permitting deliberate account-specific non-default versions.
ALTER TABLE taxes ADD CONSTRAINT taxes_sales_default_no_overlap
  EXCLUDE USING gist(company_id WITH =,kind WITH =,province WITH =,
    daterange(effective_from,effective_to,'[]') WITH &&)
  WHERE(active AND is_default AND applicability IN ('SALES','BOTH') AND deleted_at IS NULL);
ALTER TABLE taxes ADD CONSTRAINT taxes_purchase_default_no_overlap
  EXCLUDE USING gist(company_id WITH =,kind WITH =,province WITH =,
    daterange(effective_from,effective_to,'[]') WITH &&)
  WHERE(active AND is_default AND applicability IN ('PURCHASES','BOTH') AND deleted_at IS NULL);

ALTER TABLE accounts ADD COLUMN default_tax_id uuid,
  ADD CONSTRAINT account_default_tax_company FOREIGN KEY(default_tax_id,company_id) REFERENCES taxes(id,company_id) ON DELETE RESTRICT;
ALTER TABLE parties ADD COLUMN strn text,
  ADD COLUMN tax_treatment text NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN tax_exemption_reason text,ADD COLUMN tax_certificate_ref text,
  ADD CONSTRAINT party_tax_evidence CHECK(
    tax_treatment='STANDARD' OR (tax_treatment IN ('EXEMPT','ZERO_RATED') AND
      tax_exemption_reason IS NOT NULL AND tax_certificate_ref IS NOT NULL AND
      length(btrim(tax_exemption_reason))>=10 AND length(btrim(tax_certificate_ref))>0));

ALTER TABLE invoices
  ADD COLUMN withholding_total numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN tax_override_reason text,
  ADD COLUMN party_tax_treatment text NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN party_tax_reason text,ADD COLUMN party_tax_certificate text,
  ADD CONSTRAINT invoice_tax_totals CHECK(
    tax_total>=0 AND withholding_total>=0 AND total=subtotal+tax_total AND withholding_total<=total);
ALTER TABLE bills
  ADD COLUMN withholding_total numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN tax_override_reason text,
  ADD COLUMN party_tax_treatment text NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN party_tax_reason text,ADD COLUMN party_tax_certificate text,
  ADD CONSTRAINT bill_tax_totals CHECK(
    tax_total>=0 AND withholding_total>=0 AND total=subtotal+tax_total AND withholding_total<=total);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_lines','bill_lines'] LOOP
    EXECUTE format('ALTER TABLE %I
      ADD COLUMN default_tax_id uuid,
      ADD COLUMN tax_selection text NOT NULL DEFAULT ''AUTO'',
      ADD COLUMN tax_rate numeric(9,6) NOT NULL DEFAULT 0,
      ADD COLUMN tax_amount numeric(18,4) NOT NULL DEFAULT 0,
      ADD COLUMN tax_snapshot jsonb,
      ADD COLUMN default_tax_snapshot jsonb,
      ADD COLUMN withholding_tax_id uuid,
      ADD COLUMN withholding_rate numeric(9,6) NOT NULL DEFAULT 0,
      ADD COLUMN withholding_amount numeric(18,4) NOT NULL DEFAULT 0,
      ADD COLUMN withholding_snapshot jsonb,
      ADD COLUMN original_line_id uuid,
      ADD CONSTRAINT %I FOREIGN KEY(tax_id,company_id) REFERENCES taxes(id,company_id) ON DELETE RESTRICT,
      ADD CONSTRAINT %I FOREIGN KEY(default_tax_id,company_id) REFERENCES taxes(id,company_id) ON DELETE RESTRICT,
      ADD CONSTRAINT %I FOREIGN KEY(withholding_tax_id,company_id) REFERENCES taxes(id,company_id) ON DELETE RESTRICT,
      ADD CONSTRAINT %I FOREIGN KEY(original_line_id,company_id) REFERENCES %I(id,company_id) ON DELETE RESTRICT,
      ADD CONSTRAINT %I CHECK(tax_selection IN (''AUTO'',''SELECTED'',''CLEARED'') AND
        tax_rate BETWEEN 0 AND 100 AND withholding_rate BETWEEN 0 AND 100 AND
        tax_amount>=0 AND withholding_amount>=0 AND
        (tax_amount=0 OR (tax_id IS NOT NULL AND tax_snapshot IS NOT NULL)) AND
        (withholding_amount=0 OR (withholding_tax_id IS NOT NULL AND withholding_snapshot IS NOT NULL)))',
      t,t||'_selected_tax_company',t||'_default_tax_company',t||'_withholding_tax_company',
      t||'_original_line_company',t,t||'_tax_amounts');
    EXECUTE format('CREATE INDEX %I ON %I(company_id,original_line_id)',t||'_original_line_index',t);
    EXECUTE format('CREATE INDEX %I ON %I(company_id,tax_id)',t||'_tax_index',t);
    EXECUTE format('CREATE INDEX %I ON %I(company_id,default_tax_id)',t||'_default_tax_index',t);
    EXECUTE format('CREATE INDEX %I ON %I(company_id,withholding_tax_id)',t||'_withholding_tax_index',t);
  END LOOP;
END $$;

CREATE FUNCTION plfe_tax_version_used(cid uuid,tid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM invoice_lines l JOIN invoices d ON d.id=l.invoice_id AND d.company_id=l.company_id
      WHERE l.company_id=cid AND d.status IN ('POSTED','CANCELLED')
        AND tid IN (l.tax_id,l.default_tax_id,l.withholding_tax_id)
    UNION ALL
    SELECT 1 FROM bill_lines l JOIN bills d ON d.id=l.bill_id AND d.company_id=l.company_id
      WHERE l.company_id=cid AND d.status IN ('POSTED','CANCELLED')
        AND tid IN (l.tax_id,l.default_tax_id,l.withholding_tax_id)
  );
$$;
CREATE FUNCTION plfe_guard_tax_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Tax versions are retained; deactivate them instead' USING ERRCODE='23514'; END IF;
  IF NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id OR NEW.code<>OLD.code OR NEW.version<>OLD.version OR
    NEW.kind<>OLD.kind OR NEW.authority<>OLD.authority OR NEW.province<>OLD.province OR
    NEW.applicability<>OLD.applicability OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'Tax version identities and family meanings are permanent' USING ERRCODE='23514';
  END IF;
  IF plfe_tax_version_used(OLD.company_id,OLD.id) THEN
    IF (to_jsonb(NEW)-ARRAY['active','effective_to','updated_at','updated_by'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['active','effective_to','updated_at','updated_by']) THEN
      RAISE EXCEPTION 'Used tax versions are immutable; create a new version' USING ERRCODE='23514';
    END IF;
    IF NEW.effective_to IS DISTINCT FROM OLD.effective_to AND NEW.effective_to IS NOT NULL AND EXISTS(
      SELECT 1 FROM invoice_lines l JOIN invoices d ON d.id=l.invoice_id AND d.company_id=l.company_id
        WHERE l.company_id=OLD.company_id AND d.kind='INVOICE' AND d.status IN ('POSTED','CANCELLED') AND
          OLD.id IN (l.tax_id,l.default_tax_id,l.withholding_tax_id) AND d.date>NEW.effective_to
      UNION ALL
      SELECT 1 FROM bill_lines l JOIN bills d ON d.id=l.bill_id AND d.company_id=l.company_id
        WHERE l.company_id=OLD.company_id AND d.kind='BILL' AND d.status IN ('POSTED','CANCELLED') AND
          OLD.id IN (l.tax_id,l.default_tax_id,l.withholding_tax_id) AND d.date>NEW.effective_to
    ) THEN RAISE EXCEPTION 'The tax end date cannot exclude a posted original document' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_version_guard BEFORE UPDATE OR DELETE ON taxes FOR EACH ROW EXECUTE FUNCTION plfe_guard_tax_version();
CREATE TRIGGER taxes_no_truncate BEFORE TRUNCATE ON taxes FOR EACH STATEMENT EXECUTE FUNCTION plfe_no_accounting_truncate();

CREATE FUNCTION plfe_check_posted_tax_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text;fk text;basis numeric;tax numeric;wh numeric;ready boolean;
BEGIN
  IF OLD.status<>'DRAFT' OR NEW.status<>'POSTED' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='invoices' THEN t:='invoice_lines';fk:='invoice_id'; ELSE t:='bill_lines';fk:='bill_id'; END IF;
  EXECUTE format('SELECT sum(total),sum(tax_amount),sum(withholding_amount),
    bool_and(default_tax_id IS NOT NULL AND default_tax_snapshot IS NOT NULL)
    FROM %I WHERE %I=$1 AND company_id=$2 AND deleted_at IS NULL',t,fk)
    INTO basis,tax,wh,ready USING NEW.id,NEW.company_id;
  IF ready IS DISTINCT FROM true OR NEW.subtotal IS DISTINCT FROM basis OR NEW.tax_total IS DISTINCT FROM tax OR
    NEW.withholding_total IS DISTINCT FROM wh OR NEW.total<>basis+tax THEN
    RAISE EXCEPTION 'Posted document requires reviewed line tax snapshots and exact matching totals' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_tax_totals AFTER UPDATE OF status ON invoices FOR EACH ROW EXECUTE FUNCTION plfe_check_posted_tax_totals();
CREATE TRIGGER bill_tax_totals AFTER UPDATE OF status ON bills FOR EACH ROW EXECUTE FUNCTION plfe_check_posted_tax_totals();

INSERT INTO permissions(code,description) VALUES
  ('accounts.tax.read','Read company tax versions'),('accounts.tax.create','Create company tax versions'),
  ('accounts.tax.update','Maintain unused tax versions and their active/effective status')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(id,company_id,role_id,permission_code,updated_at)
SELECT gen_random_uuid(),r.company_id,r.id,p.code,now() FROM roles r CROSS JOIN permissions p
WHERE r.is_system AND r.deleted_at IS NULL AND
  r.name IN ('Owner','Admin','Accountant','Viewer') AND
  p.code IN ('accounts.tax.read','accounts.tax.create','accounts.tax.update') AND
  EXISTS(SELECT 1 FROM role_permissions old WHERE old.company_id=r.company_id AND old.role_id=r.id AND
    old.permission_code=CASE WHEN p.code='accounts.tax.read' THEN 'accounts.chart.read' ELSE 'accounts.settings.update' END)
ON CONFLICT DO NOTHING;
COMMIT;
