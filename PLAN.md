# PLFE Business System — Build Plan for Replit

Build one Next.js and PostgreSQL system in nine phases, with Accounts as the base that Events, POS, HR and the Website all post into. Give Replit one phase at a time, and keep every choice plain and standard so the whole thing moves onto your own VPS with one Docker Compose file.

## Scope

One web system, on our own VPS, that does the work the group is doing in Odoo today: books, expos, showrooms, staff and the public websites. One login, one database, five working sections.

| Section | What it does |
| --- | --- |
| Accounts | Separate books for every company. Invoices, bills, payments, vouchers, tax, reports. The base all other sections post into. |
| Events and Expos | One record per expo. Booths, bookings, exhibitors, visitor registration, cost and profit for that expo. |
| Point of Sale | A fast sale screen for furniture showrooms. Products, services, quotations, returns, shift close, stock per showroom. |
| HR and Payroll | Staff records, attendance, leave, monthly salary, payslips, loans. |
| Website | The public sites are edited from inside the system. Expo pages and registration forms come from live event data. |

Five rules shape the whole build. Every later section follows them.

1. **Many companies, one system.** A company can be added at any time. Each one keeps its own books, its own document numbers and its own showrooms. The owner can look across all of them; other users cannot.
2. **Role decides what a user sees.** A user is given one or more roles, and each role is given companies plus permissions. An accountant of one company sees nothing of another company.
3. **Money is entered once.** A POS sale, a booth invoice or a salary run creates its own accounting entry by itself. Nobody re-types it in Accounts.
4. **Every amount carries tags.** Company, event and showroom sit on every ledger line. That is what makes profit per expo, profit per showroom and expo-against-expo comparison possible from one set of books.
5. **Modules, not one big program.** Each section is a separate folder with its own screens and its own database tables, on shared foundations. A new section later is an addition, not a rewrite.

Size warning, worth saying before any code is written: this is five business systems, not one project. Build and go live section by section, in the order in this plan. Accounts and one expo first, POS next, HR last.

## Ground rules and stack

The system will be built on Replit but will live on our own VPS. So nothing Replit-only may enter the code. Every item below is a hard rule, not a preference.

| Layer | Use this | Never use |
| --- | --- | --- |
| Framework | Next.js 15 with the App Router, TypeScript everywhere | Two separate apps, or any Vercel-only feature |
| Database | PostgreSQL 16, plain SQL features only | Replit DB, Supabase client, Firebase, SQLite |
| Database access | Prisma ORM with migration files committed to the repo | Hand-written schema changes, `db push` on production |
| Login | Auth.js (NextAuth) with email and password, sessions stored in a database table | Replit Auth, Clerk, Auth0, or any paid login service |
| Passwords | argon2 or bcrypt hash, never stored or logged in plain text | Any home-made hashing |
| Screens | Tailwind CSS with shadcn/ui components, TanStack Table for lists | A second design system, heavy UI kits |
| Forms and checks | react-hook-form with zod schemas shared by screen and server | Checking only in the browser |
| Money | PostgreSQL `numeric(18,4)`, read as Prisma Decimal, maths with decimal.js | JavaScript numbers for any amount |
| Files | A folder on disk at `UPLOAD_DIR`, served by an API route that checks permission | Replit object storage, a public folder, Google Drive |
| Scheduled work | One small worker process with node-cron, started beside the app | Replit scheduled deployments, external cron services |
| Excel | exceljs, for both import and export | CSV only |
| PDF | A print-ready HTML page per document plus Puppeteer on the server for saved PDFs | A paid PDF service |
| Reports | SQL queries and database views | Loading all rows and totalling them in JavaScript |
| Settings | A `.env` file read at start, with a full `.env.example` in the repo | Values typed into the code, Replit Secrets as the only copy |

More rules that decide how the code is written:

- The whole system must start with `npm run build` and then `npm start`, behind Nginx, with no Replit service running. If something only works inside Replit, it is wrong.
- Store all times in UTC. Show them in Asia/Karachi. Show dates as `23-11-2026`. Default currency PKR, with the currency kept per company.
- All screen text comes from one labels file, so Urdu can be added later without touching screens.
- No business logic inside React components. Every write goes through a service function that takes the user, checks permission, opens one database transaction, writes, and records the audit log.
- The database enforces the rules too: foreign keys, unique indexes, not-null, and a check that every journal entry has debit equal to credit.
- Every list screen has server-side search, filter, sort, paging and an Excel export. Build one shared table component and reuse it.
- Every money document has a status: draft, posted, cancelled. A posted document is never edited. It is reversed, and the reversal is visible.

Folder layout to follow from the first commit:

