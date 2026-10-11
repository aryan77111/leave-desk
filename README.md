# Leave Desk

Digital student leave approvals for the MBA-HRM programme. It replaces the paper leave form.

- **Students** apply online. Missed sessions are filled in from the timetable, and medical certificates are uploaded online.
- **Faculty** acknowledge with one tap from the email (no sign-in), add a note for the student, or raise a concern with the Dean.
- **The Dean** decides every request from one queue that shows faculty notes and concerns.
- **The Dean HRM Office** manages the roster and timetable, checks certificates, exports attendance and sets the rules.

Automatic jobs handle deemed acknowledgment, reminders to the Dean, certificate reminders and auto-cancellation.

## How it is built

| Layer | Choice |
| --- | --- |
| Web app | Next.js 15 (App Router, Server Actions), TypeScript, Tailwind CSS |
| Database | Supabase Postgres, project `leave-desk` in Mumbai (`ljqozmznjasgfjeshrfq`) |
| Sign-in | Google, through Supabase Auth. Access is limited to people on the roster |
| Files | Private Supabase Storage bucket `certificates`, 5 MB limit, PDF/JPG/PNG |
| Scheduled jobs | `pg_cron`: workflow jobs every 10 minutes, email dispatch every minute |
| Email | Edge Function `send-emails`, which sends the outbox through Resend |
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

### 4. Turn on email (Resend)
1. Create a Resend account and verify the college domain (or a domain you control). Then create an API key.
2. In Supabase, open **Edge Functions → Secrets** and add `RESEND_API_KEY`.
3. In the app, open **Rules and settings** and set:
   - **App address**: the Vercel address
   - **Email sender**: for example `Leave Desk <leave@college.edu>`

Emails wait in the outbox until both are set; nothing is lost. Without a verified domain, Resend only delivers to the account owner's address.

### 5. Load the roster and timetable
- **People → Import people** (download the template first).
  - Roles: `student`, `faculty`, `dean`, `office`. Combine roles with `;` (for example `faculty;dean`).
  - Students need `student_no`, `batch` and `section`.
- **Timetable** reads the Dean HRM Office's class-schedule Google Sheets directly (see below). For one-off sessions there is also **Import a CSV instead** at the bottom of the page.

### Live timetable from Google Sheets
- Each batch's schedule sheet is connected on **Timetable → Live sheets**. Share the sheet as "Anyone with the link can view". Uploaded .xlsx files and native Google Sheets both work.
- **Timetable → Course codes** says how to read the sheet: `TAMA_A12` means Talent Management, section A, Prof. Padhi; `DTHR_SB3` means Design Thinking with Prof. Bhattacharya for the whole batch; `MDI_7` (nothing between the code and the number) is a whole-batch course.
- The `sync-timetable` edge function checks every sheet every 10 minutes (pg_cron job `leave-desk-sync-timetable`) and skips sheets that have not changed. **Sync now** runs it at once.
- What a sync does:
  - Adds new classes and updates moved ones. Only upcoming classes change; the past is frozen.
  - Classes removed from the sheet are marked cancelled, never deleted.
  - A cell it cannot read (for example a new course code) is listed on the page, and classes in that slot are left alone.
  - If a sync would cancel more than 30% of upcoming classes (minimum 20), it stops and waits for **Sync anyway**. This protects against a half-edited or broken sheet.
  - Students on leave are told about changes in their dates. A moved class, or a new class of a core course or of an elective already on their leave, is added to the leave, and its faculty get the usual notice. Other new elective classes are only mentioned.
- **Recent changes** on the Timetable page lists what each sync changed.

The Dean HRM Office overview shows a checklist until these steps are done.

### Managing people over time
- **People** has views (tabs on wide screens, a dropdown on smaller ones) for first-year and second-year students, all students, faculty, the Dean, the Dean HRM Office and deactivated people, plus one search box. Click a batch in the Batches panel to see just that batch. Year of study comes from the batch name (for example `2025-27`), counting academic years from June.
- **Import CSV** (top right of People) adds or updates many people at once; **Add person** handles one-off additions.
- **Edit** any person to fix a name, email, roles, student ID, batch or section, or to switch off their access. **Add person** handles one-off additions.
- When a batch passes out, use **Batches → Mark as graduated**. This deactivates its students, so they can no longer sign in, but keeps their leave history for audits and attendance queries. It is refused while any request from that batch is still open. **Restore** undoes it.

## Rules (changeable in Rules and settings)

| Rule | Default |
| --- | --- |
| Notice for family and university leave | 48 hours |
| Time to apply for medical leave | 24 hours after the first day ends |
| Faculty response window, then deemed acknowledged | 48 hours |
| Reminder to the Dean | after 48 hours |
| Medical certificate deadline | 2 days after resuming |
| Who decides | The Dean, for every request |
| Longest leave applied for online | 15 days |

## Development

```bash
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000 (add http://localhost:3000/auth/callback to Supabase redirect URLs)
npm test             # date, routing and CSV unit tests
npm run test:db      # 84 workflow and security tests against an in-process Postgres
npm run typecheck
npm run build
```

Database changes go in a new file under `supabase/migrations`. Apply them with the Supabase CLI (`supabase db push`) or the dashboard SQL editor, and add a test to `supabase/tests/run.mjs`.

## Not included yet
- Automatic deletion of certificates at the end of the academic year. Delete them from Storage by date for now.
- Direct links to the UMS. Timetable in and attendance out are CSV for now.
- WhatsApp notifications.
