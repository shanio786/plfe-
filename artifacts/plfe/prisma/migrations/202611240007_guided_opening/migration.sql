BEGIN;
ALTER TABLE companies ADD COLUMN go_live_date date,
  ADD COLUMN books_opened_at timestamptz,
  ADD COLUMN books_opened_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN books_open_evidence jsonb,
  ADD CONSTRAINT company_books_declaration CHECK(
    (books_opened_at IS NULL AND books_opened_by IS NULL AND books_open_evidence IS NULL)
    OR (books_opened_at IS NOT NULL AND books_opened_by IS NOT NULL AND books_open_evidence IS NOT NULL
      AND go_live_date IS NOT NULL AND lock_date IS NOT NULL AND lock_date>=go_live_date-1));
UPDATE companies c SET go_live_date=(SELECT min(p.start_date) FROM periods p WHERE p.company_id=c.id AND p.deleted_at IS NULL);
CREATE TABLE import_previews(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK(kind IN ('parties','chart')),filename text NOT NULL,payload jsonb NOT NULL,
  payload_hash text NOT NULL,source_hash text NOT NULL,context_hash text NOT NULL,token_hash text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,confirmed_at timestamptz,result jsonb,
  UNIQUE(id,company_id),CHECK(expires_at>created_at),CHECK((confirmed_at IS NULL)=(result IS NULL))
);
CREATE INDEX import_previews_scope ON import_previews(company_id,created_by,expires_at);
CREATE TABLE opening_staged_amounts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  party_id uuid NOT NULL,preview_id uuid NOT NULL,side text NOT NULL CHECK(side IN ('RECEIVABLE','PAYABLE')),
  amount numeric(18,4) NOT NULL CHECK(amount>0),status text NOT NULL DEFAULT 'STAGED' CHECK(status IN ('STAGED','CANCELLED')),
  cancel_reason text,created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE(id,company_id),FOREIGN KEY(party_id,company_id) REFERENCES parties(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(preview_id,company_id) REFERENCES import_previews(id,company_id) ON DELETE RESTRICT,
  CHECK(status<>'CANCELLED' OR length(btrim(cancel_reason))>=10)
);
CREATE INDEX opening_staged_scope ON opening_staged_amounts(company_id,status,side);
CREATE TABLE opening_reviews(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK(stage IN ('CASH','BANK','RECEIVABLES','PAYABLES','STOCK','JOURNAL')),
  reason text NOT NULL CHECK(length(btrim(reason))>=10),fingerprint text NOT NULL,evidence jsonb NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),reviewed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE(company_id,stage)
);
CREATE TABLE opening_records(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK(stage IN ('CASH','BANK','RECEIVABLES','PAYABLES','STOCK','JOURNAL')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED','CANCELLED')),number text,date date NOT NULL,
  amount numeric(18,4) NOT NULL,account_id uuid,party_id uuid,outlet_id uuid,original_reference text,original_date date,due_date date,
  stock_code text,description text,quantity numeric(18,4),unit_cost numeric(18,4),details jsonb NOT NULL,
  request_key uuid NOT NULL,payload_hash text NOT NULL,entry_id uuid,reversal_entry_id uuid,cancel_reason text,staged_import_id uuid,
  version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,updated_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE(id,company_id),UNIQUE(company_id,request_key),UNIQUE(company_id,number),UNIQUE(entry_id,company_id),
  UNIQUE(reversal_entry_id,company_id),
  FOREIGN KEY(account_id,company_id) REFERENCES accounts(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(party_id,company_id) REFERENCES parties(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(outlet_id,company_id) REFERENCES outlets(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(entry_id,company_id) REFERENCES journal_entries(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(reversal_entry_id,company_id) REFERENCES journal_entries(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(staged_import_id,company_id) REFERENCES opening_staged_amounts(id,company_id) ON DELETE RESTRICT,
  CHECK(stage IN ('BANK','JOURNAL') OR amount>=0),
  CHECK(stage NOT IN ('CASH','BANK') OR account_id IS NOT NULL),
  CHECK(stage NOT IN ('RECEIVABLES','PAYABLES') OR
    (party_id IS NOT NULL AND original_reference IS NOT NULL AND original_date IS NOT NULL AND due_date IS NOT NULL
     AND amount>0 AND original_date<=date AND due_date>=original_date)),
  CHECK(stage<>'STOCK' OR (outlet_id IS NOT NULL AND stock_code IS NOT NULL AND quantity>=0 AND unit_cost>=0
    AND quantity IS NOT NULL AND unit_cost IS NOT NULL AND amount=round(quantity*unit_cost,4))),
  CHECK(status<>'CANCELLED' OR (cancel_reason IS NOT NULL AND length(btrim(cancel_reason))>=10))
);
CREATE INDEX opening_records_scope ON opening_records(company_id,stage,status);
CREATE UNIQUE INDEX opening_cash_bank_once ON opening_records(company_id,stage,account_id)
  WHERE status='POSTED' AND stage IN ('CASH','BANK');
CREATE UNIQUE INDEX opening_stock_once ON opening_records(company_id,outlet_id,lower(stock_code))
  WHERE status='POSTED' AND stage='STOCK';
CREATE UNIQUE INDEX opening_original_once ON opening_records(company_id,stage,party_id,lower(original_reference))
  WHERE status='POSTED' AND stage IN ('RECEIVABLES','PAYABLES');
ALTER TABLE invoices ADD COLUMN opening_record_id uuid,
  ADD FOREIGN KEY(opening_record_id,company_id) REFERENCES opening_records(id,company_id) ON DELETE RESTRICT;
ALTER TABLE bills ADD COLUMN opening_record_id uuid,
  ADD FOREIGN KEY(opening_record_id,company_id) REFERENCES opening_records(id,company_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX opening_receivable_once ON invoices(opening_record_id,company_id) WHERE opening_record_id IS NOT NULL;
CREATE UNIQUE INDEX opening_payable_once ON bills(opening_record_id,company_id) WHERE opening_record_id IS NOT NULL;

CREATE FUNCTION plfe_guard_book_dates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gl date; opening_id uuid; expected_stage text;
BEGIN
  SELECT go_live_date INTO gl FROM companies WHERE id=NEW.company_id;
  IF TG_TABLE_NAME IN ('invoices','bills') THEN
    opening_id:=NEW.opening_record_id;
    expected_stage:=CASE TG_TABLE_NAME WHEN 'invoices' THEN 'RECEIVABLES' ELSE 'PAYABLES' END;
    IF opening_id IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM opening_records r WHERE r.id=opening_id AND r.company_id=NEW.company_id
        AND r.stage=expected_stage AND r.status IN ('POSTED','CANCELLED') AND r.original_date=NEW.date AND r.due_date=NEW.due_date
        AND r.entry_id=NEW.entry_id AND r.party_id=NEW.party_id AND r.amount=NEW.total) THEN
        RAISE EXCEPTION 'Historical opening dates require their exact company-owned guided opening source' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF gl IS NULL OR NEW.date<gl THEN RAISE EXCEPTION 'Financial date precedes company go-live or go-live is not configured' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_book_date BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION plfe_guard_book_dates();
CREATE TRIGGER bill_book_date BEFORE INSERT OR UPDATE ON bills FOR EACH ROW EXECUTE FUNCTION plfe_guard_book_dates();
CREATE TRIGGER payment_book_date BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION plfe_guard_book_dates();
CREATE TRIGGER entry_book_date BEFORE INSERT OR UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION plfe_guard_book_dates();

CREATE FUNCTION plfe_guard_company_books() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eq uuid; balance numeric; reviews integer;
BEGIN
  IF OLD.books_opened_at IS NOT NULL AND
    (NEW.books_opened_at IS DISTINCT FROM OLD.books_opened_at OR NEW.books_opened_by IS DISTINCT FROM OLD.books_opened_by OR
     NEW.books_open_evidence IS DISTINCT FROM OLD.books_open_evidence OR NEW.go_live_date IS DISTINCT FROM OLD.go_live_date OR
     NEW.fy_start_month<>OLD.fy_start_month OR NEW.lock_date IS NULL OR NEW.lock_date<OLD.go_live_date-1) THEN
    RAISE EXCEPTION 'Books declaration and go-live are permanent; the lock cannot precede go-live' USING ERRCODE='23514';
  END IF;
  IF NEW.go_live_date IS DISTINCT FROM OLD.go_live_date THEN
    IF EXISTS(SELECT 1 FROM journal_entries WHERE company_id=OLD.id AND status='POSTED') OR
      EXISTS(SELECT 1 FROM opening_records WHERE company_id=OLD.id) THEN
      RAISE EXCEPTION 'Go-live cannot change after posting or an opening capture' USING ERRCODE='23514';
    END IF;
    IF NEW.go_live_date IS NULL OR NOT EXISTS(SELECT 1 FROM periods p JOIN fiscal_years y ON y.id=p.fiscal_year_id AND y.company_id=p.company_id
      WHERE p.company_id=NEW.id AND p.start_date=NEW.go_live_date AND NOT p.is_closed AND p.deleted_at IS NULL
        AND NOT y.is_closed AND y.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Go-live must be the first day of an open financial period' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM invoices WHERE company_id=OLD.id AND opening_record_id IS NULL AND date<NEW.go_live_date AND deleted_at IS NULL)
      OR EXISTS(SELECT 1 FROM bills WHERE company_id=OLD.id AND opening_record_id IS NULL AND date<NEW.go_live_date AND deleted_at IS NULL)
      OR EXISTS(SELECT 1 FROM payments WHERE company_id=OLD.id AND date<NEW.go_live_date AND deleted_at IS NULL)
      OR EXISTS(SELECT 1 FROM journal_entries WHERE company_id=OLD.id AND date<NEW.go_live_date AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Go-live cannot invalidate an existing financial document date' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.books_opened_at IS NOT NULL AND OLD.books_opened_at IS NULL THEN
    SELECT opening_equity_account_id INTO eq FROM accounting_settings WHERE company_id=NEW.id AND deleted_at IS NULL;
    SELECT coalesce(sum(l.debit-l.credit),0) INTO balance FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.company_id=l.company_id
      WHERE l.company_id=NEW.id AND l.account_id=eq AND e.status='POSTED' AND e.date<=NEW.go_live_date AND l.deleted_at IS NULL AND e.deleted_at IS NULL;
    SELECT count(*) INTO reviews FROM opening_reviews WHERE company_id=NEW.id;
    IF eq IS NULL OR balance<>0 OR reviews<>6 OR NEW.lock_date<>NEW.go_live_date-1 THEN
      RAISE EXCEPTION 'Declaring books requires six reviewed stages, exact zero opening equity and the go-live lock' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER company_books_guard BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION plfe_guard_company_books();

CREATE FUNCTION plfe_guard_opening_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gl date; eq uuid; eq_net numeric; expected numeric;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Opening history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF EXISTS(SELECT 1 FROM companies WHERE id=NEW.company_id AND books_opened_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Guided opening is locked after books are declared open' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('POSTED','CANCELLED') THEN
    IF (to_jsonb(NEW)-ARRAY['status','reversal_entry_id','cancel_reason','version','updated_at','updated_by'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reversal_entry_id','cancel_reason','version','updated_at','updated_by']) OR
      (OLD.status='CANCELLED' AND (NEW.status<>'CANCELLED' OR NEW.reversal_entry_id IS DISTINCT FROM OLD.reversal_entry_id OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason)) OR
      NEW.status NOT IN ('POSTED','CANCELLED') THEN
      RAISE EXCEPTION 'Posted opening documents are immutable; use normal controlled reversal' USING ERRCODE='23514';
    END IF;
    IF NEW.status='CANCELLED' AND OLD.status='POSTED' AND NEW.entry_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM journal_entries e WHERE e.id=NEW.reversal_entry_id AND e.company_id=NEW.company_id AND e.reversal_of_id=NEW.entry_id AND e.status='POSTED') THEN
      RAISE EXCEPTION 'Opening cancellation requires its posted normal reversal' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status='POSTED' THEN
    SELECT go_live_date INTO gl FROM companies WHERE id=NEW.company_id AND books_opened_at IS NULL;
    IF gl IS NULL OR NEW.date<>gl OR NEW.number IS NULL THEN RAISE EXCEPTION 'Opening ledger date/number must follow go-live policy' USING ERRCODE='23514'; END IF;
    IF NEW.entry_id IS NULL AND (NEW.amount<>0 OR NEW.stage NOT IN ('CASH','BANK','STOCK')) THEN
      RAISE EXCEPTION 'Nonzero openings and opening journals require a balanced posted entry' USING ERRCODE='23514';
    END IF;
    IF NEW.entry_id IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM journal_entries e WHERE e.id=NEW.entry_id AND e.company_id=NEW.company_id AND e.status='POSTED'
        AND e.source_type=CASE NEW.stage WHEN 'RECEIVABLES' THEN 'INVOICE' WHEN 'PAYABLES' THEN 'BILL' ELSE 'GUIDED_OPENING' END
        AND e.source_id=CASE WHEN NEW.stage IN ('RECEIVABLES','PAYABLES') THEN (NEW.details->>'documentId')::uuid ELSE NEW.id END
        AND e.date=gl AND e.number=NEW.number) THEN
        RAISE EXCEPTION 'Opening entry must be its own immutable numbered company source' USING ERRCODE='23514';
      END IF;
      SELECT opening_equity_account_id INTO eq FROM accounting_settings WHERE company_id=NEW.company_id AND deleted_at IS NULL;
      SELECT coalesce(sum(debit-credit),0) INTO eq_net FROM journal_lines WHERE company_id=NEW.company_id AND entry_id=NEW.entry_id AND account_id=eq AND deleted_at IS NULL;
      expected:=CASE NEW.stage WHEN 'PAYABLES' THEN NEW.amount ELSE -NEW.amount END;
      IF eq IS NULL OR eq_net<>expected THEN RAISE EXCEPTION 'Every opening uses its exact opening-equity far side' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER opening_record_guard BEFORE INSERT OR UPDATE OR DELETE ON opening_records FOR EACH ROW EXECUTE FUNCTION plfe_guard_opening_record();
CREATE FUNCTION plfe_opening_document_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r opening_records; valid boolean;
BEGIN
  SELECT * INTO r FROM opening_records WHERE id=NEW.id AND company_id=NEW.company_id;
  IF r.status='DRAFT' OR r.stage NOT IN ('RECEIVABLES','PAYABLES') THEN RETURN NULL; END IF;
  IF r.stage='RECEIVABLES' THEN
    SELECT EXISTS(SELECT 1 FROM invoices d WHERE d.opening_record_id=r.id AND d.company_id=r.company_id
      AND d.id=(r.details->>'documentId')::uuid AND d.status=r.status AND d.entry_id=r.entry_id AND d.total=r.amount
      AND d.reversal_entry_id IS NOT DISTINCT FROM r.reversal_entry_id) INTO valid;
  ELSE
    SELECT EXISTS(SELECT 1 FROM bills d WHERE d.opening_record_id=r.id AND d.company_id=r.company_id
      AND d.id=(r.details->>'documentId')::uuid AND d.status=r.status AND d.entry_id=r.entry_id AND d.total=r.amount
      AND d.reversal_entry_id IS NOT DISTINCT FROM r.reversal_entry_id) INTO valid;
  END IF;
  IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'Opening source and its invoice/bill must remain linked and change state atomically' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER opening_document_complete AFTER INSERT OR UPDATE ON opening_records DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION plfe_opening_document_complete();
CREATE FUNCTION plfe_guard_opening_equity_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.opening_equity_account_id<>OLD.opening_equity_account_id AND
    (EXISTS(SELECT 1 FROM opening_records WHERE company_id=OLD.company_id) OR
     EXISTS(SELECT 1 FROM companies WHERE id=OLD.company_id AND books_opened_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Opening equity mapping is permanent once opening is captured' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER opening_equity_mapping BEFORE UPDATE ON accounting_settings FOR EACH ROW EXECUTE FUNCTION plfe_guard_opening_equity_mapping();
CREATE FUNCTION plfe_guard_opening_support() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Opening/import evidence is retained' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM companies WHERE id=NEW.company_id AND books_opened_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Guided opening writes are locked after declaration' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='opening_staged_amounts' AND TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['status','cancel_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','cancel_reason'])
      OR OLD.status='CANCELLED' OR NEW.status<>'CANCELLED' OR
      EXISTS(SELECT 1 FROM opening_records WHERE company_id=OLD.company_id AND staged_import_id=OLD.id AND status='POSTED') THEN
      RAISE EXCEPTION 'Staged evidence is immutable; only wholly unposted amounts can be deliberately cancelled' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER opening_review_guard BEFORE INSERT OR UPDATE OR DELETE ON opening_reviews FOR EACH ROW EXECUTE FUNCTION plfe_guard_opening_support();
CREATE TRIGGER opening_staged_guard BEFORE INSERT OR UPDATE OR DELETE ON opening_staged_amounts FOR EACH ROW EXECUTE FUNCTION plfe_guard_opening_support();
CREATE TRIGGER opening_records_no_truncate BEFORE TRUNCATE ON opening_records FOR EACH STATEMENT EXECUTE FUNCTION plfe_guard_opening_support();
CREATE TRIGGER opening_reviews_no_truncate BEFORE TRUNCATE ON opening_reviews FOR EACH STATEMENT EXECUTE FUNCTION plfe_guard_opening_support();
CREATE TRIGGER opening_staged_no_truncate BEFORE TRUNCATE ON opening_staged_amounts FOR EACH STATEMENT EXECUTE FUNCTION plfe_guard_opening_support();
CREATE FUNCTION plfe_guard_import_preview() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Import review evidence is retained' USING ERRCODE='23514'; END IF;
  IF OLD.confirmed_at IS NOT NULL OR NEW.confirmed_at IS NULL OR NEW.result IS NULL OR
    (to_jsonb(NEW)-ARRAY['confirmed_at','result']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['confirmed_at','result']) THEN
    RAISE EXCEPTION 'Import review is immutable and can be confirmed only once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_preview_guard BEFORE UPDATE OR DELETE ON import_previews FOR EACH ROW EXECUTE FUNCTION plfe_guard_import_preview();
CREATE TRIGGER import_preview_no_truncate BEFORE TRUNCATE ON import_previews FOR EACH STATEMENT EXECUTE FUNCTION plfe_guard_import_preview();

CREATE OR REPLACE FUNCTION plfe_check_posted_tax_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text; fk text; basis numeric; tax numeric; wh numeric; ready boolean; expected text;
BEGIN
  IF OLD.status<>'DRAFT' OR NEW.status<>'POSTED' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='invoices' THEN t:='invoice_lines';fk:='invoice_id';expected:='RECEIVABLES'; ELSE t:='bill_lines';fk:='bill_id';expected:='PAYABLES'; END IF;
  EXECUTE format('SELECT sum(total),sum(tax_amount),sum(withholding_amount),
    bool_and(CASE WHEN $3 THEN tax_id IS NULL AND default_tax_id IS NULL AND withholding_tax_id IS NULL
      AND tax_snapshot IS NULL AND default_tax_snapshot IS NULL AND withholding_snapshot IS NULL
      AND tax_rate=0 AND withholding_rate=0 ELSE default_tax_id IS NOT NULL AND default_tax_snapshot IS NOT NULL END)
    FROM %I WHERE %I=$1 AND company_id=$2 AND deleted_at IS NULL',t,fk)
    INTO basis,tax,wh,ready USING NEW.id,NEW.company_id,NEW.opening_record_id IS NOT NULL;
  IF NEW.opening_record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM opening_records r
    WHERE r.id=NEW.opening_record_id AND r.company_id=NEW.company_id AND r.status='POSTED' AND r.stage=expected
      AND r.entry_id=NEW.entry_id AND r.amount=NEW.total AND NEW.original_id IS NULL) THEN
    RAISE EXCEPTION 'Historical opening balance requires its exact guided source; it recognizes no new tax' USING ERRCODE='23514';
  END IF;
  IF ready IS DISTINCT FROM true OR NEW.subtotal IS DISTINCT FROM basis OR NEW.tax_total IS DISTINCT FROM tax OR
    NEW.withholding_total IS DISTINCT FROM wh OR NEW.total<>basis+tax OR
    (NEW.opening_record_id IS NOT NULL AND (tax<>0 OR wh<>0)) THEN
    RAISE EXCEPTION 'Posted document requires reviewed line evidence and exact matching totals' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
INSERT INTO permissions(code,description) VALUES
  ('accounts.opening.manage','Owner/Accountant guided opening and controlled source reversals'),
  ('accounts.import.create','Preview and confirm atomic Accounts master imports') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(id,company_id,role_id,permission_code,updated_at)
SELECT gen_random_uuid(),r.company_id,r.id,p.code,now() FROM roles r CROSS JOIN permissions p
WHERE r.is_system AND r.deleted_at IS NULL AND (
  (p.code='accounts.opening.manage' AND r.name IN ('Owner','Accountant') AND EXISTS(
    SELECT 1 FROM role_permissions g WHERE g.role_id=r.id AND g.company_id=r.company_id AND g.permission_code='accounts.settings.update'))
  OR(p.code='accounts.import.create' AND r.name IN ('Owner','Admin','Accountant') AND EXISTS(
    SELECT 1 FROM role_permissions g WHERE g.role_id=r.id AND g.company_id=r.company_id AND g.permission_code IN ('accounts.party.create','accounts.chart.create')))
) ON CONFLICT DO NOTHING;
INSERT INTO number_series(id,company_id,doc_type,prefix,format,padding,updated_at)
SELECT gen_random_uuid(),c.id,t.code,c.code,'{PREFIX}/{TYPE}/{FY}/{NUMBER}',4,now()
FROM companies c CROSS JOIN (VALUES('OCA'),('OBK'),('ORI'),('OPB'),('OST'),('OPJ'))t(code)
WHERE c.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM number_series n WHERE n.company_id=c.id AND n.doc_type=t.code AND n.deleted_at IS NULL);
COMMIT;