```markdown
/app
  /(portal)/[company]/accounts | events | pos | hr | admin
  /(site)/...                 public website pages
  /api/...                    upload, webhook, print, public forms
/modules
  /core  /accounts  /events  /pos  /hr  /cms
     model.ts  service.ts  schema.ts  queries.ts  components/
/lib        db, auth, permissions, money, numbering, audit, pdf, excel
/prisma     schema.prisma, migrations/, seed.ts
/docs       setup.md, modules.md, backup.md
```

## Architecture

```
Website  <-->  Events and Expos      Point of Sale      HR and Payroll
                   |                      |                  |
             invoices, costs         shift close          payroll
                   v                      v                  v
   Accounts: one ledger for every company (lines tagged company, event, outlet, department)
   Foundation: companies, users, roles, permissions, numbering, approvals, audit log, files
```

Events, POS and HR each post their money into the one Accounts ledger. The website sends registrations and enquiries into Events and posts no money itself. Everything sits on the shared foundation.

## Foundation (built first, used by every section)

This part carries no business value on its own, and every other section breaks without it. It is Phase 1 and it must be finished properly before Accounts starts.

**Companies.** A company is added from the admin screen: name, legal name, NTN, STRN, address, phone, email, logo, currency, financial year start month, and its own document number prefixes. A company has branches or outlets under it. The header has a company switcher, and the chosen company is part of the URL so a link always opens the right books.

**Company separation.** Every table that holds business data has a `company_id` column. No query may run without it. Put that filter in one place in the data layer so a screen cannot forget it.

**Users and roles.** A user has a name, email, password, phone, photo, active flag. A user is linked to one or more companies, and in each company is given a role. So the same person can be an accountant in one company and a viewer in another. Roles that ship ready-made: Owner, Admin, Accountant, Event Manager, HR, Cashier, Showroom Manager, Viewer.

**Permissions.** A permission is a short code, `module.object.action`, for example `accounts.invoice.create`, `pos.sale.refund`, `events.booth.book`. A role is a list of these codes, and the list is editable, so a new role can be made without new code. Permission is checked in the service function on the server, not only by hiding a button.

**Document numbers.** A counter per company, per document type, per financial year. Format is set per company, for example `PLFE/INV/26-27/0001`. The number is taken inside the same database transaction that saves the document, so two users can never get the same number.

**Financial year and locking.** Financial years with periods, and a lock date per company. Once a month is closed, nobody below Admin can post into it.

**Audit log.** Every create, change, cancel, approve, login and failed login is written with user, time, company, table, record, the values before and after, and the IP address. There is a screen to search it. Nothing in the audit log can be deleted or edited.

**Approvals.** Some actions wait for someone else: cancelling a posted document, a POS return, a refund, and a payment above a limit set per company. The request shows in an approvals list for the people whose role allows it. The action happens only after approval, and both steps are in the audit log.

**Attachments.** Any document can carry files: scanned bills, booth contracts, salary sheets, cheque images. Files are stored outside the database, with the link, size, type and uploader kept in a table.

**Login safety.** Password rules, lock after a number of failed attempts, session timeout, forced password change for a new user, and a password reset by an Admin. Keep a place in the user table for two-step login to be added later.

## Accounts

Accounts is the base of the system. It is real double-entry: every document creates a journal entry where debit equals credit, and the database refuses an entry that does not balance.

**Chart of accounts.** One chart per company, as a tree with codes and groups, under the five types: asset, liability, equity, income, expense. A ready-made expo chart is seeded for a new company and can then be edited: booth rent income, sponsorship income, showroom sales, venue rent, stall fabrication, labour, event staff, marketing, printing, utilities, salaries, rent, and so on.

**Parties.** One parties table for customers, suppliers, exhibitors, sponsors and staff, with flags for what each one is. Fields: name, company name, phone, email, city, NTN, address, credit days, opening balance. An exhibitor added for an expo is the same party the invoice is raised on, so the history stays in one place.

**Documents to build, each one posting its own entry:**

- Sales invoice and credit note
- Purchase bill and debit note
- Receipt (money in) and payment (money out)
- Cash voucher and bank voucher
- Bank-to-cash and cash-to-bank transfer
- Expense entry, with a bill attached
- Journal voucher, for corrections and the opening balance

**Payment against invoice.** A receipt can be split across several invoices, part-paid or taken in advance. The invoice then shows paid, part-paid or outstanding. Advance money sits as a party balance until it is applied.

**Cheques.** A cheque register for cheques given and received, with cheque number, bank, date, due date and status: pending, deposited, cleared or bounced. A post-dated cheque is visible before its date, and clearing it posts the bank entry.

**Petty cash.** A cash box per branch and per event, topped up from the bank, spent against expense heads, with a closing count. This is what the expo site team actually uses.

