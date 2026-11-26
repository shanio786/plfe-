-- Events. The expo itself becomes a tag that income and direct costs carry, so
-- profit per expo is read from the ledger instead of assembled by hand. The
-- event columns already existed on every line; this gives them something real
-- to point at, and the database now refuses a tag that is not a real event.

CREATE TABLE events (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  city text,
  venue text,
  edition integer,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','OPEN','RUNNING','CLOSED','CANCELLED')),
  budget_income numeric(18,4) NOT NULL DEFAULT 0,
  budget_cost numeric(18,4) NOT NULL DEFAULT 0,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  UNIQUE(id,company_id),
  UNIQUE(company_id,code),
  CHECK (code <> '' AND name <> ''),
  CHECK (end_date >= start_date),
  CHECK (budget_income >= 0 AND budget_cost >= 0),
  CHECK (edition IS NULL OR edition > 0)
);
CREATE INDEX events_company_status ON events(company_id,status,start_date);
CREATE UNIQUE INDEX events_company_code_ci ON events(company_id,lower(code));

-- The tag columns have been on these tables since the accounts core; they were
-- deliberately left without a foreign key until the events module existed.
ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_event_fkey
  FOREIGN KEY(event_id,company_id) REFERENCES events(id,company_id) ON DELETE RESTRICT;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_event_fkey
  FOREIGN KEY(event_id,company_id) REFERENCES events(id,company_id) ON DELETE RESTRICT;
ALTER TABLE bill_lines ADD CONSTRAINT bill_lines_event_fkey
  FOREIGN KEY(event_id,company_id) REFERENCES events(id,company_id) ON DELETE RESTRICT;
ALTER TABLE payments ADD CONSTRAINT payments_event_fkey
  FOREIGN KEY(event_id,company_id) REFERENCES events(id,company_id) ON DELETE RESTRICT;

-- An event that already carries posted amounts keeps its identity: renumbering
-- or re-dating it would silently move money between expos.
CREATE FUNCTION protect_events() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE tagged boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Events are retained; cancel or deactivate instead'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'An event keeps its identity and code';
  END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    RAISE EXCEPTION 'An event is cancelled or deactivated, never removed';
  END IF;
  IF NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
    SELECT EXISTS(
      SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.company_id=l.company_id
      WHERE l.event_id=OLD.id AND l.deleted_at IS NULL AND e.deleted_at IS NULL AND e.status='POSTED')
      INTO tagged;
    IF tagged THEN RAISE EXCEPTION 'This event already carries posted amounts; its dates are part of that record'; END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER protect_events BEFORE UPDATE OR DELETE ON events
FOR EACH ROW EXECUTE FUNCTION protect_events();

-- A cancelled event must not collect anything further.
CREATE FUNCTION plfe_guard_event_tag() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE state text;
BEGIN
  IF NEW.event_id IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO state FROM events WHERE id=NEW.event_id AND company_id=NEW.company_id AND deleted_at IS NULL;
  IF state IS NULL THEN RAISE EXCEPTION 'Tag an event of this company'; END IF;
  IF state='CANCELLED' THEN RAISE EXCEPTION 'A cancelled event cannot be tagged on new amounts'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER journal_line_event_tag BEFORE INSERT OR UPDATE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION plfe_guard_event_tag();
CREATE TRIGGER invoice_line_event_tag BEFORE INSERT OR UPDATE ON invoice_lines
FOR EACH ROW EXECUTE FUNCTION plfe_guard_event_tag();
CREATE TRIGGER bill_line_event_tag BEFORE INSERT OR UPDATE ON bill_lines
FOR EACH ROW EXECUTE FUNCTION plfe_guard_event_tag();
CREATE TRIGGER payment_event_tag BEFORE INSERT OR UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION plfe_guard_event_tag();

INSERT INTO permissions(code,description) VALUES
  ('accounts.event.read','Read events'),
  ('accounts.event.create','Create events'),
  ('accounts.event.update','Update events')
  ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(id,company_id,role_id,permission_code,updated_at)
SELECT gen_random_uuid(),r.company_id,r.id,p.code,now() FROM roles r CROSS JOIN permissions p
WHERE r.is_system AND r.deleted_at IS NULL AND
  ((r.name IN ('Owner','Admin','Accountant') AND p.code IN ('accounts.event.read','accounts.event.create','accounts.event.update')) OR
   (r.name='Viewer' AND p.code='accounts.event.read'))
ON CONFLICT DO NOTHING;
