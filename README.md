# Leave Desk

Digital student leave approvals for the MBA-HRM programme. It replaces the paper leave form.

- **Students** apply online. Missed sessions are filled in from the timetable. Medical leave is applied for with the certificate attached.
- **Faculty** acknowledge with one tap from the email (no sign-in), add a note for the student, or raise a concern with the Dean.
- **The Dean** decides every request from one queue that shows faculty notes and concerns.
- **The Dean HRM Office** checks each medical certificate before the request goes to the Dean, manages the roster and timetable, exports attendance and sets the rules.

Automatic jobs handle deemed acknowledgment, reminders to the Dean and the office, missing-certificate reminders and auto-cancellation.

### Medical leave

1. The student applies and attaches the certificate (PDF, JPG or PNG, up to 5 MB). Faculty are told straight away.
2. The Dean HRM Office opens the certificate and either **accepts** it (the request goes to the Dean, who is emailed) or **returns** it with a reason (the student is emailed and has at least 2 days to upload a new one).
3. The Dean approves or rejects. Approval is final; there is no provisional stage.

The Dean cannot decide a medical request before the office has checked it, and it does not appear in the approval queue until then.
If the student changes the dates after the check, the office checks again. A request filed by the office counts as checked.
A request with no certificate (the upload failed, or it was returned and not replaced) is cancelled at its deadline.

## Pilot features

| Feature | Where | Who |
| --- | --- | --- |
| **Pilot results**: decided within the reminder time, faculty replies in their window, certificates checked by the office in time, requests made online, survey satisfaction, each against its target; per-request CSV for the Week 11 report | Pilot results (`/results`) | Dean, Dean HRM Office |
| **Out of office**: name a faculty member or office colleague to decide for given dates. They get the Dean's emails and queue; decisions say "on behalf of the Dean" | Out of office / Dean's delegates (`/away`) | Dean, Dean HRM Office |
| **File leave for a student**, including after the dates (hospital, emergency); no timing rules; a reason for filing is required and kept off the student's view | File leave for a student | Dean HRM Office |
| **Correct** the dates and sessions of an open or approved request, or **cancel** a mistaken one, with a reason on the history | Request page → Correct or cancel | Dean HRM Office |
| **Change a request** (dates, sessions, reason, travel) until it is decided. Faculty whose sessions change are re-notified; faculty no longer affected are told | My leave → request → Change request | Students |
| **History** of every step with who did it and when; office-only entries are marked | Every request page | Dean, office (students see their own entries) |
| **Report a problem / suggest something** link at the bottom of every page; problems are emailed to the office | Feedback (`/office/feedback`) | Everyone / office |
| **End-of-pilot survey** (satisfaction, ease, quicker than paper) with a banner while open | Rules and settings → Survey is open | Everyone |
| **Help and rules** page, public, linked from every email and the faculty link page | `/help` | Everyone |
| **Link expiry**: faculty links work once and for a set number of days (default 7); expired or closed links show nothing about the request | Rules and settings | — |
| **Error monitoring**: unexpected server and browser errors are logged; the office gets at most one alert email an hour | System health (`/office/health`) | Dean HRM Office |
| **Leave calendar**: who is on leave each day, by batch | Leave calendar (`/calendar`) | Dean, delegate, office |
| **Bulk approval**: tick requests and approve them together; requests with a faculty concern must be opened | Approval queue | Dean, delegate |

Phone layouts: lists become cards below tablet width, buttons are at least 44 px tall where people tap them on phones, and the approval bar stays at the bottom while selecting.

## How it is built

| Layer | Choice |
| --- | --- |
| Web app | Next.js 15 (App Router, Server Actions), TypeScript, Tailwind CSS |
| Database | Supabase Postgres, project `leave-desk` in Mumbai (`ljqozmznjasgfjeshrfq`) |
| Sign-in | Google, through Supabase Auth. Access is limited to people on the roster |
| Files | Private Supabase Storage bucket `certificates`, 5 MB limit, PDF/JPG/PNG |
| Scheduled jobs | `pg_cron`: workflow jobs every 10 minutes, email dispatch every minute, morning summaries at 08:00 IST |
| Email | Edge Function `send-emails` sends the outbox through a connected college Gmail account (Gmail API), or Resend as a fallback; `gmail-connect` handles the Google sign-in |
| Hosting | Vercel |

All workflow rules live in the database (`supabase/migrations`). The app calls functions such as `submit_leave` and `decide_leave`, and each function checks the caller's role. Row-level security limits what each person can read:

- Students see only their own requests.
- Faculty see only notices for their own sessions, and never medical reasons or certificates.
- Concerns raised by faculty are visible only to the Dean and the Dean HRM Office.

## Already done