**Tax.** Sales tax on invoice lines with the rate kept per item and per company, including provincial rates. Withholding tax deducted on supplier payments, with the amount held in a payable account. Reports for output tax, input tax, and tax deducted by party for the period.

**Tags on every ledger line — the most important design decision.** Each journal line carries, besides the account: company, event, outlet or showroom, and department. These tags are what produce profit per expo and profit per showroom out of the same books, with no separate books per event. Build them in from the first migration; adding them later means re-doing every report.

**Budget.** A budget per company and per event, by account, for the period. Reports compare budget against actual, showing the difference and the percentage.

**Reports.** Each one takes a date range, a company, and optional event, outlet and party filters. Each one exports to Excel and PDF, and every figure can be clicked to reach the documents behind it.

| Report | Shows |
| --- | --- |
| Trial balance | Every account with debit and credit totals and the closing balance |
| Profit and loss | Income less expense, for the period, by group, with a column per event when asked |
| Balance sheet | Assets, liabilities and equity as on a date |
| General ledger and account ledger | Every entry in an account with a running balance |
| Party ledger | One customer's or supplier's full history and outstanding balance |
| Aging | Receivables and payables in 0-30, 31-60, 61-90 and 90-plus day buckets |
| Cash and bank book | Money in and out per cash box and per bank account, with closing balance |
| Day book | Every entry posted on a day, across all documents |
| Tax reports | Output tax, input tax, and withholding tax by party |
| Event profit | Income and expense by category for one expo, with budget beside actual |
| Event comparison | Several expos side by side: revenue, cost, profit, profit percentage |
| Group summary | All companies in one view, for the Owner role only |

## Events and Expos

This is the section the business actually runs on, so it gets the most detail. Every expo is one record that holds its booths, its bookings, its visitors, its costs and its profit. Expos never mix, and any two of them can be compared.

**Where event profit lives.** An event's profit and loss is calculated in Accounts, from the ledger lines tagged with that event. The Events section stores no money totals of its own. Its dashboard and reports only read the Accounts figures, so the two can never disagree.

**Event record.** Name, code, company it belongs to, city, venue, halls, start and end date, setup and closing dates, status (planned, open for booking, live, closed), logo and banner, target revenue, and total budget. Creating an event also creates its tag in Accounts, so costs can be booked against it from day one. A calendar screen shows the year's expos across all cities.

**Booths.** A booth list per event: hall, booth number, size in square feet, type (premium, standard, corner, island), rate, and status (available, held, booked, blocked). Booths can be created in bulk from a pattern, and copied from last year's event of the same city. A floor plan image is uploaded per hall and booth positions are marked on it, so the plan shows at a glance what is sold, held and open.

**Exhibitors and booking.** An exhibitor is a party. Booking flow: pick exhibitor, pick one or more booths, agree the rate, add discount, save the booking. The booking then creates a sales invoice in Accounts with the event tag, and an instalment plan if asked, for example advance plus two instalments with dates. Receipts come in against that invoice. Cancellation needs approval and frees the booths. A booth can be transferred to another exhibitor, keeping the history.

**Sponsors.** Sponsorship packages with a price and a list of what was promised, as a checklist that gets ticked off. The sponsor invoice posts to the event in the same way as a booth invoice.

**Sales follow-up.** A simple pipeline for booth selling: lead, contacted, quotation sent, booked, lost. Each lead has the staff member it belongs to, the next follow-up date, and notes. The day's follow-up list is the screen the sales team opens every morning.

**Visitor registration.** A public form for each live or upcoming event, on the website, asking name, phone, city, email, interest and how they heard about the expo. Each registration gets a code and a QR image, sent back on screen and by email or WhatsApp link. Rules: the same phone number is not registered twice for one event, and the form is protected against bots. At the gate, a staff phone opens a scan page, scans the QR, and marks the visitor present with the time and gate name. Walk-in visitors are registered at the gate on the same screen. Registrations arrive in the event record live while the expo is running, which is the behaviour asked for.

**Event costs.** Expenses are entered against the event under fixed categories, so every expo is costed the same way and comparison is meaningful.

| Cost category | Typical items |
| --- | --- |
| Venue | Hall rent, security deposit, extra days |
| Construction | Stall fabrication, panels, carpeting, branding boards |
| Labour | Daily wage workers, loading, setup and removal |
| Staff | Event staff salary, overtime, travel, hotel, food |
| Marketing | Banners, radio and digital ads, influencers, printing |
| Utilities and services | Electricity, generator, internet, cleaning, security |
| Hospitality | Catering, refreshments, guest arrangements |
| Transport | Goods transport, vehicle rent, fuel |
| Other | Permits, fees, miscellaneous |

**Event income.** Booth rent, sponsorship, ticket money if any, and commission from food or service stalls. All of it is tagged to the event.

