-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parent_id" UUID,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "is_bank" BOOLEAN NOT NULL DEFAULT false,
    "is_cash" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "ntn" TEXT,
    "address" TEXT,
    "credit_days" INTEGER NOT NULL DEFAULT 0,
    "is_customer" BOOLEAN NOT NULL DEFAULT true,
    "is_supplier" BOOLEAN NOT NULL DEFAULT false,
    "is_exhibitor" BOOLEAN NOT NULL DEFAULT false,
    "is_sponsor" BOOLEAN NOT NULL DEFAULT false,
    "is_staff" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "opening_balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "opening_side" TEXT NOT NULL DEFAULT 'RECEIVABLE',
    "opening_entry_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journals" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "fiscal_year_id" UUID,
    "number" TEXT,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'JOURNAL',
    "narration" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "reversal_of_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "party_id" UUID,
    "event_id" UUID,
    "outlet_id" UUID,
    "department_id" UUID,
    "memo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INVOICE',
    "original_id" UUID,
    "number" TEXT,
    "date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "narration" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "entry_id" UUID,
    "reversal_entry_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "tax_id" UUID,
    "event_id" UUID,
    "outlet_id" UUID,
    "department_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BILL',
    "original_id" UUID,
    "number" TEXT,
    "date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "narration" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "entry_id" UUID,
    "reversal_entry_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "tax_id" UUID,
    "event_id" UUID,
    "outlet_id" UUID,
    "department_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "number" TEXT,
    "date" DATE NOT NULL,
    "settlement_account_id" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "narration" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "department_id" UUID,
    "event_id" UUID,
    "outlet_id" UUID,
    "entry_id" UUID,
    "reversal_entry_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID,
    "bill_id" UUID,
    "amount" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "receivable_account_id" UUID NOT NULL,
    "payable_account_id" UUID NOT NULL,
    "opening_equity_account_id" UUID NOT NULL,
    "sales_journal_id" UUID NOT NULL,
    "purchase_journal_id" UUID NOT NULL,
    "general_journal_id" UUID NOT NULL,
    "cash_journal_id" UUID NOT NULL,
    "bank_journal_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "accounting_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_company_id_deleted_at_idx" ON "departments"("company_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "departments_id_company_id_key" ON "departments"("id", "company_id");

