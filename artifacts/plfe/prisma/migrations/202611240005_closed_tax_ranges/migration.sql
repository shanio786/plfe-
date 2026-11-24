BEGIN;
-- Safe narrowing is needed to introduce a future version. Reopening a closed,
-- used range is different: it would reuse an old approval/version for new dates.
CREATE FUNCTION plfe_guard_closed_tax_range() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.effective_to IS NOT NULL AND
    (NEW.effective_to IS NULL OR NEW.effective_to>OLD.effective_to) AND
    plfe_tax_version_used(OLD.company_id,OLD.id) THEN
    RAISE EXCEPTION 'Used closed tax ranges cannot be extended; create a new version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_closed_range_guard BEFORE UPDATE ON taxes
FOR EACH ROW EXECUTE FUNCTION plfe_guard_closed_tax_range();
COMMIT;