**Event dashboard.** Booths booked against total and the value of each, revenue invoiced against money received against outstanding, expense by category against budget, visitor count by day, and profit as it stands today. Every number clicks through to its documents.

**Comparing events.** Pick any two or more expos, from any cities or years, and see revenue, cost by category, visitors, profit and profit percentage side by side, plus revenue per square foot, cost per visitor and booth occupancy percentage. This is the report that tells which city and which format is worth repeating.

**Closing an event.** When the expo is over and all bills are in, the event is closed: its final profit and loss is saved, and new costs cannot be posted to it without an Admin reopening it.

## Point of Sale

Built for furniture showrooms, where a sale is often an advance booking with delivery later, not a quick counter purchase. Every company can have as many outlets as it wants, and each outlet can have more than one counter.

**Outlets and counters.** An outlet belongs to a company and has its own name, address, stock, cash box, receipt header and number series. A counter is a till inside an outlet, and a cashier is logged in to one counter at a time.

**Items.** Four kinds, all in one catalogue:

- Stock products, with code, barcode, category, brand, unit, cost, retail price and tax rate
- Variants of a product, for size, fabric and colour, each with its own barcode and stock
- Service items, such as delivery, assembly, polish or a design fee, which carry no stock
- Free-text lines, for a custom order written by hand with size and fabric notes

**Prices and discounts.** A price list per outlet, a maximum discount percentage per role, and a reason required when the limit is crossed. Anything over the limit waits for manager approval.

**Stock.** Stock is held per outlet, not per company. Movements: opening entry, purchase received, transfer from another outlet, sale out, return in, and adjustment with a reason and approval. Reports show stock on hand, stock value, items below minimum, and slow movers.

**Sale screen.** One screen, keyboard first, so a barcode scanner and a numeric keypad are enough. Search by name, code or barcode; change quantity; line discount and bill discount; attach a customer by phone number and a salesman to the bill. Payment can be cash, card, bank transfer, credit, or an adjustment of an advance already paid, and can be split across two of them. Print on an 80mm thermal receipt or A4. A bill can be held and picked up again.

**Furniture-specific flows:**

- **Advance booking.** Customer pays part, the goods are reserved, a delivery date is set, and the balance is taken at delivery. The balance shows as outstanding until then.
- **Quotation.** Made on the same screen, printed, and later turned into a sale or a booking with one click.
- **Delivery.** A delivery note per booking, with status pending or delivered, driver and vehicle, and the customer's signature captured as a scan or photo.
- **Return.** Only against the original bill, needs manager approval, and refunds as cash or as a credit note for later use.

**Shift close.** A cashier opens a shift with the opening cash, sells, and closes with the counted cash. The screen shows expected cash, counted cash and the difference, and the close posts the day's sales and the cash position into Accounts.

**Reports.** Daily sales summary per outlet and per counter, sales by item, category and salesman, payment-mode summary, discount report, returns, pending deliveries, and outstanding advances.

**Built for offline later.** A sale is saved by one API call that carries an id made on the device, so the same sale is never written twice. Offline selling is not in version one, but this makes it an addition rather than a rebuild.

## HR and Payroll

Staff are kept per company, but one person can be moved to another company and keep their history. Payroll is run per company each month and posts to Accounts by itself.

**Employee record.** Employee code, name, father's name, CNIC, date of birth, phone, address, emergency contact, photo, company, branch, department, designation, reporting manager, joining date, employment type (permanent, contract, daily wage), bank account for salary, and status (active, on notice, left). Documents are attached to the record, such as the contract, CNIC copy and degrees, with an expiry date where one applies and an alert before it.

**Attendance.** Three ways in, all landing in one attendance table:

- Mobile check-in and check-out from the staff member's phone, with time and location
- Import of the file exported by the biometric machine, matched on employee code
- Manual entry or correction by HR, which goes in the audit log

Rules set per company: office timing, grace minutes, late count, half day, and overtime. The monthly sheet shows present, absent, late, leave and overtime per person.

**Leave.** Leave types with a yearly allowance (annual, casual, sick, unpaid). A staff member requests leave, the manager approves or rejects it, and the balance updates. A team calendar shows who is away.

**Salary structure.** Basic pay plus allowances (house rent, utilities, conveyance, mobile, other), and deductions (absence, late, loan instalment, advance, income tax, EOBI, other). The structure is set per employee and can change from a given month, keeping the old one for history.

**Monthly payroll.** HR opens a run for a company and month. The system pulls attendance, leave, loans and the salary structure, and works out gross pay, deductions, income tax and net pay per person. HR checks, adjusts with a reason, then an approver posts it. Posting creates the salary entry in Accounts. The run then gives payslips as PDF, a bank transfer sheet in Excel, and a payroll register.