- Supabase project created; all migrations applied (schema, row-level security, workflow functions, storage bucket, scheduled jobs).
- `send-emails` Edge Function deployed.
- Supabase security and performance advisors reviewed. The remaining "security definer" notices are intentional: each function checks the caller's role itself.

## Going live: steps for you

### 1. Turn on Google sign-in (about 10 minutes)
1. In Google Cloud Console, create an OAuth client of type *Web application*.
   - Authorised redirect URI: `https://ljqozmznjasgfjeshrfq.supabase.co/auth/v1/callback`
2. In the Supabase dashboard, open **Authentication → Sign In / Providers → Google**. Enable it and paste the client ID and secret.
3. Optional: under **Email**, turn off email sign-up. Only Google is used.

### 2. Deploy the app on Vercel (about 10 minutes)
1. Create a GitHub repository and upload this folder (not `node_modules`).
2. In Vercel, choose **Add New → Project**, then import the repository.
3. Add the environment variables from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - optionally `NEXT_PUBLIC_GOOGLE_HOSTED_DOMAIN` (for example `xim.edu.in`), which limits the Google account picker to college accounts
4. Deploy, and note the address (for example `https://leave-desk.vercel.app`).
5. In Supabase, open **Authentication → URL Configuration**:
   - Set **Site URL** to that address.
   - Add `https://<your-address>/auth/callback` to **Redirect URLs**.

### 3. Create the first Dean HRM Office account
1. Sign in to the app once with your Google account. You will see "not on the roster", which is expected.
2. In the Supabase SQL editor, run:
   ```sql
   select public.bootstrap_office('you@college.edu', 'Your Name');
   ```
3. Reload the app. You now see the Dean HRM Office menu.

### 4. Turn on email (Gmail through a college Google account)
Leave Desk sends email through a college Google account, so mail comes from the real `xim.edu.in`
address and needs no DNS changes. The account only grants permission to *send*; Leave Desk cannot read the inbox.

**Once, in Google Cloud (about 15 minutes):**
1. Go to console.cloud.google.com and create a project, for example `leave-desk`.
2. **APIs & Services → Library**: search for **Gmail API** and click **Enable**.
3. **APIs & Services → OAuth consent screen** (also called Google Auth Platform → Branding/Audience):
   - App name `Leave Desk`, your email as support and developer contact.
   - User type: **Internal** if it is offered (only XIM accounts can connect, and Google shows no warning). Otherwise **External**.
   - If External: under **Audience**, click **Publish app** so it is *In production*. Left in *Testing*, Google stops the connection after 7 days.
   - Scopes: add `.../auth/gmail.send` (and `openid`, `email`).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type **Web application**, name `Leave Desk email`.
   - Authorised redirect URI: `https://ljqozmznjasgfjeshrfq.supabase.co/functions/v1/gmail-connect`
   - Copy the **Client ID** and **Client secret**.
5. In Supabase: **Edge Functions → Secrets**, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**Then, in the app:** Rules and settings → **Email account → Connect Gmail**, and sign in with the account mail should come from.
If Google says "Google hasn't verified this app", choose **Advanced → Go to Leave Desk**. Use **Switch to another account**
later to move from a test account to the Dean HRM Office account. The **Email sender** setting gives the display name
(for example `Leave Desk – Dean HRM Office <deanhrm_office@xim.edu.in>`).

If no Google account is connected, the app falls back to Resend (`RESEND_API_KEY` secret, sender on a domain verified in Resend).
Emails wait in the outbox until one of the two works; nothing is lost.

### 5. Fill in the help contact
In **Rules and settings → Help page contact**, add the office desk name, email and phone. They appear on the public Help and rules page that every email links to.

### 6. Load the roster and timetable
- **People → Import people** (download the template first).
  - Roles: `student`, `faculty`, `dean`, `office`. Combine roles with `;` (for example `faculty;dean`).
  - Students need `student_no`, `batch` and `section`.
- **Timetable** reads the Dean HRM Office's class-schedule Google Sheets directly (see below). For one-off sessions there is also **Import a CSV instead** at the bottom of the page.

### Live timetable from Google Sheets
- Each batch has one sheet per term, connected on **Timetable → Live sheets** (batch, term name such as "Term III", and the sheet link). Share the sheet as "Anyone with the link can view". Uploaded .xlsx files and native Google Sheets both work, and the schedule can be on any tab.
- **Timetable → Course codes** says how to read each term's sheet, with its own list per term (courses do not carry over). `TAMA_A12` means Talent Management, section A, Prof. Padhi; `DTHR_SB3` means Design Thinking with Prof. Bhattacharya for the whole batch; `MDI_7` (nothing between the code and the number) is a whole-batch course. Faculty must be on People first.
- The `sync-timetable` edge function checks every active sheet every 10 minutes (pg_cron job `leave-desk-sync-timetable`) and skips sheets that have not changed. **Sync now** runs it at once.
- What a sync does:
  - Adds new classes and updates moved ones. Only upcoming classes change; the past is frozen.
  - A sheet only changes the classes it created, so next term's sheet can be added while this term is still running.
  - Classes removed from a sheet are marked cancelled, never deleted.
  - A cell it cannot read (for example a code not yet added) is listed on the page, and classes in that slot are left alone. A sheet with no course codes is not read at all.
  - If a sync would cancel more than 30% of the sheet's upcoming classes (minimum 20), it stops and waits for **Sync anyway**.
  - Students on leave are told about changes in their dates. A moved class, or a new class of a core course or of an elective already on their leave, is added to the leave, and its faculty get the usual notice. Other new elective classes are only mentioned.
  - After a sheet's last date has passed it is archived automatically and never read again. The office can also archive or bring back a sheet by hand.