-- CreateIndex
CREATE INDEX "accounts_company_id_parent_id_idx" ON "accounts"("company_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_id_company_id_key" ON "accounts"("id", "company_id");

-- CreateIndex
CREATE INDEX "parties_company_id_deleted_at_idx" ON "parties"("company_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "parties_id_company_id_key" ON "parties"("id", "company_id");

-- CreateIndex
CREATE INDEX "journals_company_id_deleted_at_idx" ON "journals"("company_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "journals_id_company_id_key" ON "journals"("id", "company_id");

-- CreateIndex
CREATE INDEX "journal_entries_company_id_date_status_idx" ON "journal_entries"("company_id", "date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_id_company_id_key" ON "journal_entries"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_company_id_number_key" ON "journal_entries"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_company_id_source_type_source_id_key" ON "journal_entries"("company_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_company_id_reversal_of_id_key" ON "journal_entries"("company_id", "reversal_of_id");

-- CreateIndex
CREATE INDEX "journal_lines_company_id_account_id_idx" ON "journal_lines"("company_id", "account_id");

-- CreateIndex
CREATE INDEX "journal_lines_company_id_party_id_idx" ON "journal_lines"("company_id", "party_id");

-- CreateIndex
CREATE INDEX "journal_lines_company_id_event_id_outlet_id_department_id_idx" ON "journal_lines"("company_id", "event_id", "outlet_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_id_company_id_key" ON "journal_lines"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_company_id_entry_id_line_no_key" ON "journal_lines"("company_id", "entry_id", "line_no");

-- CreateIndex
CREATE INDEX "invoices_company_id_date_status_idx" ON "invoices"("company_id", "date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_id_company_id_key" ON "invoices"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_company_id_number_key" ON "invoices"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_company_id_entry_id_key" ON "invoices"("company_id", "entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_id_company_id_key" ON "invoice_lines"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_company_id_invoice_id_line_no_key" ON "invoice_lines"("company_id", "invoice_id", "line_no");

-- CreateIndex
CREATE INDEX "bills_company_id_date_status_idx" ON "bills"("company_id", "date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bills_id_company_id_key" ON "bills"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "bills_company_id_number_key" ON "bills"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "bills_company_id_entry_id_key" ON "bills"("company_id", "entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_lines_id_company_id_key" ON "bill_lines"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_lines_company_id_bill_id_line_no_key" ON "bill_lines"("company_id", "bill_id", "line_no");

-- CreateIndex
CREATE INDEX "payments_company_id_date_status_idx" ON "payments"("company_id", "date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_company_id_key" ON "payments"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_company_id_number_key" ON "payments"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "payments_company_id_entry_id_key" ON "payments"("company_id", "entry_id");

-- CreateIndex
CREATE INDEX "payment_allocations_company_id_payment_id_idx" ON "payment_allocations"("company_id", "payment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_company_id_invoice_id_bill_id_idx" ON "payment_allocations"("company_id", "invoice_id", "bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_id_company_id_key" ON "payment_allocations"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_settings_company_id_key" ON "accounting_settings"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_settings_id_company_id_key" ON "accounting_settings"("id", "company_id");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_company_id_fkey" FOREIGN KEY ("parent_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_opening_entry_id_company_id_fkey" FOREIGN KEY ("opening_entry_id", "company_id") REFERENCES "journal_entries"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_journal_id_company_id_fkey" FOREIGN KEY ("journal_id", "company_id") REFERENCES "journals"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscal_year_id_company_id_fkey" FOREIGN KEY ("fiscal_year_id", "company_id") REFERENCES "fiscal_years"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_id_company_id_fkey" FOREIGN KEY ("reversal_of_id", "company_id") REFERENCES "journal_entries"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_company_id_fkey" FOREIGN KEY ("entry_id", "company_id") REFERENCES "journal_entries"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_party_id_company_id_fkey" FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_party_id_company_id_fkey" FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_original_id_company_id_fkey" FOREIGN KEY ("original_id", "company_id") REFERENCES "invoices"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entry_id_company_id_fkey" FOREIGN KEY ("entry_id", "company_id") REFERENCES "journal_entries"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reversal_entry_id_company_id_fkey" FOREIGN KEY ("reversal_entry_id", "company_id") REFERENCES "journal_entries"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_company_id_fkey" FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_party_id_company_id_fkey" FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_original_id_company_id_fkey" FOREIGN KEY ("original_id", "company_id") REFERENCES "bills"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_entry_id_company_id_fkey" FOREIGN KEY ("entry_id", "company_id") REFERENCES "journal_entries"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_reversal_entry_id_company_id_fkey" FOREIGN KEY ("reversal_entry_id", "company_id") REFERENCES "journal_entries"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_id_company_id_fkey" FOREIGN KEY ("bill_id", "company_id") REFERENCES "bills"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_id_company_id_fkey" FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_settlement_account_id_company_id_fkey" FOREIGN KEY ("settlement_account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_entry_id_company_id_fkey" FOREIGN KEY ("entry_id", "company_id") REFERENCES "journal_entries"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversal_entry_id_company_id_fkey" FOREIGN KEY ("reversal_entry_id", "company_id") REFERENCES "journal_entries"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_company_id_fkey" FOREIGN KEY ("payment_id", "company_id") REFERENCES "payments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_company_id_fkey" FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_bill_id_company_id_fkey" FOREIGN KEY ("bill_id", "company_id") REFERENCES "bills"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_receivable_account_id_company_id_fkey" FOREIGN KEY ("receivable_account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_payable_account_id_company_id_fkey" FOREIGN KEY ("payable_account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_opening_equity_account_id_company_id_fkey" FOREIGN KEY ("opening_equity_account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_sales_journal_id_company_id_fkey" FOREIGN KEY ("sales_journal_id", "company_id") REFERENCES "journals"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_purchase_journal_id_company_id_fkey" FOREIGN KEY ("purchase_journal_id", "company_id") REFERENCES "journals"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_general_journal_id_company_id_fkey" FOREIGN KEY ("general_journal_id", "company_id") REFERENCES "journals"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_cash_journal_id_company_id_fkey" FOREIGN KEY ("cash_journal_id", "company_id") REFERENCES "journals"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_bank_journal_id_company_id_fkey" FOREIGN KEY ("bank_journal_id", "company_id") REFERENCES "journals"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 2 only. Event/outlet and tax identities intentionally have no FK until
-- their owning modules exist; department is already a company-bound dimension.
CREATE UNIQUE INDEX accounts_active_code ON accounts(company_id,lower(code)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX parties_active_code ON parties(company_id,lower(code)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX departments_active_code ON departments(company_id,lower(code)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX journals_active_code ON journals(company_id,lower(code)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX allocations_active_invoice ON payment_allocations(company_id,payment_id,invoice_id) WHERE deleted_at IS NULL AND invoice_id IS NOT NULL;
CREATE UNIQUE INDEX allocations_active_bill ON payment_allocations(company_id,payment_id,bill_id) WHERE deleted_at IS NULL AND bill_id IS NOT NULL;
ALTER TABLE accounts ADD CONSTRAINT account_type CHECK(type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE'));
ALTER TABLE accounts ADD CONSTRAINT account_flags CHECK(NOT(is_cash AND is_bank) AND (NOT(is_cash OR is_bank) OR (type='ASSET' AND NOT is_group)) AND parent_id IS DISTINCT FROM id);
ALTER TABLE parties ADD CONSTRAINT party_flags CHECK(is_customer OR is_supplier OR is_exhibitor OR is_sponsor OR is_staff);
ALTER TABLE parties ADD CONSTRAINT party_opening CHECK(opening_balance>=0 AND opening_side IN ('RECEIVABLE','PAYABLE') AND credit_days BETWEEN 0 AND 3650);
ALTER TABLE journals ADD CONSTRAINT journal_type CHECK(type IN ('SALES','PURCHASE','BANK','CASH','GENERAL'));
ALTER TABLE journal_entries ADD CONSTRAINT entry_state CHECK(status IN ('DRAFT','POSTED') AND (status='DRAFT' OR (number IS NOT NULL AND fiscal_year_id IS NOT NULL AND deleted_at IS NULL)));
ALTER TABLE journal_lines ADD CONSTRAINT line_amount CHECK(debit>=0 AND credit>=0 AND ((debit>0 AND credit=0) OR (credit>0 AND debit=0)));
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_line_amount CHECK(qty>0 AND rate>=0 AND total>=0);
ALTER TABLE bill_lines ADD CONSTRAINT bill_line_amount CHECK(qty>0 AND rate>=0 AND total>=0);
ALTER TABLE invoices ADD CONSTRAINT invoice_state CHECK(kind IN ('INVOICE','CREDIT_NOTE') AND status IN ('DRAFT','POSTED','CANCELLED') AND due_date>=date AND subtotal>=0 AND tax_total>=0 AND total=subtotal+tax_total AND (kind='INVOICE' OR original_id IS NOT NULL) AND (status='DRAFT' OR (entry_id IS NOT NULL AND number IS NOT NULL AND total>0 AND deleted_at IS NULL)) AND (status<>'CANCELLED' OR reversal_entry_id IS NOT NULL));
ALTER TABLE bills ADD CONSTRAINT bill_state CHECK(kind IN ('BILL','DEBIT_NOTE') AND status IN ('DRAFT','POSTED','CANCELLED') AND due_date>=date AND subtotal>=0 AND tax_total>=0 AND total=subtotal+tax_total AND (kind='BILL' OR original_id IS NOT NULL) AND (status='DRAFT' OR (entry_id IS NOT NULL AND number IS NOT NULL AND total>0 AND deleted_at IS NULL)) AND (status<>'CANCELLED' OR reversal_entry_id IS NOT NULL));
ALTER TABLE payments ADD CONSTRAINT payment_state CHECK(direction IN ('RECEIPT','PAYMENT') AND method IN ('CASH','BANK') AND status IN ('DRAFT','POSTED','CANCELLED') AND amount>0 AND (status='DRAFT' OR (entry_id IS NOT NULL AND number IS NOT NULL AND deleted_at IS NULL)) AND (status<>'CANCELLED' OR reversal_entry_id IS NOT NULL));
ALTER TABLE payment_allocations ADD CONSTRAINT allocation_target CHECK(amount>0 AND ((invoice_id IS NOT NULL)::int+(bill_id IS NOT NULL)::int)=1);

CREATE FUNCTION plfe_guard_posted_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='POSTED' THEN
    RAISE EXCEPTION 'Posted journal entries are immutable; post a reversal' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id,NEW.company_id) IS DISTINCT FROM (OLD.id,OLD.company_id) THEN
    RAISE EXCEPTION 'Journal identity and company cannot change' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_posted_entry BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION plfe_guard_posted_entry();

CREATE FUNCTION plfe_guard_journal_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid; cid uuid; entry_status text;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.entry_id,NEW.company_id,NEW.id) IS DISTINCT FROM (OLD.entry_id,OLD.company_id,OLD.id) THEN
    RAISE EXCEPTION 'Journal line ownership cannot change' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN eid:=OLD.entry_id; cid:=OLD.company_id;
  ELSE eid:=NEW.entry_id; cid:=NEW.company_id; END IF;
  -- The parent lock serializes line mutation against concurrent posting.
  SELECT status INTO entry_status FROM journal_entries WHERE id=eid AND company_id=cid FOR UPDATE;
  IF entry_status='POSTED' THEN
    RAISE EXCEPTION 'Posted journal lines are immutable; post a reversal' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_posted_line BEFORE INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION plfe_guard_journal_line();

CREATE FUNCTION plfe_assert_posted_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid; cid uuid; e journal_entries%ROWTYPE; count_lines bigint; dr numeric; cr numeric;
BEGIN
  IF TG_TABLE_NAME='journal_entries' THEN
    IF TG_OP='DELETE' THEN eid:=OLD.id;cid:=OLD.company_id; ELSE eid:=NEW.id;cid:=NEW.company_id; END IF;
  ELSE
    IF TG_OP='DELETE' THEN eid:=OLD.entry_id;cid:=OLD.company_id; ELSE eid:=NEW.entry_id;cid:=NEW.company_id; END IF;
  END IF;
  SELECT * INTO e FROM journal_entries WHERE id=eid AND company_id=cid;
  IF NOT FOUND OR e.status<>'POSTED' THEN RETURN NULL; END IF;
  SELECT count(*),coalesce(sum(debit),0),coalesce(sum(credit),0) INTO count_lines,dr,cr
    FROM journal_lines WHERE company_id=cid AND entry_id=eid AND deleted_at IS NULL;
  IF count_lines<2 OR dr<>cr OR dr<=0 THEN
    RAISE EXCEPTION 'Posted journal entry % does not balance: debit %, credit %',eid,dr,cr USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM fiscal_years y JOIN periods p ON p.company_id=y.company_id AND p.fiscal_year_id=y.id
      JOIN companies c ON c.id=y.company_id
      WHERE y.company_id=cid AND y.id=e.fiscal_year_id AND y.deleted_at IS NULL AND NOT y.is_closed
      AND p.deleted_at IS NULL AND NOT p.is_closed AND e.date BETWEEN p.start_date AND p.end_date
      AND e.date BETWEEN y.start_date AND y.end_date AND (c.lock_date IS NULL OR e.date>c.lock_date)) THEN
    RAISE EXCEPTION 'Posting requires an open financial year and period' USING ERRCODE='23514';
  END IF;
  IF e.reversal_of_id IS NOT NULL THEN
    IF e.kind<>'REVERSAL' OR e.source_type<>'REVERSAL' OR e.source_id<>e.reversal_of_id OR
      NOT EXISTS(SELECT 1 FROM journal_entries WHERE company_id=cid AND id=e.reversal_of_id AND status='POSTED' AND reversal_of_id IS NULL) THEN
      RAISE EXCEPTION 'Invalid reversal source' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM
        (SELECT * FROM journal_lines WHERE company_id=cid AND entry_id=e.reversal_of_id AND deleted_at IS NULL) o
        FULL JOIN
        (SELECT * FROM journal_lines WHERE company_id=cid AND entry_id=eid AND deleted_at IS NULL) r USING(line_no)
      WHERE o.id IS NULL OR r.id IS NULL OR
        (o.account_id,o.party_id,o.event_id,o.outlet_id,o.department_id,o.debit,o.credit)
          IS DISTINCT FROM (r.account_id,r.party_id,r.event_id,r.outlet_id,r.department_id,r.credit,r.debit)
    ) THEN RAISE EXCEPTION 'Reversal must exactly mirror original lines and dimensions' USING ERRCODE='23514'; END IF;
  ELSIF e.kind='REVERSAL' THEN
    RAISE EXCEPTION 'Reversal requires its original entry' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
-- Both parent and children must trigger validation: checking lines alone misses
-- empty entries; checking parents alone misses direct SQL line changes.
CREATE CONSTRAINT TRIGGER journal_entry_balances AFTER INSERT OR UPDATE OR DELETE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION plfe_assert_posted_balance();
CREATE CONSTRAINT TRIGGER journal_lines_balance AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION plfe_assert_posted_balance();

CREATE FUNCTION plfe_guard_posted_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.company_id,NEW.id) IS DISTINCT FROM (OLD.company_id,OLD.id) THEN
    RAISE EXCEPTION 'Document ownership cannot change' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('POSTED','CANCELLED') THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Posted documents cannot be deleted' USING ERRCODE='23514'; END IF;
    IF OLD.status='CANCELLED' OR NEW.status NOT IN ('POSTED','CANCELLED') OR
      (to_jsonb(NEW)-ARRAY['status','reversal_entry_id','version','updated_at','updated_by'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reversal_entry_id','version','updated_at','updated_by']) OR
      (NEW.status='POSTED' AND NEW.reversal_entry_id IS DISTINCT FROM OLD.reversal_entry_id) THEN
      RAISE EXCEPTION 'Posted financial fields cannot change; cancel by reversal' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_immutable BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION plfe_guard_posted_document();
CREATE TRIGGER bill_immutable BEFORE UPDATE OR DELETE ON bills FOR EACH ROW EXECUTE FUNCTION plfe_guard_posted_document();
CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION plfe_guard_posted_document();

CREATE FUNCTION plfe_guard_document_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; cid uuid; s text;
BEGIN
  IF TG_OP='DELETE' THEN cid:=OLD.company_id;
    IF TG_TABLE_NAME='invoice_lines' THEN parent_id:=OLD.invoice_id; ELSE parent_id:=OLD.bill_id; END IF;
  ELSE cid:=NEW.company_id;
    IF TG_TABLE_NAME='invoice_lines' THEN parent_id:=NEW.invoice_id; ELSE parent_id:=NEW.bill_id; END IF;
  END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)->>'company_id',to_jsonb(NEW)->>'invoice_id',to_jsonb(NEW)->>'bill_id')
    IS DISTINCT FROM (to_jsonb(OLD)->>'company_id',to_jsonb(OLD)->>'invoice_id',to_jsonb(OLD)->>'bill_id') THEN
    RAISE EXCEPTION 'Document line ownership cannot change' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='invoice_lines' THEN SELECT status INTO s FROM invoices WHERE company_id=cid AND id=parent_id FOR UPDATE;
  ELSE SELECT status INTO s FROM bills WHERE company_id=cid AND id=parent_id FOR UPDATE; END IF;
  IF s IN ('POSTED','CANCELLED') THEN RAISE EXCEPTION 'Posted document lines are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_line_immutable BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION plfe_guard_document_line();
CREATE TRIGGER bill_line_immutable BEFORE INSERT OR UPDATE OR DELETE ON bill_lines FOR EACH ROW EXECUTE FUNCTION plfe_guard_document_line();

CREATE FUNCTION plfe_document_entry_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record; expected_type text;
BEGIN
  -- Fetch final state, not the intermediate NEW captured before posting.
  EXECUTE format('SELECT * FROM %I WHERE id=$1 AND company_id=$2',TG_TABLE_NAME) INTO d USING NEW.id,NEW.company_id;
  IF d.id IS NULL OR d.status='DRAFT' THEN RETURN NULL; END IF;
  expected_type:=CASE TG_TABLE_NAME WHEN 'invoices' THEN 'INVOICE' WHEN 'bills' THEN 'BILL' ELSE 'PAYMENT' END;
  IF NOT EXISTS(SELECT 1 FROM journal_entries WHERE company_id=d.company_id AND id=d.entry_id AND status='POSTED' AND source_type=expected_type AND source_id=d.id) THEN
    RAISE EXCEPTION 'Posted document must link its own posted entry' USING ERRCODE='23514';
  END IF;
  IF d.status='CANCELLED' AND NOT EXISTS(SELECT 1 FROM journal_entries WHERE company_id=d.company_id AND id=d.reversal_entry_id AND status='POSTED' AND reversal_of_id=d.entry_id) THEN
    RAISE EXCEPTION 'Cancelled document requires its own posted reversal' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER invoice_entry_link AFTER INSERT OR UPDATE ON invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION plfe_document_entry_link();
CREATE CONSTRAINT TRIGGER bill_entry_link AFTER INSERT OR UPDATE ON bills DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION plfe_document_entry_link();
CREATE CONSTRAINT TRIGGER payment_entry_link AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION plfe_document_entry_link();

CREATE FUNCTION plfe_no_accounting_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Accounting history cannot be truncated' USING ERRCODE='23514'; END $$;
CREATE TRIGGER entries_no_truncate BEFORE TRUNCATE ON journal_entries FOR EACH STATEMENT EXECUTE FUNCTION plfe_no_accounting_truncate();
CREATE TRIGGER lines_no_truncate BEFORE TRUNCATE ON journal_lines FOR EACH STATEMENT EXECUTE FUNCTION plfe_no_accounting_truncate();
CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON invoices FOR EACH STATEMENT EXECUTE FUNCTION plfe_no_accounting_truncate();
CREATE TRIGGER invoice_lines_no_truncate BEFORE TRUNCATE ON invoice_lines FOR EACH STATEMENT EXECUTE FUNCTION plfe_no_accounting_truncate();
CREATE TRIGGER bills_no_truncate BEFORE TRUNCATE ON bills FOR EACH STATEMENT EXECUTE FUNCTION plfe_no_accounting_truncate();
CREATE TRIGGER bill_lines_no_truncate BEFORE TRUNCATE ON bill_lines FOR EACH STATEMENT EXECUTE FUNCTION plfe_no_accounting_truncate();
CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON payments FOR EACH STATEMENT EXECUTE FUNCTION plfe_no_accounting_truncate();