**Loans and advances.** Request, approval, amount, and an instalment plan that is taken off salary each month until it is cleared.

**Event staff.** Staff can be assigned to an expo for its dates. Their allowance and travel for those dates, and the share of salary if chosen, carry the event tag, so staff cost shows up in that event's profit and loss.

**Reports.** Attendance summary, leave balances, payroll register, salary cost by department and by company, income tax deducted, EOBI statement, and loans outstanding.

## Website

The public websites run from the same Next.js app and are edited from inside the portal. One editor can drive several sites, so the PLFE site and any other brand site can be added as separate sites with their own domain, look and content.

**Sites.** A site record holds its domain, name, logo, colours, fonts, menus, footer, social links, and its analytics and Meta Pixel IDs. The app reads the incoming domain and serves that site's pages. A new site is added from the admin screen, with no new code.

**Pages and blocks.** A page is a list of blocks that staff can add, reorder, edit and remove: hero banner, text, image, gallery, cards, call to action, video, FAQ, client logos, testimonials, map, contact form, events list, booth enquiry form, exhibitor directory. Each page has a draft and a published version, and a preview link before publishing.

**Media library.** One place for images and files, with folders and search. Images are resized on upload into the sizes the site needs.

**Pages built from live data:**

- An upcoming expos list and a past expos list, filled from the events table
- A page per expo, made by itself when the event is set to show online: dates, venue, map, floor plan, brochure, sponsors, exhibitors, gallery
- The visitor registration form, which writes straight into that event's visitor list
- A booth enquiry form, which creates a lead in the sales pipeline for that event
- An exhibitor directory, from confirmed bookings, shown only when the exhibitor agrees

**Other content.** News or blog posts, photo galleries per expo, team, clients, about, careers and contact pages.

**Forms.** Every form submission lands in a portal inbox with the site and page it came from, sends an email to the set address, and has spam protection. No submission is lost if the email fails.

**Search engines.** A title, description, link and share image per page, a sitemap and robots file per site, clean links like `/expos/lahore-2027`, and event markup so expos can appear in Google's event results.

**Speed.** Pages are built ahead of time and refreshed only when staff publish a change or event data changes. Target: the home page loads in under 2 seconds on a phone on 4G.

## How every section posts into Accounts

Each event in another section creates exactly one journal entry, through one shared posting service in `/lib/posting`. No section writes ledger lines directly. The accounts used come from a settings screen per company, so the accountant can change them without code.

| When this happens | Debit | Credit | Tags on the lines |
| --- | --- | --- | --- |
| Booth booking invoiced | Exhibitor receivable | Booth rent income, sales tax payable | Event |
| Sponsor invoiced | Sponsor receivable | Sponsorship income, sales tax payable | Event |
| Instalment received | Bank or cash | Exhibitor receivable | Event |
| Event expense entered | Expense account of the cost category, input tax | Bank, cash, petty cash or supplier payable | Event, department |
| Supplier paid with tax deducted | Supplier payable | Bank, withholding tax payable | Event if the bill had one |
| POS shift closed | Cash, card clearing, bank, customer receivable | Sales income, sales tax payable | Outlet |
| Cost of goods sold, same close | Cost of goods sold | Stock | Outlet |
| POS advance booking taken | Cash or bank | Customer advances (liability) | Outlet |
| Booking delivered | Customer advances, receivable for the balance | Sales income, sales tax payable | Outlet |
| POS return approved | Sales returns, sales tax payable | Cash or customer credit | Outlet |
| Stock transfer between outlets | Stock, receiving outlet | Stock, sending outlet | Outlet on each line |
| Payroll posted | Salary expense by department, allowances | Salaries payable, income tax payable, EOBI payable, staff loans | Department, event for event staff |
| Salaries paid | Salaries payable | Bank | Department |
| Staff loan given | Staff loans (asset) | Bank or cash | Department |

Three rules for the posting service:

1. The document and its journal entry are saved in the same database transaction. If either fails, neither is saved.
2. Every journal entry keeps a link back to the document that made it, and the document keeps a link to its entry. Clicking either opens the other.
3. Cancelling a document never deletes its entry. It posts a reversing entry dated on the cancel day, inside an open period.

## Database tables

The full list of tables for version one, by module. Every business table also has `id` (UUID), `company_id`, `created_at`, `created_by`, `updated_at`, `updated_by` and `deleted_at`. Those common columns are left out below.

