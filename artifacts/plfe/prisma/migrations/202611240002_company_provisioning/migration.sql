CREATE TABLE business_types (
  code text PRIMARY KEY,
  name text NOT NULL,
  chart_kind text NOT NULL CHECK (chart_kind IN ('EVENTS','RETAIL'))
);
INSERT INTO business_types VALUES ('EVENTS','Events','EVENTS'),('RETAIL','Retail','RETAIL');
ALTER TABLE companies ADD COLUMN business_type text NOT NULL DEFAULT 'EVENTS'
  REFERENCES business_types(code) ON DELETE RESTRICT;
CREATE TABLE enrollment_guard (
  id integer PRIMARY KEY CHECK (id=1),
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  completed_at timestamptz
);
INSERT INTO enrollment_guard(id) VALUES (1);
ALTER TABLE accounts ADD COLUMN counterparty_company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE accounts ADD CONSTRAINT no_self_counterparty CHECK (counterparty_company_id IS NULL OR counterparty_company_id <> company_id);
CREATE UNIQUE INDEX account_counterparty_parent ON accounts(company_id,parent_id,counterparty_company_id)
  WHERE counterparty_company_id IS NOT NULL;
CREATE FUNCTION protect_group_account_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM accounts WHERE parent_id=OLD.id AND counterparty_company_id IS NOT NULL) AND
    (NEW.code IS DISTINCT FROM OLD.code OR NEW.type IS DISTINCT FROM OLD.type OR
     NEW.is_group IS DISTINCT FROM OLD.is_group OR NEW.company_id IS DISTINCT FROM OLD.company_id OR
     NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'A linked counterparty parent must retain its identity and classification';
  END IF;
  IF OLD.counterparty_company_id IS NOT NULL AND
    (NEW.counterparty_company_id IS DISTINCT FROM OLD.counterparty_company_id OR
     NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.code IS DISTINCT FROM OLD.code OR
     NEW.type IS DISTINCT FROM OLD.type OR NEW.is_group IS DISTINCT FROM OLD.is_group OR
     NEW.is_cash IS DISTINCT FROM OLD.is_cash OR NEW.is_bank IS DISTINCT FROM OLD.is_bank OR
     NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'Allocated counterparty account links and numbers are permanent';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_group_account_link BEFORE UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION protect_group_account_link();
CREATE FUNCTION prevent_counterparty_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.counterparty_company_id IS NOT NULL THEN
    RAISE EXCEPTION 'Counterparty accounts must be retained permanently';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER prevent_counterparty_delete BEFORE DELETE ON accounts
FOR EACH ROW EXECUTE FUNCTION prevent_counterparty_delete();
CREATE FUNCTION protect_business_template() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.chart_kind IS DISTINCT FROM OLD.chart_kind AND EXISTS(SELECT 1 FROM companies WHERE business_type=OLD.code) THEN
    RAISE EXCEPTION 'A provisioned business type template cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_business_template BEFORE UPDATE ON business_types
FOR EACH ROW EXECUTE FUNCTION protect_business_template();
CREATE FUNCTION check_counterparty_shape() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.counterparty_company_id IS NOT NULL AND (
    NEW.parent_id IS NULL OR NEW.is_group OR NEW.is_cash OR NEW.is_bank OR
    NOT EXISTS(SELECT 1 FROM accounts p WHERE p.id=NEW.parent_id AND p.company_id=NEW.company_id AND p.is_group
      AND ((p.code='1600' AND NEW.type='ASSET' AND p.type='ASSET') OR
           (p.code='2500' AND NEW.type='LIABILITY' AND p.type='LIABILITY')))
  ) THEN RAISE EXCEPTION 'Counterparty links require the matching due-from or due-to parent'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_counterparty_shape BEFORE INSERT OR UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION check_counterparty_shape();