- **Recent changes** on the Timetable page lists what each sync changed.

#### Starting a new term
1. Add any new faculty on **People**.
2. **Timetable → Add next term's sheet**: batch, term name, link.
3. **Course codes**: add the new term's codes.
4. **Sync now**, and check that no cells are listed as unreadable.

The Dean HRM Office overview shows a checklist until these steps are done.

### Managing people over time
- **People** has views (tabs on wide screens, a dropdown on smaller ones) for first-year and second-year students, all students, faculty, the Dean, the Dean HRM Office and deactivated people, plus one search box. Click a batch in the Batches panel to see just that batch. Year of study comes from the batch name (for example `2025-27`), counting academic years from June.
- **Import CSV** (top right of People) adds or updates many people at once; **Add person** handles one-off additions.
- **Edit** any person to fix a name, email, roles, student ID, batch or section, or to switch off their access. **Add person** handles one-off additions.
- When a batch passes out, use **Batches → Mark as graduated**. This deactivates its students, so they can no longer sign in, but keeps their leave history for audits and attendance queries. It is refused while any request from that batch is still open. **Restore** undoes it.

## Emails: who gets what, and when

To keep email down, staff get **one summary each morning at 08:00** instead of an email per request:

| Sent straight away | In the morning summary | Not sent |
|---|---|---|
| Everything to students that needs action or gives an outcome (decision, certificate request, reminder, cancellation, correction, faculty note) | New requests for the Dean (with anything still waiting from earlier) | The student's own "we received your request" (shown on screen); office-filed requests still email the student |
| Faculty notices for a class in the next 24 hours | Faculty notices for later classes, each with its own one-tap link | Delegation copies to the Dean and office |
| New requests and certificates to check, for leave starting today or tomorrow (or already past, as medical leave usually is) | Later requests and certificates to check, changes, withdrawals, cancellations, timetable updates, overdue reminders | |
| Faculty concerns; problems reported; error alerts; delegation notice to the person named | | |

The summary leaves out anything that no longer needs attention: a request already decided, withdrawn before the person heard of it,
or a notice already answered. A faculty member's response window starts when the summary is sent. All instant emails about one
request arrive in one conversation per person. **Emails sent → Send summaries now** sends the summaries immediately (for testing).

## Rules (changeable in Rules and settings)

| Rule | Default |
| --- | --- |
| Notice for family and university leave | 48 hours |
| Time to apply for medical leave | 24 hours after the first day ends |
| Faculty response window, then deemed acknowledged | 48 hours |
| Reminder to the Dean | after 48 hours |
| Deadline for a missing certificate | 2 days after the last day of leave (a returned one: at least 2 days from the return) |
| Who decides | The Dean, for every request |
| Longest leave applied for online | 15 days |
| Faculty email links work for | 7 days |
| Pilot targets | decisions 90%, faculty replies 80%, certificates 90%, satisfaction 4.0 / 5 |

## Development

```bash
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000 (add http://localhost:3000/auth/callback to Supabase redirect URLs)
npm test             # date, routing and CSV unit tests
npm run test:db      # 229 workflow and security tests against an in-process Postgres
npm run typecheck
npm run build
```

Database changes go in a new file under `supabase/migrations`. Apply them with the Supabase CLI (`supabase db push`) or the dashboard SQL editor, and add a test to `supabase/tests/run.mjs`.

## Running the pilot
- **Week 1**: check **System health** once a day. Green means reminders, emails and timetable sync are running.
- **Before the Dean travels**: Dean (or office) uses **Out of office** to name a delegate for those dates.
- **If a student cannot apply**: **File leave for a student**; it goes to the Dean as usual.
- **Last week**: tick **Survey is open** in Rules and settings. A banner asks everyone two questions.
- **Week 11 report**: **Pilot results** for the pilot dates, then **Download per-request CSV**.

## Not included yet
- Automatic deletion of certificates at the end of the academic year. Delete them from Storage by date for now.
- Direct links to the UMS. Timetable in and attendance out are CSV for now.
- WhatsApp notifications.