| Module | Table | Key fields |
| --- | --- | --- |
| Core | companies | name, legal\_name, ntn, strn, currency, fy\_start\_month, logo, address |
| Core | branches | name, type (office, showroom, warehouse, event\_site), address |
| Core | users | name, email, password\_hash, phone, active, must\_change\_password, failed\_logins |
| Core | roles | name, description, is\_system |
| Core | role\_permissions | role\_id, permission\_code |
| Core | user\_company\_roles | user\_id, company\_id, role\_id |
| Core | sessions | user\_id, token, expires\_at, ip, device |
| Core | sequences | doc\_type, fiscal\_year\_id, prefix, next\_number |
| Core | fiscal\_years, periods | start, end, is\_closed; lock\_date on companies |
| Core | approvals | doc\_type, doc\_id, action, requested\_by, status, decided\_by, note |
| Core | attachments | doc\_type, doc\_id, file\_path, name, size, mime |
| Core | audit\_logs | user\_id, action, table\_name, record\_id, before\_json, after\_json, ip |
| Accounts | accounts | code, name, type, parent\_id, is\_group, is\_bank, is\_cash |
| Accounts | parties | name, kind flags, phone, email, ntn, city, credit\_days |
| Accounts | journals | code, name, type (sales, purchase, bank, cash, pos, payroll, general) |
| Accounts | journal\_entries | journal\_id, number, date, narration, status, source\_type, source\_id |
| Accounts | journal\_lines | entry\_id, account\_id, debit, credit, party\_id, event\_id, outlet\_id, department\_id, memo |
| Accounts | invoices, invoice\_lines | party\_id, number, date, due\_date, status, totals; item, qty, rate, tax\_id, event\_id |
| Accounts | bills, bill\_lines | same shape as invoices, for suppliers |
| Accounts | payments, payment\_allocations | party\_id, direction, method, amount, bank\_account\_id; payment\_id, document, amount |
| Accounts | cheques | number, bank, date, due\_date, amount, direction, status |
| Accounts | taxes | name, kind (sales, withholding), rate, account\_id |
| Accounts | budgets, budget\_lines | event\_id, period; account\_id, amount |
| Events | events | code, name, city, venue, start\_date, end\_date, status, target\_revenue, show\_online |
| Events | halls | event\_id, name, floor\_plan\_file |
| Events | booths | event\_id, hall\_id, number, size\_sqft, type, rate, status, plan\_x, plan\_y, plan\_w, plan\_h |
| Events | bookings, booking\_booths | event\_id, party\_id, total, discount, status, invoice\_id; booking\_id, booth\_id, rate |
| Events | instalments | booking\_id, due\_date, amount, paid\_amount |
| Events | sponsors, sponsor\_items | event\_id, party\_id, package, amount; promised item, done |
| Events | leads, lead\_activities | event\_id, name, phone, stage, owner\_id, next\_follow\_up; note, type, date |
| Events | visitors | event\_id, name, phone, email, city, interest, source, qr\_code, registered\_at |
| Events | checkins | visitor\_id, gate, checked\_in\_at, by\_user\_id |
| Events | expense\_categories | name, account\_id, sort |
| POS | outlets, counters | branch\_id, name, price\_list\_id, receipt\_header; outlet\_id, name |
| POS | products, product\_variants | code, name, category\_id, kind (stock, service), tax\_id; barcode, size, fabric, colour, cost, price |
| POS | categories, price\_lists, price\_list\_items | standard catalogue tables |
| POS | stock\_moves | variant\_id, outlet\_id, qty, kind, ref\_type, ref\_id, unit\_cost |
| POS | stock\_levels | variant\_id, outlet\_id, qty\_on\_hand (kept by the moves) |
| POS | shifts | counter\_id, user\_id, opened\_at, opening\_cash, closed\_at, counted\_cash, expected\_cash |
| POS | sales, sale\_lines, sale\_payments | number, kind (sale, quotation, booking, return), customer\_id, salesman\_id, status, client\_uuid |
| POS | deliveries | sale\_id, date, status, driver, vehicle, signature\_file |
| HR | departments, designations | name |
| HR | employees, employee\_documents | code, names, cnic, joining\_date, department\_id, status, bank\_account |
| HR | attendance | employee\_id, date, check\_in, check\_out, source, status |
| HR | leave\_types, leave\_requests, leave\_balances | standard leave tables |
| HR | salary\_structures, salary\_components | employee\_id, from\_month; component, amount, kind |
| HR | payroll\_runs, payslips, payslip\_lines | company, month, status, entry\_id; employee, gross, net |
| HR | loans, loan\_instalments | employee\_id, amount, start\_month; month, amount, deducted |
| HR | event\_assignments | employee\_id, event\_id, from, to, allowance |
| Website | sites | domain, name, theme\_json, menus\_json, analytics\_id, pixel\_id |
| Website | pages, page\_versions | site\_id, slug, title, seo\_json; blocks\_json, status, published\_at |
| Website | posts, media, form\_submissions | site posts; files; form, payload\_json, site\_id, handled |

## Roles and permissions

