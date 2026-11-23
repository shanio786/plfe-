-- Active-only business keys. UUID identity keys and foreign-key targets remain
-- globally/compositely unique even for archived rows.
CREATE UNIQUE INDEX companies_code_active ON companies (lower(code)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_email_active ON users (lower(email)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX branches_code_active ON branches (company_id, lower(code)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX roles_name_active ON roles (company_id, lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX series_type_active ON number_series (company_id, doc_type) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX fiscal_name_active ON fiscal_years (company_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX fiscal_start_active ON fiscal_years (company_id, start_date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX periods_start_active ON periods (company_id, fiscal_year_id, start_date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX sequence_type_year_active ON sequences (company_id, doc_type, fiscal_year_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX approval_rule_active ON approval_rules (company_id, doc_type, action) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX attachment_path_active ON attachments (company_id, file_path) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX approval_pending_unique ON approvals (company_id, doc_type, doc_id, action) WHERE status='PENDING' AND deleted_at IS NULL;

ALTER TABLE companies ADD CONSTRAINT company_month CHECK (fy_start_month BETWEEN 1 AND 12);
ALTER TABLE companies ADD CONSTRAINT currency_upper CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE users ADD CONSTRAINT email_normalized CHECK (email=lower(trim(email)));
ALTER TABLE users ADD CONSTRAINT login_count CHECK (failed_logins>=0);
ALTER TABLE branches ADD CONSTRAINT branch_type CHECK (type IN ('OFFICE','SHOWROOM','WAREHOUSE','EVENT_SITE'));
ALTER TABLE number_series ADD CONSTRAINT series_padding CHECK (padding BETWEEN 1 AND 12);
ALTER TABLE number_series ADD CONSTRAINT series_number_token CHECK (position('{NUMBER}' IN format)>0);
ALTER TABLE sequences ADD CONSTRAINT sequence_count CHECK (next_number>0 AND padding BETWEEN 1 AND 12);
ALTER TABLE fiscal_years ADD CONSTRAINT fiscal_dates CHECK (start_date<end_date);
ALTER TABLE periods ADD CONSTRAINT period_dates CHECK (start_date<=end_date);
ALTER TABLE approval_rules ADD CONSTRAINT approval_threshold CHECK (threshold_amount IS NULL OR threshold_amount>=0);
ALTER TABLE attachments ADD CONSTRAINT attachment_size CHECK (size>=0);
ALTER TABLE sessions ADD CONSTRAINT session_dates CHECK (last_seen_at>=created_at AND expires_at>created_at);
ALTER TABLE approvals ADD CONSTRAINT approval_status CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED'));
ALTER TABLE approvals ADD CONSTRAINT approval_not_self CHECK (decided_by IS NULL OR decided_by<>requested_by);
ALTER TABLE approvals ADD CONSTRAINT approval_decision CHECK (
  (status IN ('PENDING','CANCELLED') AND decided_by IS NULL AND decided_at IS NULL AND executed_at IS NULL)
  OR (status='REJECTED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND executed_at IS NULL)
  OR (status='APPROVED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND executed_at IS NOT NULL)
);
ALTER TABLE audit_logs ADD CONSTRAINT audit_company_scope CHECK (
  company_id IS NOT NULL OR action IN ('LOGIN','LOGIN_FAILED','LOGOUT','PASSWORD_CHANGE','SYSTEM')
);
ALTER TABLE companies ADD CONSTRAINT company_logo_scope
  FOREIGN KEY (logo_attachment_id,id) REFERENCES attachments(id,company_id) ON DELETE RESTRICT;

-- Audit actor columns deliberately remain scalar in Prisma. These SQL foreign
-- keys protect all actor references without a large web of unused ORM relations.
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['companies','users','branches','roles','role_permissions','user_company_roles','fiscal_years','periods','number_series','sequences','approval_rules','approvals','attachments']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT',tbl,tbl||'_created_actor');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT',tbl,tbl||'_updated_actor');
  END LOOP;
END $$;

CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit records are immutable'; END $$;
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

CREATE FUNCTION protect_last_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(71007100);
  IF OLD.is_owner AND OLD.active AND OLD.deleted_at IS NULL THEN
    IF TG_OP='DELETE' OR NOT NEW.is_owner OR NOT NEW.active OR NEW.deleted_at IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM users WHERE id<>OLD.id AND is_owner AND active AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Cannot remove the last active Owner';
      END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER last_owner_guard BEFORE UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION protect_last_owner();

CREATE FUNCTION validate_fiscal_range() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,2));
  IF NEW.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM fiscal_years WHERE company_id=NEW.company_id AND id<>NEW.id
      AND deleted_at IS NULL AND start_date<=NEW.end_date AND end_date>=NEW.start_date
  ) THEN RAISE EXCEPTION 'Financial years cannot overlap'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fiscal_range_guard BEFORE INSERT OR UPDATE ON fiscal_years FOR EACH ROW EXECUTE FUNCTION validate_fiscal_range();

CREATE FUNCTION validate_period_range() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent fiscal_years%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,2));
  SELECT * INTO parent FROM fiscal_years WHERE id=NEW.fiscal_year_id AND company_id=NEW.company_id;
  IF NOT FOUND OR parent.deleted_at IS NOT NULL OR NEW.start_date<parent.start_date OR NEW.end_date>parent.end_date THEN
    RAISE EXCEPTION 'Period must lie inside its company financial year';
  END IF;
  IF NEW.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM periods WHERE company_id=NEW.company_id AND id<>NEW.id
      AND deleted_at IS NULL AND start_date<=NEW.end_date AND end_date>=NEW.start_date
  ) THEN RAISE EXCEPTION 'Periods cannot overlap'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER period_range_guard BEFORE INSERT OR UPDATE ON periods FOR EACH ROW EXECUTE FUNCTION validate_period_range();
