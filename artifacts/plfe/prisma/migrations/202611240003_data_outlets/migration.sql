CREATE TABLE outlets (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('SHOWROOM','COUNTER','GATE','OFFICE')),
  address text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  UNIQUE(id,company_id),
  UNIQUE(company_id,code),
  CHECK(code <> '' AND name <> '')
);
CREATE INDEX outlets_company_active ON outlets(company_id,active);
CREATE UNIQUE INDEX outlets_company_code_ci ON outlets(company_id,lower(code));
ALTER TABLE accounts ADD COLUMN outlet_id uuid;
ALTER TABLE accounts ADD CONSTRAINT accounts_outlet_fkey FOREIGN KEY(outlet_id,company_id) REFERENCES outlets(id,company_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX account_outlet_parent ON accounts(company_id,parent_id,outlet_id) WHERE outlet_id IS NOT NULL;
ALTER TABLE accounts ADD CONSTRAINT separate_account_links CHECK (outlet_id IS NULL OR counterparty_company_id IS NULL);
ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_outlet_fkey FOREIGN KEY(outlet_id,company_id) REFERENCES outlets(id,company_id) ON DELETE RESTRICT;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_outlet_fkey FOREIGN KEY(outlet_id,company_id) REFERENCES outlets(id,company_id) ON DELETE RESTRICT;
ALTER TABLE bill_lines ADD CONSTRAINT bill_lines_outlet_fkey FOREIGN KEY(outlet_id,company_id) REFERENCES outlets(id,company_id) ON DELETE RESTRICT;
ALTER TABLE payments ADD CONSTRAINT payments_outlet_fkey FOREIGN KEY(outlet_id,company_id) REFERENCES outlets(id,company_id) ON DELETE RESTRICT;

-- The application's fresh-start database has no historic outlet records. Do not
-- fabricate outlets to match legacy literal account names or rewrite posted rows.
CREATE FUNCTION protect_outlet_records() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Outlets are retained; deactivate instead'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id OR
     NEW.code IS DISTINCT FROM OLD.code OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'An outlet identity and allocated account links are permanent';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_outlet_records BEFORE UPDATE OR DELETE ON outlets
FOR EACH ROW EXECUTE FUNCTION protect_outlet_records();
CREATE FUNCTION protect_outlet_accounts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.outlet_id IS NOT NULL THEN RAISE EXCEPTION 'Outlet accounts are retained permanently'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.outlet_id IS NOT NULL AND
      (NEW.outlet_id IS DISTINCT FROM OLD.outlet_id OR NEW.company_id IS DISTINCT FROM OLD.company_id OR
       NEW.code IS DISTINCT FROM OLD.code OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR
       NEW.type IS DISTINCT FROM OLD.type OR NEW.is_group IS DISTINCT FROM OLD.is_group OR
       NEW.is_cash IS DISTINCT FROM OLD.is_cash OR NEW.is_bank IS DISTINCT FROM OLD.is_bank OR
       NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
      RAISE EXCEPTION 'Allocated outlet accounts and numbers are permanent';
    END IF;
    IF EXISTS(SELECT 1 FROM accounts WHERE parent_id=OLD.id AND outlet_id IS NOT NULL) AND
      (NEW.code IS DISTINCT FROM OLD.code OR NEW.type IS DISTINCT FROM OLD.type OR
       NEW.is_group IS DISTINCT FROM OLD.is_group OR NEW.company_id IS DISTINCT FROM OLD.company_id OR
       NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
      RAISE EXCEPTION 'An outlet account parent must retain its identity and classification';
    END IF;
  END IF;
  IF NEW.outlet_id IS NOT NULL AND (NEW.parent_id IS NULL OR NEW.is_group OR NEW.is_bank OR NEW.type<>'ASSET' OR
    NOT EXISTS(SELECT 1 FROM accounts p WHERE p.id=NEW.parent_id AND p.company_id=NEW.company_id AND p.is_group AND p.type='ASSET'
      AND ((p.code='1100' AND NEW.is_cash) OR (p.code='1700' AND NOT NEW.is_cash)))) THEN
    RAISE EXCEPTION 'Outlet accounts require the POS cash or inventory parent';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_outlet_accounts BEFORE INSERT OR UPDATE OR DELETE ON accounts
FOR EACH ROW EXECUTE FUNCTION protect_outlet_accounts();

-- New explicit permissions are copied into the existing standard roles only.
INSERT INTO permissions(code,description) VALUES
  ('accounts.outlet.read','Read company outlets'),('accounts.outlet.create','Create company outlets'),('accounts.outlet.update','Update company outlets')
  ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(id,company_id,role_id,permission_code,updated_at)
SELECT gen_random_uuid(),r.company_id,r.id,p.code,now() FROM roles r CROSS JOIN permissions p
WHERE r.is_system AND r.deleted_at IS NULL AND
  ((r.name IN ('Owner','Admin','Accountant') AND p.code IN ('accounts.outlet.read','accounts.outlet.create','accounts.outlet.update')) OR
   (r.name='Viewer' AND p.code='accounts.outlet.read')) AND
  EXISTS(SELECT 1 FROM role_permissions old WHERE old.role_id=r.id AND old.company_id=r.company_id
    AND old.permission_code=replace(p.code,'accounts.outlet.','accounts.chart.'))
ON CONFLICT DO NOTHING;