These are the starting roles. Each one is only a list of permission codes, so the Admin can change it or make a new role from the screen. A role always applies inside the companies the user was given, never outside them.

| Role | Accounts | Events | POS | HR | Website | Admin |
| --- | --- | --- | --- | --- | --- | --- |
| Owner | Full, all companies, group summary | Full | Full | Full | Full | Full |
| Admin | Full | Full | Full | Full | Full | Users, roles, settings |
| Accountant | Full except closing periods | View, add expenses | View sales and shifts | View payroll, post it | None | None |
| Event Manager | View event profit only | Full for own events | None | View staff assigned | Edit event pages | None |
| Sales Executive | None | Own leads, bookings, view booths | None | Own leave and attendance | None | None |
| HR | None | None | None | Full | Careers page | None |
| Showroom Manager | View own outlet reports | None | Full for own outlet, approve returns and discounts | Own team's attendance | None | None |
| Cashier | None | None | Sale screen and own shift, own counter | Own leave and attendance | None | None |
| Gate Staff | None | Visitor scan and walk-in only | None | None | None | None |
| Web Editor | None | None | None | None | Pages, media, posts | None |
| Viewer | View reports | View | View reports | None | None | None |

Three checks happen on every request, on the server:

1. Is the user logged in and active?
2. Does the user have a role in this company?
3. Does that role hold the permission code for this action? For outlet and event roles, is this their outlet or their event?

## Build order

Nine phases, each one finished, tested and put on the VPS before the next starts. The order follows what depends on what: nothing can post money until Accounts exists, and the website's expo pages need the events tables.

| Phase | What gets built | Done when this test passes |
| --- | --- | --- |
| 1. Foundation | Login, companies, branches, users, roles, permissions, company switcher, numbering, audit log, approvals, attachments, shared list table, Excel export. First deploy to the VPS. | Two companies exist. A user with a role in only one cannot open the other by changing the URL. Every change shows in the audit log. The app runs on the VPS. |
| 2. Accounts core | Chart of accounts with seeded expo chart, parties, journals, journal voucher, invoices, bills, receipts, payments with allocation, cash and bank vouchers, posting service, trial balance and ledgers. | Post 20 mixed documents. Trial balance balances. A part-paid invoice shows the right outstanding. A cancelled invoice shows a reversal, not a deletion. |
| 3. Accounts complete | Cheques, petty cash, sales tax and withholding tax, budgets, P&L, balance sheet, aging, cash and bank book, day book, tax reports, PDF print of every document, period lock. | The accountant reproduces last month's PLFE figures from Odoo and they match to the rupee. |
| 4. Events | Events, calendar, halls, booths, floor plan, bookings with invoice and instalments, sponsors, leads pipeline, event expenses by category, event dashboard, event P&L, event comparison, event close. | Load one past expo with its real booths, bookings and costs. Its profit matches the figure the team already knows. Compare it with a second expo. |
| 5. Visitor registration | Public registration form, QR code, confirmation, gate scan page, walk-in entry, live visitor count, duplicate check, bot protection. | 200 test registrations, scanned on two phones at once, each one checked in only once, counts correct on the dashboard. |
| 6. Website | Sites by domain, page builder blocks, media library, menus, expo pages from data, booth enquiry to leads, exhibitor directory, forms inbox, SEO files, publish and refresh. | The PLFE site is rebuilt in the editor by a staff member without help, and scores 90 or above on Google PageSpeed for mobile. |
| 7. Point of Sale | Outlets, counters, products and variants, services, price lists, stock moves and transfers, sale screen, quotation, advance booking, delivery, return with approval, shift open and close, POS reports, posting. | A cashier runs a full day on a test outlet with a barcode scanner and thermal printer. Shift close matches counted cash, and the day appears correctly in Accounts. |
| 8. HR and Payroll | Employees, documents, attendance (mobile, file import, manual), leave, salary structures, payroll run, payslips, loans, event staff, HR reports, posting. | Last month's real payroll for one company is run in the system and every net salary matches the sheet HR used. |
| 9. Go-live | Owner dashboard across companies, Odoo data import, backups and restore test, speed checks, security review, user guides, training. | A restore from last night's backup works on a fresh server. Each team signs off its own section. |

Two working rules for every phase:

- Run each phase's test with real data, not sample data, before moving on.
- After each phase, check the code with Claude Code before deploying: security, company separation, and anything Replit-only that slipped in.

## Prompts to paste into Replit

Replit does better work with a plan saved inside the project than with one huge message. So first export this doc as Markdown and save it in the Replit project as `docs/PLAN.md`. Then paste the prompts below, one phase at a time, and only start the next phase when the test for the last one passes.

**Prompt 0 — start of the project (paste once):**

