BEGIN;
ALTER TABLE parties ADD COLUMN linked_company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
CREATE INDEX parties_company_identity ON parties(company_id,linked_company_id);
ALTER TABLE payments ADD COLUMN duplicate_evidence jsonb,
  ADD COLUMN duplicate_confirmed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN duplicate_confirmed_at timestamptz,
  ADD COLUMN duplicate_note text,
  ADD CONSTRAINT payment_duplicate_evidence CHECK(
    (duplicate_evidence IS NULL AND duplicate_confirmed_by IS NULL AND duplicate_confirmed_at IS NULL AND duplicate_note IS NULL)
    OR (duplicate_evidence IS NOT NULL AND duplicate_confirmed_by IS NOT NULL AND duplicate_confirmed_at IS NOT NULL
      AND duplicate_note IS NOT NULL AND length(btrim(duplicate_note))>=10 AND jsonb_typeof(duplicate_evidence)='object'));
CREATE INDEX payments_duplicate_window ON payments(company_id,party_id,amount,date)
  WHERE deleted_at IS NULL AND status<>'CANCELLED';
CREATE INDEX invoices_party_history ON invoices(company_id,party_id,status);
CREATE INDEX bills_party_history ON bills(company_id,party_id,status);
CREATE INDEX journal_lines_party_history ON journal_lines(company_id,party_id) WHERE party_id IS NOT NULL;
CREATE FUNCTION plfe_guard_party_company_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.linked_company_id IS NOT NULL AND NEW.linked_company_id IS DISTINCT FROM OLD.linked_company_id AND
    (EXISTS(SELECT 1 FROM invoices WHERE company_id=OLD.company_id AND party_id=OLD.id AND status IN ('POSTED','CANCELLED')) OR
     EXISTS(SELECT 1 FROM bills WHERE company_id=OLD.company_id AND party_id=OLD.id AND status IN ('POSTED','CANCELLED')) OR
     EXISTS(SELECT 1 FROM payments WHERE company_id=OLD.company_id AND party_id=OLD.id AND status IN ('POSTED','CANCELLED')) OR
     EXISTS(SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.company_id=l.company_id
       WHERE l.company_id=OLD.company_id AND l.party_id=OLD.id AND e.status IN ('POSTED','CANCELLED'))) THEN
    RAISE EXCEPTION 'A used party company identity is permanent; create a separate party for a different legal identity' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER party_company_identity_guard BEFORE UPDATE ON parties
FOR EACH ROW EXECUTE FUNCTION plfe_guard_party_company_identity();
COMMIT;
