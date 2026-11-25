-- Part 5: money moving between group companies, the daily cash count, and the
-- cash difference account both of them need. Every rule that must never be
-- broken is a database constraint, not only a service check.

ALTER TABLE accounting_settings ADD COLUMN cash_difference_account_id uuid;
ALTER TABLE accounting_settings ADD COLUMN cash_difference_threshold numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE accounting_settings ADD CONSTRAINT accounting_settings_cash_difference_company
  FOREIGN KEY(cash_difference_account_id,company_id) REFERENCES accounts(id,company_id) ON DELETE RESTRICT;
ALTER TABLE accounting_settings ADD CONSTRAINT cash_difference_threshold_not_negative CHECK (cash_difference_threshold >= 0);

-- A counted drawer on one date. A draft has no ledger effect and may be
-- discarded outright, so there is no soft delete; a posted count is immutable.
CREATE TABLE cash_counts (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  outlet_id uuid,
  number text,
  date date NOT NULL,
  counted_amount numeric(18,4) NOT NULL,
  book_amount numeric(18,4) NOT NULL,
  difference numeric(18,4) NOT NULL,
  denominations jsonb,
  explanation text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  entry_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE(id,company_id),
  UNIQUE(company_id,number),
  UNIQUE(company_id,account_id,date),
  UNIQUE(company_id,entry_id),
  CONSTRAINT cash_count_amounts_not_negative CHECK (counted_amount >= 0),
  -- The stated difference can never disagree with the two amounts beside it.
  CONSTRAINT cash_count_difference_is_derived CHECK (difference = counted_amount - book_amount),
  -- A drawer that does not agree with the books must say why, in words.
  CONSTRAINT cash_count_explains_a_difference
    CHECK (difference = 0 OR (explanation IS NOT NULL AND length(btrim(explanation)) >= 10)),
  -- A posted count is numbered, and carries an entry exactly when it moved money.
  CONSTRAINT cash_count_posted_is_complete
    CHECK (status <> 'POSTED' OR (number IS NOT NULL AND (difference = 0) = (entry_id IS NULL))),
  CONSTRAINT cash_count_draft_has_no_ledger
    CHECK (status <> 'DRAFT' OR (number IS NULL AND entry_id IS NULL))
);
ALTER TABLE cash_counts ADD CONSTRAINT cash_counts_account_company
  FOREIGN KEY(account_id,company_id) REFERENCES accounts(id,company_id) ON DELETE RESTRICT;
ALTER TABLE cash_counts ADD CONSTRAINT cash_counts_outlet_company
  FOREIGN KEY(outlet_id,company_id) REFERENCES outlets(id,company_id) ON DELETE RESTRICT;
ALTER TABLE cash_counts ADD CONSTRAINT cash_counts_entry_company
  FOREIGN KEY(entry_id,company_id) REFERENCES journal_entries(id,company_id) ON DELETE RESTRICT;
CREATE INDEX cash_counts_company_date ON cash_counts(company_id,date);

CREATE FUNCTION protect_cash_counts() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status='POSTED' THEN RAISE EXCEPTION 'A posted cash count is permanent; correct it with a later count'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status='POSTED' THEN RAISE EXCEPTION 'A posted cash count is permanent; correct it with a later count'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'A cash count keeps its identity and company';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER protect_cash_counts BEFORE UPDATE OR DELETE ON cash_counts
FOR EACH ROW EXECUTE FUNCTION protect_cash_counts();

-- One movement between two group companies. Both companies' entries are written
-- in the same transaction; the database refuses a posted row that has only one.
CREATE TABLE intercompany_transfers (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  counterparty_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('PAY_ON_BEHALF','RECEIVE_ON_BEHALF','TRANSFER')),
  number text,
  date date NOT NULL,
  amount numeric(18,4) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  settlement_account_id uuid NOT NULL,
  counterparty_account_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','CANCELLED')),
  entry_id uuid,
  counterparty_entry_id uuid,
  reversal_entry_id uuid,
  counterparty_reversal_entry_id uuid,
  cancel_reason text,
  approval_operation_key uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  UNIQUE(id,company_id),
  UNIQUE(company_id,number),
  UNIQUE(company_id,entry_id),
  UNIQUE(counterparty_company_id,counterparty_entry_id),
  -- A company never settles with itself through the group accounts.
  CONSTRAINT intercompany_two_companies CHECK (company_id <> counterparty_company_id),
  CONSTRAINT intercompany_reason_written CHECK (length(btrim(reason)) >= 10),
  -- Neither side of a posted movement can exist without the other.
  CONSTRAINT intercompany_posted_has_both_sides
    CHECK (status = 'DRAFT' OR (number IS NOT NULL AND entry_id IS NOT NULL AND counterparty_entry_id IS NOT NULL)),
  CONSTRAINT intercompany_draft_has_no_ledger
    CHECK (status <> 'DRAFT' OR (number IS NULL AND entry_id IS NULL AND counterparty_entry_id IS NULL)),
  CONSTRAINT intercompany_cancelled_reverses_both_sides
    CHECK (status <> 'CANCELLED' OR (reversal_entry_id IS NOT NULL AND counterparty_reversal_entry_id IS NOT NULL
      AND cancel_reason IS NOT NULL AND length(btrim(cancel_reason)) >= 10)),
  CONSTRAINT intercompany_uncancelled_has_no_reversal
    CHECK (status = 'CANCELLED' OR (reversal_entry_id IS NULL AND counterparty_reversal_entry_id IS NULL))
);
ALTER TABLE intercompany_transfers ADD CONSTRAINT intercompany_settlement_account_company
  FOREIGN KEY(settlement_account_id,company_id) REFERENCES accounts(id,company_id) ON DELETE RESTRICT;