```markdown
You are building a business management system that replaces Odoo for a group of companies. The full plan is in docs/PLAN.md. Read the whole file before writing any code, and follow it exactly.

Hard rules:
- Next.js 15 App Router, TypeScript, PostgreSQL 16, Prisma with committed migrations, Auth.js with email and password, Tailwind and shadcn/ui.
- Nothing Replit-specific: no Replit DB, no Replit Auth, no Replit object storage. The app must run on a normal Linux VPS with `npm run build` and `npm start` behind Nginx.
- Every setting comes from .env. Keep .env.example complete.
- Money is numeric(18,4) in the database and Decimal in code. Never JavaScript numbers for money.
- Every business table has company_id. Every query is filtered by company in the data layer.
- All writes go through service functions that check permission, use one transaction, and write the audit log.
- Follow the folder layout in the "Ground rules and stack" section.

Do not build any phase yet. First reply with: the Prisma schema for Phase 1 only, the list of screens for Phase 1, and any question about the plan. Wait for my go-ahead.
```

**Prompt for each phase (change the phase number and name):**

```markdown
Build Phase 2 (Accounts core) from docs/PLAN.md. Read the sections "Accounts", "How every section posts into Accounts", "Database tables" and "Roles and permissions" again first.

1. Write the Prisma migration for this phase's tables only.
2. Write the service functions, with permission checks, transactions and audit log.
3. Build the screens, using the shared list table and form components from Phase 1.
4. Add seed data for two companies so I can test.
5. Write automated tests for the money rules: entries balance, numbers never repeat, a user cannot see another company.
6. Update docs/modules.md with what was built.

When done, tell me how to run the test listed for this phase in the "Build order" table, and list anything you could not finish.
```

**When Replit goes off track (paste as needed):**

```markdown
Stop. Re-read docs/PLAN.md, section "<section name>". What you built does not match it in this way: <what is wrong>. Fix only that. Do not change other features. Show me the files you changed.
```

## Moving from Replit to the VPS

The code lives in a GitHub repository from day one, with Replit linked to it. The VPS pulls from that repository. Replit is only the place where the code is written, never the place where the business runs.

**Server.** Ubuntu 24.04 LTS, at least 4 CPU cores, 8 GB RAM and 160 GB SSD for the start, with room to grow as POS and visitor data add up.

**What runs on it,** all from one `docker-compose.yml` kept in the repo:

| Service | Job |
| --- | --- |
| app | The Next.js portal and websites, built in production mode |
| worker | Scheduled jobs: backups, reminders, report e-mails |
| postgres | PostgreSQL 16, its data on a named volume, not reachable from the internet |
| nginx | Takes all domains, adds HTTPS through Let's Encrypt, passes to the app |

**Deploy steps,** written in `docs/setup.md` so any developer can follow them:

1. Install Docker and Docker Compose, open only ports 22, 80 and 443 in the firewall, and turn off password login over SSH.
2. Clone the repository, copy `.env.example` to `.env`, and fill in the real values.
3. Run `docker compose up -d`, then run the Prisma migrations and the first-company seed.
4. Point each domain's DNS to the server, and issue HTTPS certificates.
5. For each new version: pull, build, run migrations, restart. One script, `deploy.sh`, does all four.

**Backups.** Every night the worker takes a full database dump and a copy of the uploads folder, keeps 14 daily and 8 weekly copies on the server, and sends a copy off the server to a separate storage location. Once a month, restore a backup onto a test server to prove it works. A backup that has never been restored is not a backup.

**Watching it.** Uptime check on the main domains with an alert to phone, app error logs kept for 30 days, and a disk space alert at 80 percent.

**Handover pack,** to be kept current by whoever maintains the system:

- Full source code in the company's own GitHub account
- `docs/setup.md`, `docs/modules.md`, `docs/backup.md`
- A complete `.env.example` and the database diagram
- The admin login and server access, held by the owner, not only the developer

## Not in version one, and open decisions

These are left out on purpose, so version one gets finished. The design leaves room for each of them.

- POS working without internet
- FBR live invoice reporting from POS (the integration point is kept)
- Online payment for booth booking on the website
- WhatsApp Business messages sent from the system (version one uses a WhatsApp link)
- Mobile apps (version one works in the phone browser)
- Manufacturing and purchase planning for the furniture factory
- Urdu screens

Decisions to make before Phase 1 starts:

- [ ] Which companies go in first, and which one goes live first?
- [ ] Which Odoo data comes across: only opening balances, or full history? Full history adds a separate import phase.
- [ ] Does each company have its own chart of accounts, or do all share one template?
- [ ] Which biometric machine is used, and what file does it export?
- [ ] Which websites move into the editor in version one, and which stay as they are for now?
- [ ] Who in each team tests and signs off their section?