ALTER TABLE intercompany_transfers ADD CONSTRAINT intercompany_counterparty_account_company
  FOREIGN KEY(counterparty_account_id,counterparty_company_id) REFERENCES accounts(id,company_id) ON DELETE RESTRICT;
ALTER TABLE intercompany_transfers ADD CONSTRAINT intercompany_entry_company
  FOREIGN KEY(entry_id,company_id) REFERENCES journal_entries(id,company_id) ON DELETE RESTRICT;
ALTER TABLE intercompany_transfers ADD CONSTRAINT intercompany_counterparty_entry_company
  FOREIGN KEY(counterparty_entry_id,counterparty_company_id) REFERENCES journal_entries(id,company_id) ON DELETE RESTRICT;
ALTER TABLE intercompany_transfers ADD CONSTRAINT intercompany_reversal_entry_company
  FOREIGN KEY(reversal_entry_id,company_id) REFERENCES journal_entries(id,company_id) ON DELETE RESTRICT;
ALTER TABLE intercompany_transfers ADD CONSTRAINT intercompany_counterparty_reversal_entry_company
  FOREIGN KEY(counterparty_reversal_entry_id,counterparty_company_id) REFERENCES journal_entries(id,company_id) ON DELETE RESTRICT;
CREATE INDEX intercompany_company_date ON intercompany_transfers(company_id,date,status);
CREATE INDEX intercompany_counterparty_date ON intercompany_transfers(counterparty_company_id,date,status);

CREATE FUNCTION protect_intercompany_transfers() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status<>'DRAFT' THEN RAISE EXCEPTION 'A posted intercompany movement is permanent; cancel it instead'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status='CANCELLED' THEN RAISE EXCEPTION 'A cancelled intercompany movement is permanent'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.counterparty_company_id IS DISTINCT FROM OLD.counterparty_company_id THEN
    RAISE EXCEPTION 'An intercompany movement keeps both of its companies';
  END IF;
  IF OLD.status='POSTED' THEN
    IF NEW.status NOT IN ('POSTED','CANCELLED') THEN RAISE EXCEPTION 'A posted intercompany movement can only be cancelled'; END IF;
    IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.date IS DISTINCT FROM OLD.date OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.number IS DISTINCT FROM OLD.number OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.settlement_account_id IS DISTINCT FROM OLD.settlement_account_id
       OR NEW.counterparty_account_id IS DISTINCT FROM OLD.counterparty_account_id
       OR NEW.entry_id IS DISTINCT FROM OLD.entry_id OR NEW.counterparty_entry_id IS DISTINCT FROM OLD.counterparty_entry_id THEN
      RAISE EXCEPTION 'A posted intercompany movement and both its entries are permanent';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER protect_intercompany_transfers BEFORE UPDATE OR DELETE ON intercompany_transfers
FOR EACH ROW EXECUTE FUNCTION protect_intercompany_transfers();

-- Number series for the two new documents, for every company that already has books.
INSERT INTO number_series(id,company_id,doc_type,prefix,format,padding,updated_at)
SELECT gen_random_uuid(),c.id,t.doc_type,c.code,'{PREFIX}/{TYPE}/{FY}/{NUMBER}',4,now()
FROM companies c CROSS JOIN (VALUES ('CC'),('ICT')) AS t(doc_type)
WHERE c.deleted_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM number_series n WHERE n.company_id=c.id AND n.doc_type=t.doc_type AND n.deleted_at IS NULL);

-- A cash difference above the company's threshold needs an independent approval,
-- and every intercompany movement is approved unless the user holds both companies.
INSERT INTO approval_rules(id,company_id,doc_type,action,approver_permission_code,threshold_amount,updated_at)
SELECT gen_random_uuid(),c.id,'CASH_DIFFERENCE','post','accounts.approval.approve',0,now()
FROM companies c WHERE c.deleted_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM approval_rules r WHERE r.company_id=c.id AND r.doc_type='CASH_DIFFERENCE' AND r.deleted_at IS NULL);
INSERT INTO approval_rules(id,company_id,doc_type,action,approver_permission_code,threshold_amount,updated_at)
SELECT gen_random_uuid(),c.id,'INTERCOMPANY','post','accounts.approval.approve',NULL,now()
FROM companies c WHERE c.deleted_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM approval_rules r WHERE r.company_id=c.id AND r.doc_type='INTERCOMPANY' AND r.deleted_at IS NULL);

INSERT INTO permissions(code,description) VALUES
  ('accounts.cashcount.read','Read cash counts'),
  ('accounts.cashcount.create','Record cash counts'),
  ('accounts.cashcount.post','Post cash counts'),
  ('accounts.intercompany.read','Read intercompany movements'),
  ('accounts.intercompany.create','Record intercompany movements'),
  ('accounts.intercompany.post','Post intercompany movements'),
  ('accounts.intercompany.cancel','Cancel intercompany movements')
  ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(id,company_id,role_id,permission_code,updated_at)
SELECT gen_random_uuid(),r.company_id,r.id,p.code,now() FROM roles r CROSS JOIN permissions p
WHERE r.is_system AND r.deleted_at IS NULL AND
  ((r.name IN ('Owner','Admin','Accountant') AND p.code IN
      ('accounts.cashcount.read','accounts.cashcount.create','accounts.cashcount.post',
       'accounts.intercompany.read','accounts.intercompany.create','accounts.intercompany.post','accounts.intercompany.cancel')) OR
   (r.name='Viewer' AND p.code IN ('accounts.cashcount.read','accounts.intercompany.read')))
ON CONFLICT DO NOTHING;
