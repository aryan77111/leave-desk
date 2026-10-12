// Runs the Leave Desk migrations in an in-process Postgres (PGlite) with stubbed
// Supabase auth/storage schemas, then exercises the workflow end to end.
// Usage: node run.mjs
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const MIG = new URL('../migrations/', import.meta.url);
const db = new PGlite({ extensions: { pgcrypto } });

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ✓', msg); } else { failed++; console.log('  ✗', msg); } };
async function throwsLike(fn, re, msg) {
  try { await fn(); failed++; console.log('  ✗', msg, '(no error)'); }
  catch (e) { if (re.test(e.message)) { passed++; console.log('  ✓', msg); } else { failed++; console.log('  ✗', msg, '→', e.message); } }
}

const stub = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema extensions; create extension pgcrypto with schema extensions;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
grant usage on schema auth, public, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated;
grant select, insert on storage.objects to authenticated;
`;
await db.exec(stub);
for (const f of ['20261012000001_core.sql', '20261012000002_workflow.sql', '20261012000003_storage.sql', '20261012000005_tuning.sql', '20261012000006_rename_office.sql', '20261012000007_dean_approves_all.sql', '20261012000008_people_admin.sql', '20261012000009_roll_order.sql', '20261012000010_timetable_sync.sql', '20261012000012_term_sheets.sql', '20261012000014_pilot_schema.sql', '20261012000015_pilot_access.sql', '20261012000016_pilot_leave_flow.sql', '20261012000017_pilot_reporting.sql', '20261012000018_gmail_sending.sql']) {
  try { await db.exec(readFileSync(new URL(f, MIG), 'utf8')); console.log('applied', f); }
  catch (e) { console.error('FAILED applying', f, '\n', e.message); process.exit(1); }
}

// Users ---------------------------------------------------------------------
const U = {};
for (const [k, email] of Object.entries({
  office: 'office@college.edu', chair: 'chair@college.edu', dean: 'dean@college.edu',
  meera: 'meera@college.edu', sanjay: 'sanjay@college.edu',
  aryan: 'aryan@stu.college.edu', priya: 'priya@stu.college.edu', stranger: 'nobody@gmail.com'
})) {
  U[k] = { id: randomUUID(), email };
  await db.query('insert into auth.users (id, email) values ($1, $2)', [U[k].id, email]);
}
await db.query(`insert into public.people (email, full_name, roles, user_id) values ('office@college.edu', 'Office Admin', '{office}', null)`);
ok((await db.query(`select user_id from people where email = 'office@college.edu'`)).rows[0].user_id === null, 'roster row starts unlinked');

async function as(u, fn) {
  await db.query(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
  try { return await fn(); } finally {
    await db.query(`reset role`);
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}
async function asAnon(fn) {
  await db.query(`set role anon`);
  try { return await fn(); } finally { await db.query(`reset role`); }
}
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];

console.log('\nRoster');
const claimed = await as(U.office, () => one(`select (public.claim_profile()).*`));
ok(claimed.email === 'office@college.edu' && claimed.user_id === U.office.id, 'office claims its roster row on sign-in');

const imp = await as(U.office, () => one(`select public.import_people($1::jsonb) as r`, [JSON.stringify([
  { email: 'Chair@College.edu', full_name: 'Dr. Programme Chair', roles: 'faculty;approver', approver_level: 'chair' },
  { email: 'dean@college.edu', full_name: 'Dean', roles: 'dean' },
  { email: 'meera@college.edu', full_name: 'Dr. Meera Mohanty', roles: 'faculty' },
  { email: 'sanjay@college.edu', full_name: 'Prof. Sanjay Rath', roles: 'faculty' },
  { email: 'aryan@stu.college.edu', full_name: 'Aryan Singh', roles: 'student', student_no: 'UH25076', programme: 'MBA-HRM', batch: '2025-27', section: 'A' },
  { email: 'priya@stu.college.edu', full_name: 'Priya Nair', roles: 'student', student_no: 'UH25041', programme: 'MBA-HRM', batch: '2025-27', section: 'A' },
  { email: 'bad@college.edu', full_name: 'Bad Row', roles: 'wizard' },
  { email: 'nostudentno@college.edu', full_name: 'Missing Fields', roles: 'student' }
])]));
ok(imp.r.inserted === 6 && imp.r.errors.length === 2, `people import: 6 inserted, 2 rejected rows reported (${JSON.stringify(imp.r.errors.map(e => e.row))})`);
ok((await one(`select user_id from people where email = 'aryan@stu.college.edu'`)).user_id === U.aryan.id, 'existing sign-in linked during import');
await throwsLike(() => as(U.aryan, () => db.query(`select public.import_people('[]'::jsonb)`)), /Only the Dean HRM Office/, 'students cannot import people');

const stranger = await as(U.stranger, () => one(`select (public.claim_profile()).id`));
ok(stranger.id === null, 'a Google account not on the roster gets no profile');
await throwsLike(() => as(U.stranger, () => db.query(`select public.submit_leave('medical', 'Fever', current_date, current_date, '{}', false, null, null, null, true)`)), /Only registered students/, 'unregistered user cannot apply');

// Timetable ------------------------------------------------------------------
console.log('\nTimetable');
const today = (await one(`select public.local_date(now()) as d`)).d;
const day = n => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const rows = [];
for (const n of [0, 5, 6, 10]) {
  rows.push({ date: day(n), start_time: '09:45', end_time: '11:15', course_code: 'inhrm', course_name: 'International HRM', faculty_email: 'meera@college.edu', batch: '2025-27', section: 'A' });
  rows.push({ date: day(n), start_time: '11:30', end_time: '13:00', course_code: 'PICM', faculty_email: 'sanjay@college.edu', batch: '2025-27', section: 'A' });
}
rows.push({ date: day(0), start_time: '09:45', course_code: 'LALR', faculty_email: 'meera@college.edu', batch: '2025-27', section: 'B' });
rows.push({ date: day(0), start_time: '14:00', course_code: 'XYZ', faculty_email: 'aryan@stu.college.edu', batch: '2025-27', section: 'A' });
const ts = await as(U.office, () => one(`select public.import_sessions($1::jsonb) as r`, [JSON.stringify(rows)]));
ok(ts.r.inserted === 9 && ts.r.errors.length === 1, `timetable import: 9 inserted, non-faculty row rejected`);
const re = await as(U.office, () => one(`select public.import_sessions($1::jsonb) as r`, [JSON.stringify(rows.slice(0, 2))]));
ok(re.r.updated === 2 && re.r.inserted === 0, 're-import updates instead of duplicating');
const code = await one(`select course_code, to_char(starts_at at time zone 'Asia/Kolkata', 'HH24:MI') t from class_sessions where course_code = 'INHRM' limit 1`);
ok(code.course_code === 'INHRM' && code.t === '09:45', 'course code upper-cased, time stored in college time zone');

const mySessions = await as(U.aryan, () => db.query(`select id, course_code, starts_at from class_sessions order by starts_at`));
ok(mySessions.rows.length === 8, `student sees only own batch/section sessions (${mySessions.rows.length})`);
const todayIds = (await as(U.aryan, () => db.query(`select id from class_sessions where public.local_date(starts_at) = $1`, [today]))).rows.map(r => r.id);
const otherSection = (await one(`select id from class_sessions where section = 'B'`)).id;

// Submission rules -------------------------------------------------------------
console.log('\nSubmitting');
await throwsLike(() => as(U.aryan, () => db.query(`select public.submit_leave('family', 'Wedding', $1::date, $1::date, '{}')`, [day(1)])), /48 hours' notice/, 'family leave needs 48 hours notice');
await throwsLike(() => as(U.aryan, () => db.query(`select public.submit_leave('medical', 'Fever', $1::date, $1::date, '{}', false, null, null, null, false)`, [today])), /consent/, 'medical leave needs consent');
await throwsLike(() => as(U.aryan, () => db.query(`select public.submit_leave('medical', 'Fever', $1::date, $1::date, '{}', false, null, null, null, true)`, [day(-3)])), /within 24 hours/, 'medical leave too late is refused');
await throwsLike(() => as(U.aryan, () => db.query(`select public.submit_leave('medical', 'Fever', $1::date, $1::date, $2::uuid[], false, null, null, null, true)`, [today, [otherSection]])), /not in your timetable/, 'cannot claim another section\'s session');
await throwsLike(() => as(U.aryan, () => db.query(`select public.submit_leave('official', 'Case final', $1::date, $2::date, '{}', true, $2::date, 'Mother', '9000000000')`, [day(5), day(6)])), /return date should be after/, 'return date must be after leave');
await throwsLike(() => as(U.aryan, () => db.query(`select public.submit_leave('official', 'Case final', $1::date, $2::date, '{}')`, [day(6), day(5)])), /before the first day/, 'end before start refused');

const med = await as(U.aryan, () => one(`select public.submit_leave('medical', 'Viral fever; advised rest', $1::date, $1::date, $2::uuid[], false, null, null, null, true) as ref`, [today, todayIds]));
ok(/^LV-\d+$/.test(med.ref), `medical leave submitted as ${med.ref}`);
const medRow = await one(`select * from leave_requests where ref = $1`, [med.ref]);
ok(medRow.approver_level === 'dean', 'medical leave goes to the Dean');
await throwsLike(() => as(U.aryan, () => db.query(`select public.submit_leave('medical', 'Again', $1::date, $1::date, '{}', false, null, null, null, true)`, [today])), /already have leave/, 'overlapping leave refused');

const fam = await as(U.priya, () => one(`select public.submit_leave('family', 'Sister''s wedding in Kochi', $1::date, $2::date, (select array_agg(id) from class_sessions where public.local_date(starts_at) between $1::date and $2::date), true, $3::date, 'K. Nair (father)', '9447000000') as ref`, [day(5), day(6), day(7)]));
const famRow = await one(`select * from leave_requests where ref = $1`, [fam.ref]);
ok(famRow.approver_level === 'dean', 'family leave routed to the Dean');

const acks = (await db.query(`select a.*, p.email from faculty_acks a join people p on p.id = a.faculty_id where leave_id = $1 order by p.email`, [medRow.id])).rows;
ok(acks.length === 2 && acks.every(a => a.status === 'pending' && a.token_hash), 'one pending acknowledgment per faculty, each with a token');
const mail = (await db.query(`select * from email_outbox where leave_id = $1 order by id`, [medRow.id])).rows;
ok(mail.filter(m => m.kind === 'faculty_notice').length === 2, 'two faculty notices queued');
ok(mail.some(m => m.kind === 'approver_new' && m.to_email === 'dean@college.edu') && mail.some(m => m.kind === 'approver_new' && m.to_email === 'chair@college.edu'), 'every account with Dean access emailed');
ok(mail.some(m => m.kind === 'student_receipt'), 'student receipt queued');
ok(mail.filter(m => m.kind === 'faculty_notice').every(m => !m.body.includes('Viral fever')), 'faculty email hides the medical reason');

// Visibility -------------------------------------------------------------------
console.log('\nVisibility');
ok((await as(U.priya, () => db.query(`select * from leave_requests where id = $1`, [medRow.id]))).rows.length === 0, 'another student cannot see the request');
ok((await as(U.meera, () => db.query(`select * from leave_requests`))).rows.length === 0, 'faculty cannot read leave rows directly');
await throwsLike(() => as(U.meera, () => db.query(`select token_hash from faculty_acks`)), /permission denied/, 'token hashes are not readable');
await throwsLike(() => as(U.office, () => db.query(`select link from email_outbox`)), /permission denied/, 'outbox links are not readable');
ok((await as(U.office, () => db.query(`select id from email_outbox`))).rows.length > 0, 'office can read the outbox');
ok((await as(U.aryan, () => db.query(`select id from email_outbox`))).rows.length === 0, 'students cannot read the outbox');
ok((await as(U.aryan, () => db.query(`select full_name from people`))).rows.every(r => r.full_name !== 'Priya Nair'), 'students cannot see other students');
await throwsLike(() => as(U.aryan, () => db.query(`update leave_requests set status = 'approved'`)), /permission denied/, 'students cannot update leave rows');
await throwsLike(() => as(U.office, () => db.query(`update settings set timezone = 'UTC'`)), /permission denied/, 'office cannot change the time zone column');
await as(U.office, () => db.query(`update settings set ack_hours = 48 where id = 1`));
ok(true, 'office can update a rule');
await as(U.aryan, () => db.query(`update settings set ack_hours = 1 where id = 1`));
ok((await one(`select ack_hours from settings`)).ack_hours === 48, 'student update to settings has no effect');

// Faculty -----------------------------------------------------------------------
console.log('\nFaculty');
const inbox = await as(U.meera, () => one(`select public.faculty_inbox() as x`));
ok(inbox.x.length === 2, `Meera's inbox has 2 pending notices`);
const medItem = inbox.x.find(i => i.ref === med.ref);
ok(medItem.reason === null && medItem.sessions.length === 1, 'inbox hides medical reason and lists only her sessions');
const famItem = inbox.x.find(i => i.ref === fam.ref);
ok(famItem.reason.includes('wedding'), 'inbox shows non-medical reason');

// recover a raw token the way the email would carry it
const sanjayLink = (await one(`select link from email_outbox where leave_id = $1 and to_email = 'sanjay@college.edu'`, [medRow.id])).link;
const token = sanjayLink.split('/r/')[1];
const ctx = await asAnon(() => one(`select public.token_context($1) as c`, [token]));
ok(ctx.c.state === 'open' && ctx.c.reason === null && ctx.c.sessions.length === 1, 'link page works without sign-in and hides the medical reason');
ok((await asAnon(() => one(`select public.token_context('deadbeef') as c`))).c.state === 'invalid', 'bad token reported as invalid');
await throwsLike(() => asAnon(() => db.query(`select public.respond_by_token($1, 'note', '')`, [token])), /Write the note first/, 'note needs text');
const after = await asAnon(() => one(`select public.respond_by_token($1, 'acknowledge') as c`, [token]));
ok(after.c.state === 'answered' && after.c.ack_status === 'acknowledged', 'one-tap acknowledge recorded');
await throwsLike(() => asAnon(() => db.query(`select public.respond_by_token($1, 'acknowledge')`, [token])), /already responded/, 'link cannot be used twice');
await throwsLike(() => asAnon(() => db.query(`select * from leave_requests`)), /permission denied/, 'anonymous users cannot read tables');

await as(U.meera, () => db.query(`select public.respond_to_leave($1, 'flag', 'Mid-term quiz on the first day; make-up only if sanctioned before the quiz.')`, [famRow.id]));
ok((await one(`select status from faculty_acks a join people p on p.id = a.faculty_id where leave_id = $1 and p.email = 'meera@college.edu'`, [famRow.id])).status === 'flagged', 'flag recorded');
ok((await as(U.priya, () => db.query(`select * from ack_concerns`))).rows.length === 0, 'student cannot read the concern text');
ok((await as(U.dean, () => db.query(`select * from ack_concerns`))).rows.length === 1, 'approver can read the concern');
ok((await db.query(`select * from email_outbox where kind = 'approver_concern' and to_email = 'dean@college.edu'`)).rows.length === 1, 'Dean emailed about the concern');
await as(U.meera, () => db.query(`select public.respond_to_leave($1, 'note', 'Quiz that day; make-up at my discretion.')`, [medRow.id]));
ok((await db.query(`select * from email_outbox where kind = 'student_note' and to_email = 'aryan@stu.college.edu'`)).rows.length === 1, 'note emailed to the student');
await throwsLike(() => as(U.aryan, () => db.query(`select public.respond_to_leave($1, 'acknowledge')`, [medRow.id])), /Only faculty/, 'students cannot respond as faculty');

// Decisions --------------------------------------------------------------------
console.log('\nDecisions');
ok((await db.query(`select approver_level from people where 'approver' = any (roles)`)).rows.every(r => r.approver_level === 'dean'), 'imported approvers (including role "dean" and a former chair) all have Dean access');
ok((await one(`select public.route_level('official', current_date, current_date + 10) as l`)).l === 'dean', 'long official leave also goes to the Dean');
await throwsLike(() => as(U.meera, () => db.query(`select public.decide_leave($1, true)`, [medRow.id])), /Only the Dean can decide leave, or a colleague/, 'faculty cannot decide');
await throwsLike(() => as(U.chair, () => db.query(`select public.decide_leave($1, false, '  ')`, [medRow.id])), /explaining the rejection/, 'rejection needs a note');
const d1 = await as(U.chair, () => one(`select public.decide_leave($1, true) as s`, [medRow.id]));
ok(d1.s === 'sanctioned', 'medical leave sanctioned provisionally');
const medAfter = await one(`select doc_deadline, (doc_deadline at time zone 'Asia/Kolkata')::date as dd from leave_requests where id = $1`, [medRow.id]);
ok(medAfter.dd.toISOString().slice(0, 10) === day(2) || new Date(medAfter.doc_deadline) - Date.now() >= 23 * 3600e3, `certificate deadline set (${medAfter.dd.toISOString().slice(0, 10)})`);
await throwsLike(() => as(U.chair, () => db.query(`select public.decide_leave($1, true)`, [medRow.id])), /already been decided/, 'cannot decide twice');
const d2 = await as(U.dean, () => one(`select public.decide_leave($1, true, 'Sanctioned. Meet Dr. Mohanty about the quiz.') as s`, [famRow.id]));
ok(d2.s === 'approved', 'family leave approved by the Dean (final, no documents)');

// Certificate --------------------------------------------------------------------
console.log('\nCertificate');
const goodPath = `${U.aryan.id}/${medRow.id}/certificate.pdf`;
await throwsLike(() => as(U.aryan, () => db.query(`insert into storage.objects (bucket_id, name) values ('certificates', $1)`, [`${U.priya.id}/${medRow.id}/x.pdf`])), /row-level security/, 'cannot upload into another student\'s folder');
await as(U.aryan, () => db.query(`insert into storage.objects (bucket_id, name) values ('certificates', $1)`, [goodPath]));
ok((await as(U.meera, () => db.query(`select * from storage.objects`))).rows.length === 0, 'faculty cannot read certificates');
ok((await as(U.office, () => db.query(`select * from storage.objects`))).rows.length === 1, 'office can read certificates');
await throwsLike(() => as(U.priya, () => db.query(`select public.attach_certificate($1, $2)`, [medRow.id, goodPath])), /not found/, 'another student cannot attach');
await throwsLike(() => as(U.aryan, () => db.query(`select public.attach_certificate($1, $2)`, [medRow.id, `${U.aryan.id}/${medRow.id}/missing.pdf`])), /Upload the file first/, 'attach checks the file exists');
await as(U.aryan, () => db.query(`select public.attach_certificate($1, $2)`, [medRow.id, goodPath]));
ok((await one(`select status from leave_requests where id = $1`, [medRow.id])).status === 'documents_in', 'status moves to documents in');
await throwsLike(() => as(U.office, () => db.query(`select public.review_certificate($1, false, '')`, [medRow.id])), /Say what is wrong/, 'returning a certificate needs a reason');
await as(U.office, () => db.query(`select public.review_certificate($1, false, 'Certificate is unsigned.')`, [medRow.id]));
ok((await one(`select status, doc_path from leave_requests where id = $1`, [medRow.id])).status === 'sanctioned', 'returned certificate sends it back to sanctioned');
await as(U.aryan, () => db.query(`select public.attach_certificate($1, $2)`, [medRow.id, goodPath]));
await as(U.office, () => db.query(`select public.review_certificate($1, true)`, [medRow.id]));
ok((await one(`select status from leave_requests where id = $1`, [medRow.id])).status === 'approved', 'accepted certificate makes the leave final');

const exp = await as(U.office, () => db.query(`select * from public.attendance_export($1::date, $2::date)`, [day(-1), day(10)]));
ok(exp.rows.length === 2 + 4, `attendance export lists ${exp.rows.length} sessions`);
await throwsLike(() => as(U.aryan, () => db.query(`select * from public.attendance_export(current_date, current_date)`)), /Only the Dean HRM Office/, 'students cannot export');

// Withdraw ----------------------------------------------------------------------
console.log('\nWithdraw');
const off = await as(U.aryan, () => one(`select public.submit_leave('official', 'National case final', $1::date, $1::date, '{}') as ref`, [day(10)]));
const offRow = await one(`select id from leave_requests where ref = $1`, [off.ref]);
await throwsLike(() => as(U.priya, () => db.query(`select public.withdraw_leave($1)`, [offRow.id])), /not found/, 'only the owner can withdraw');
await as(U.aryan, () => db.query(`select public.withdraw_leave($1)`, [offRow.id]));
ok((await one(`select status from leave_requests where id = $1`, [offRow.id])).status === 'withdrawn', 'withdrawn');

// Scheduled jobs ----------------------------------------------------------------
console.log('\nScheduled jobs');
const sick = await as(U.priya, () => one(`select public.submit_leave('medical', 'Migraine', $1::date, $1::date, $2::uuid[], false, null, null, null, true) as ref`, [today, todayIds]));
const sickRow = await one(`select id from leave_requests where ref = $1`, [sick.ref]);
await db.query(`update leave_requests set submitted_at = now() - interval '49 hours' where id = $1`, [sickRow.id]);
await db.query(`update faculty_acks set notified_at = now() - interval '49 hours' where leave_id = $1`, [sickRow.id]);
await db.query(`set role service_role`);
const j1 = (await one(`select public.run_scheduled_jobs() as j`)).j;
await db.query(`reset role`);
ok(j1.deemed === 2 && j1.escalated === 1, `after 49 hours: ${j1.deemed} deemed acknowledgments, ${j1.escalated} escalation`);
ok((await db.query(`select * from email_outbox where kind = 'escalation' and leave_id = $1`, [sickRow.id])).rows.length >= 2, 'approver and office reminded');
await as(U.chair, () => db.query(`select public.decide_leave($1, true)`, [sickRow.id]));
await db.query(`update leave_requests set doc_deadline = now() + interval '3 hours' where id = $1`, [sickRow.id]);
const j2 = (await one(`select public.run_scheduled_jobs() as j`)).j;
ok(j2.reminded === 1, 'certificate reminder sent within 24 hours of deadline');
const j2b = (await one(`select public.run_scheduled_jobs() as j`)).j;
ok(j2b.reminded === 0 && j2b.deemed === 0 && j2b.escalated === 0, 'jobs are idempotent');
await db.query(`update leave_requests set doc_deadline = now() - interval '1 minute' where id = $1`, [sickRow.id]);
const j3 = (await one(`select public.run_scheduled_jobs() as j`)).j;
ok(j3.cancelled === 1 && (await one(`select status from leave_requests where id = $1`, [sickRow.id])).status === 'cancelled', 'missed deadline cancels the leave');
await throwsLike(() => as(U.office, () => db.query(`select public.run_scheduled_jobs()`)), /permission denied/, 'clients cannot run the jobs');

// Email queue -------------------------------------------------------------------
console.log('\nEmail queue');
await db.query(`set role service_role`);
const claimedMail = (await db.query(`select * from public.claim_emails(5)`)).rows;
ok(claimedMail.length === 5 && claimedMail.every(m => m.status === 'sending'), 'service role claims queued emails');
await db.query(`select public.mark_email($1, true)`, [claimedMail[0].id]);
await db.query(`select public.mark_email($1, false, 'timeout')`, [claimedMail[1].id]);
await db.query(`reset role`);
const m0 = await one(`select status, link from email_outbox where id = $1`, [claimedMail[0].id]);
const m1 = await one(`select status, last_error from email_outbox where id = $1`, [claimedMail[1].id]);
ok(m0.status === 'sent' && m0.link === null, 'sent email has its one-time link cleared');
ok(m1.status === 'queued' && m1.last_error === 'timeout', 'failed email is retried');
await throwsLike(() => as(U.office, () => db.query(`select * from public.claim_emails(5)`)), /permission denied/, 'clients cannot claim emails');

// Timeline ------------------------------------------------------------------------
const tl = await as(U.priya, () => db.query(`select kind from leave_events where leave_id = $1 order by id`, [sickRow.id]));
ok(!tl.rows.some(r => r.kind === 'escalated'), 'internal escalation hidden from the student timeline');
ok(tl.rows.some(r => r.kind === 'cancelled'), 'student sees the cancellation in the timeline');


// People admin ------------------------------------------------------------------
console.log('\nPeople admin');
const priya = await one(`select * from people where email = 'priya@stu.college.edu'`);
await as(U.office, () => db.query(`select public.update_person($1, 'Priya K. Nair', 'priya@stu.college.edu', 'student', 'UH25041', 'MBA-HRM', '2025-27', 'B')`, [priya.id]));
const p2 = await one(`select full_name, section, user_id from people where id = $1`, [priya.id]);
ok(p2.full_name === 'Priya K. Nair' && p2.section === 'B' && p2.user_id === U.priya.id, 'office edits name and section; sign-in stays linked');
await as(U.office, () => db.query(`select public.update_person($1, 'Priya K. Nair', 'priya.nair@new.college.edu', 'student', 'UH25041', 'MBA-HRM', '2025-27', 'B')`, [priya.id]));
ok((await one(`select user_id from people where id = $1`, [priya.id])).user_id === null, 'changing the email unlinks the old sign-in');
await as(U.office, () => db.query(`select public.update_person($1, 'Priya K. Nair', 'priya@stu.college.edu', 'student', 'UH25041', 'MBA-HRM', '2025-27', 'A')`, [priya.id]));
ok((await one(`select user_id from people where id = $1`, [priya.id])).user_id === U.priya.id, 'changing it back relinks the matching sign-in');
await throwsLike(() => as(U.office, () => db.query(`select public.update_person($1, 'X', 'priya@stu.college.edu', 'student', null, null, null, null)`, [priya.id])), /student ID, batch and section/, 'student fields required');
await throwsLike(() => as(U.office, () => db.query(`select public.update_person($1, 'X', 'meera@college.edu', 'student', 'UH25041', null, '2025-27', 'A')`, [priya.id])), /already uses this email/, 'duplicate email refused');
await throwsLike(() => as(U.office, () => db.query(`select public.update_person($1, 'X', 'priya@stu.college.edu', 'wizard', 'UH25041', null, '2025-27', 'A')`, [priya.id])), /Roles must be/, 'bad role refused');
const meera = await one(`select id from people where email = 'meera@college.edu'`);
await as(U.office, () => db.query(`select public.update_person($1, 'Dr. Meera Mohanty', 'meera@college.edu', 'faculty;dean')`, [meera.id]));
const m2 = await one(`select roles, approver_level from people where id = $1`, [meera.id]);
ok(m2.roles.includes('approver') && m2.approver_level === 'dean', 'role "dean" gives Dean access');
const officeRow = await one(`select id from people where email = 'office@college.edu'`);
await throwsLike(() => as(U.office, () => db.query(`select public.update_person($1, 'Office Admin', 'office@college.edu', 'faculty')`, [officeRow.id])), /own Dean HRM Office access/, 'office cannot remove its own access');
await throwsLike(() => as(U.aryan, () => db.query(`select public.update_person($1, 'Hacker', 'aryan@stu.college.edu', 'office;student', 'UH25076', null, '2025-27', 'A')`, [priya.id])), /Only the Dean HRM Office/, 'students cannot edit people');

const open1 = await as(U.aryan, () => one(`select public.submit_leave('official', 'Placement interview', $1::date, $1::date, '{}') as ref`, [day(12)]));
await throwsLike(() => as(U.office, () => db.query(`select public.set_batch_active('2025-27', null, false)`)), /1 leave request in this batch is still open/, 'cannot graduate a batch with open requests');
await as(U.aryan, () => db.query(`select public.withdraw_leave((select id from leave_requests where ref = $1))`, [open1.ref]));
const grad = await as(U.office, () => one(`select public.set_batch_active('2025-27', null, false) as n`));
ok(grad.n === 2, `graduating batch 2025-27 deactivates ${grad.n} students`);
ok((await one(`select active from people where email = 'meera@college.edu'`)).active === true, 'faculty are not touched');
await throwsLike(() => as(U.aryan, () => db.query(`select public.submit_leave('medical', 'Fever', $1::date, $1::date, '{}', false, null, null, null, true)`, [today])), /Only registered students/, 'graduated students cannot apply');
ok((await db.query(`select id from leave_requests where student_id = (select id from people where email = 'aryan@stu.college.edu')`)).rows.length > 0, 'their leave history is kept');
const back = await as(U.office, () => one(`select public.set_batch_active('2025-27', 'A', true) as n`));
ok(back.n === 2, 'restoring the batch reactivates them');

// Timetable sync ------------------------------------------------------------------
console.log('\nTimetable sync');
const fid = async e => (await one(`select id from people where email = $1`, [e])).id;
const F = { meera: await fid('meera@college.edu'), sanjay: await fid('sanjay@college.edu'), chair: await fid('chair@college.edu') };
const sheetA = (await one(`insert into timetable_sheets (batch, term, file_id) values ('2025-27', 'Term V', 'abcdefghijklmnopqrstuvwxyz12') returning id`)).id;
const S = (date, start, code, faculty, section = 'A', elective = false, end = null) =>
  ({ date, start, end: end ?? `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:${start.slice(3)}`, code, name: code + ' course', faculty_id: faculty, section, elective });
const base = [
  S(day(30), '09:45', 'TAMA', F.meera), S(day(30), '09:45', 'TAMA', F.meera, 'B'),
  S(day(30), '11:30', 'MDI', F.sanjay, 'A', true), S(day(30), '11:30', 'MDI', F.sanjay, 'B', true),
  S(day(31), '09:45', 'TAMA', F.meera), S(day(31), '09:45', 'TAMA', F.meera, 'B'),
  S(day(40), '09:45', 'TAMA', F.meera), S(day(40), '09:45', 'TAMA', F.meera, 'B'),
];
const applyTo = (sheet, rows, prot = [], force = false) => one(`select public.apply_timetable_sheet($4, $1::jsonb, $2::jsonb, $3) as r`, [JSON.stringify(rows), JSON.stringify(prot), force, sheet]).then(x => x.r);
const apply = (rows, prot = [], force = false) => applyTo(sheetA, rows, prot, force);
let r1 = await apply(base);
ok(r1.status === 'ok' && r1.added === 8, `first sync adds ${r1.added} sessions`);
r1 = await apply(base);
ok(r1.added + r1.changed + r1.cancelled === 0, 'syncing the same sheet again changes nothing');
await throwsLike(() => as(U.office, () => db.query(`select public.timetable_mark_removed()`)), /only the timetable sync/, 'office cannot call the sync steps directly');
await throwsLike(() => as(U.aryan, () => apply(base)), /permission denied/, 'students cannot call the sync');

const sess = async (code, d, t, sec = 'A') => (await one(`select id, cancelled, faculty_id from class_sessions where batch = '2025-27' and section = $4 and course_code = $1 and public.local_date(starts_at) = $2 and to_char(starts_at at time zone 'Asia/Kolkata', 'HH24:MI') = $3`, [code, d, t, sec]));
const tama30 = await sess('TAMA', day(30), '09:45'), mdi30 = await sess('MDI', day(30), '11:30');
const tama31 = await sess('TAMA', day(31), '09:45');
const lv = await as(U.aryan, () => one(`select public.submit_leave('official', 'Conference', $1::date, $2::date, $3::uuid[]) as ref`, [day(30), day(31), [tama30.id, mdi30.id, tama31.id]]));
const lvId = (await one(`select id from leave_requests where ref = $1`, [lv.ref])).id;
const mailsBefore = (await one(`select count(*)::int n from email_outbox`)).n;

// The office moves TAMA on day 30 to the afternoon, hands MDI to Meera, adds an MDI make-up,
// a new core ECRM class with the Chair, and a CIB elective class Aryan never listed.
const edited = [
  S(day(30), '14:30', 'TAMA', F.meera), S(day(30), '14:30', 'TAMA', F.meera, 'B'),
  S(day(30), '11:30', 'MDI', F.meera, 'A', true), S(day(30), '11:30', 'MDI', F.meera, 'B', true),
  S(day(31), '09:45', 'TAMA', F.meera), S(day(31), '09:45', 'TAMA', F.meera, 'B'),
  S(day(31), '11:30', 'MDI', F.meera, 'A', true), S(day(31), '11:30', 'MDI', F.meera, 'B', true),
  S(day(31), '08:00', 'ECRM', F.chair), S(day(31), '16:15', 'CIB', F.sanjay, 'A', true),
  S(day(40), '09:45', 'TAMA', F.meera), S(day(40), '09:45', 'TAMA', F.meera, 'B'),
];
const r2 = await apply(edited);
ok(r2.added === 6 && r2.cancelled === 2 && r2.changed === 2 && r2.leaves_affected === 1, `edit applied: ${r2.added} added, ${r2.changed} changed, ${r2.cancelled} cancelled, ${r2.leaves_affected} leave affected`);
ok((await sess('TAMA', day(30), '09:45')).cancelled === true, 'class taken out of the sheet is marked cancelled, not deleted');
const onLeave = (await db.query(`select c.course_code, to_char(c.starts_at at time zone 'Asia/Kolkata', 'HH24:MI') t, public.local_date(c.starts_at)::text d, c.cancelled from leave_sessions ls join class_sessions c on c.id = ls.session_id where ls.leave_id = $1 order by c.starts_at`, [lvId])).rows;
const has = (code, d, t) => onLeave.some(x => x.course_code === code && x.d === d && x.t === t);
ok(has('TAMA', day(30), '14:30'), 'moved core class is added to the leave');
ok(has('ECRM', day(31), '08:00'), 'new core class is added to the leave');
ok(has('MDI', day(31), '11:30'), 'new class of an elective already on the leave is added');
ok(!has('CIB', day(31), '16:15'), 'elective the student never listed is not added');
ok(has('TAMA', day(30), '09:45'), 'cancelled class stays on the record for history');
const ev = await one(`select message from leave_events where leave_id = $1 and kind = 'timetable_changed'`, [lvId]);
ok(ev && /Removed/.test(ev.message) && /CIB/.test(ev.message), 'student timeline explains the change, including the unlisted elective');
const newMails = (await db.query(`select kind, to_email from email_outbox order by id offset $1`, [mailsBefore])).rows;
ok(newMails.some(m => m.kind === 'student_timetable_change' && m.to_email === 'aryan@stu.college.edu'), 'student is emailed');
ok(newMails.some(m => m.kind === 'faculty_notice' && m.to_email === 'chair@college.edu'), 'faculty new to the leave get a full notice with a response link');
ok((await one(`select count(*)::int n from faculty_acks where leave_id = $1 and faculty_id = $2`, [lvId, F.chair])).n === 1, 'and an acknowledgement is opened for them');
ok(newMails.some(m => m.kind === 'faculty_timetable_change' && m.to_email === 'meera@college.edu'), 'faculty already notified get a short update');
ok(!newMails.some(m => m.to_email === 'priya@stu.college.edu'), 'students without leave on those dates are not emailed');
ok((await one(`select count(*)::int n from timetable_changes where kind = 'changed' and detail like 'Faculty:%'`)).n === 2, 'faculty change is logged for the office');

// A cell the parser could not read protects that slot.
const missing = edited.filter(x => !(x.code === 'CIB'));
const r3 = await apply(missing, [{ date: day(31), start: '16:15' }]);
ok(r3.cancelled === 0 && (await sess('CIB', day(31), '16:15')).cancelled === false, 'session in an unreadable slot is left alone');

// Safety stop and the past.
await db.query(`insert into class_sessions (course_code, faculty_id, batch, section, starts_at, source, sheet_id) values ('OLD', $1, '2025-27', 'A', now() - interval '2 days', 'sheet', $2)`, [F.meera, sheetA]);
const many = [];
for (let i = 41; i < 71; i++) many.push(S(day(i), '09:45', 'SLIM', F.sanjay), S(day(i), '09:45', 'SLIM', F.sanjay, 'B'));
await apply([...missing, ...many], [{ date: day(31), start: '16:15' }]);
const blocked = await apply([]);
ok(blocked.status === 'blocked' && blocked.would_cancel > 60, `empty sheet is refused (would cancel ${blocked.would_cancel})`);
ok((await one(`select count(*)::int n from class_sessions where sheet_id = $1 and not cancelled and starts_at > now()`, [sheetA])).n > 60, 'nothing was cancelled');
const forced = await apply([], [], true);
ok(forced.status === 'ok' && forced.cancelled === blocked.would_cancel, 'Sync anyway applies it');
ok((await one(`select cancelled from class_sessions where course_code = 'OLD'`)).cancelled === false, 'past sessions are never touched');

// Next term's sheet, connected while this term is still running ---------------------
const sheetB = (await one(`insert into timetable_sheets (batch, term, file_id) values ('2025-27', 'Term VI', 'zyxwvutsrqponmlkjihgfedcba98') returning id`)).id;
await apply([S(day(75), '09:45', 'TAMA', F.meera), S(day(76), '09:45', 'TAMA', F.meera)]);
const termB = [S(day(80), '09:45', 'NEWC', F.sanjay), S(day(80), '09:45', 'NEWC', F.sanjay, 'B'), S(day(76), '09:45', 'TAMA', F.chair)];
const rB = await applyTo(sheetB, termB);
ok(rB.added === 2 && rB.cancelled === 0, `next term's sheet adds its own classes (${rB.added}) and cancels none of this term's`);
ok((await sess('TAMA', day(75), '09:45')).cancelled === false, 'this term\'s remaining classes stay on');
const shared = await one(`select sheet_id, faculty_id from class_sessions where course_code = 'TAMA' and public.local_date(starts_at) = $1 and section = 'A'`, [day(76)]);
ok(shared.sheet_id === sheetA && shared.faculty_id === F.meera, 'a class both sheets list stays with the sheet that has it');
const rA = await apply([S(day(75), '09:45', 'TAMA', F.meera), S(day(76), '09:45', 'TAMA', F.meera)]);
ok(rA.cancelled === 0 && (await one(`select count(*)::int n from class_sessions where course_code = 'NEWC' and not cancelled`)).n === 2, 're-syncing this term leaves next term\'s classes alone');
await db.query(`update timetable_sheets set archived_at = now(), enabled = false where id = $1`, [sheetA]);
await throwsLike(() => apply([]), /archived/, 'an archived sheet can no longer change anything');
const rB2 = await applyTo(sheetB, termB);
const takenOver = await one(`select sheet_id, faculty_id from class_sessions where course_code = 'TAMA' and public.local_date(starts_at) = $1 and section = 'A'`, [day(76)]);
ok(rB2.changed >= 1 && takenOver.sheet_id === sheetB && takenOver.faculty_id === F.chair, 'once the old term is archived, the new sheet takes over classes it lists');

// Access
const studentSees = await as(U.aryan, () => db.query(`select * from timetable_sheets`));
ok(studentSees.rows.length === 0, 'students cannot see the sheet settings');
await as(U.office, () => db.query(`insert into sheet_course_codes (sheet_id, course_code, variant, course_name, faculty_id, sections) values ($2, 'TAMA', 'A', 'Talent Management', $1, '{A}')`, [F.meera, sheetA]));
await as(U.office, () => db.query(`insert into sheet_course_codes (sheet_id, course_code, variant, course_name, faculty_id, sections) values ($2, 'TAMA', 'A', 'Something new', $1, '{A}')`, [F.chair, sheetB]));
ok((await as(U.office, () => db.query(`select * from sheet_course_codes`))).rows.length === 2, 'each term has its own course codes, even with the same letters');
await as(U.office, () => db.query(`delete from sheet_course_codes where sheet_id = $1`, [sheetB]));
ok((await one(`select count(*)::int n from sheet_course_codes`)).n === 1, 'office can remove a course code');
await throwsLike(() => as(U.office, () => db.query(`update timetable_sheets set last_status = 'ok'`)), /permission denied/, 'office cannot fake the sync status');
await throwsLike(() => as(U.office, () => db.query(`delete from timetable_changes`)), /permission denied/, 'the change log cannot be edited');
await as(U.office, () => db.query(`update timetable_sheets set enabled = false where id = $1`, [sheetB]));
ok((await one(`select enabled from timetable_sheets where id = $1`, [sheetB])).enabled === false, 'office can pause a sheet');
await throwsLike(() => as(U.aryan, () => db.query(`insert into sheet_course_codes (sheet_id, course_code, course_name, faculty_id, sections) values ($2, 'HACK', 'x', $1, '{A}')`, [F.meera, sheetB])), /row-level security/, 'students cannot add course codes');


// Pilot features ------------------------------------------------------------------
console.log('\nOne-time links');
const ackRow = await one(`select token_expires_at, notified_at from faculty_acks order by notified_at desc limit 1`);
const days = (new Date(ackRow.token_expires_at) - new Date(ackRow.notified_at)) / 864e5;
ok(days > 6.9 && days < 7.1, `links expire after the configured ${Math.round(days)} days`);
const expLink = (await one(`select link from email_outbox where kind = 'faculty_notice' and link is not null order by id desc limit 1`)).link;
const expToken = expLink.split('/r/')[1];
await db.query(`update faculty_acks set token_expires_at = now() - interval '1 minute' where token_hash = encode(extensions.digest($1, 'sha256'), 'hex')`, [expToken]);
const expCtx = (await asAnon(() => one(`select public.token_context($1) as c`, [expToken]))).c;
ok(expCtx.state === 'expired' && !expCtx.student_name && !expCtx.sessions, 'an expired link shows nothing about the request');
await throwsLike(() => asAnon(() => db.query(`select public.respond_by_token($1, 'acknowledge')`, [expToken])), /expired/, 'an expired link cannot be used');

console.log('\nStudent changes a request');
const s10 = async (code) => (await one(`select id, faculty_id from class_sessions where course_code = $1 and section = 'A' and batch = '2025-27' and public.local_date(starts_at) = $2`, [code, day(10)]));
const inhrm10 = await s10('INHRM'), picm10 = await s10('PICM');
const pe = await as(U.priya, () => one(`select public.submit_leave('official', 'Case competition', $1::date, $1::date, $2::uuid[]) as ref`, [day(10), [inhrm10.id]]));
const peRow = await one(`select id from leave_requests where ref = $1`, [pe.ref]);
const mark = (await one(`select max(id)::int m from email_outbox`)).m;
await throwsLike(() => as(U.aryan, () => db.query(`select public.edit_leave($1, 'x reason', $2::date, $2::date, '{}')`, [peRow.id, day(10)])), /not found/, 'another student cannot change the request');
await throwsLike(() => as(U.priya, () => db.query(`select public.edit_leave($1, 'Case competition', $2::date, $2::date, $3::uuid[])`, [peRow.id, day(10), [inhrm10.id]])), /Nothing has changed/, 'saving without changes is refused');
await as(U.priya, () => db.query(`select public.edit_leave($1, 'National case competition final', $2::date, $2::date, $3::uuid[])`, [peRow.id, day(10), [inhrm10.id, picm10.id]]));
const em1 = (await db.query(`select kind, to_email from email_outbox where id > $1`, [mark])).rows;
ok(em1.some(m => m.kind === 'faculty_notice' && m.to_email === 'sanjay@college.edu'), 'faculty newly affected by the change get a notice');
ok(!em1.some(m => m.kind === 'faculty_notice' && m.to_email === 'meera@college.edu'), 'faculty whose sessions did not change are not emailed again');
ok(em1.some(m => m.kind === 'approver_changed'), 'the Dean is told about the change');
const edEv = await one(`select message from leave_events where leave_id = $1 and kind = 'edited'`, [peRow.id]);
ok(/sessions 1 → 2/.test(edEv.message) && /reason updated/.test(edEv.message), `history records what changed (${edEv.message})`);
const mark2 = (await one(`select max(id)::int m from email_outbox`)).m;
await as(U.priya, () => db.query(`select public.edit_leave($1, 'National case competition final', $2::date, $2::date, $3::uuid[])`, [peRow.id, day(10), [picm10.id]]));
ok((await one(`select count(*)::int n from faculty_acks where leave_id = $1 and faculty_id = $2`, [peRow.id, inhrm10.faculty_id])).n === 0, 'faculty no longer affected are taken off the request');
ok((await db.query(`select 1 from email_outbox where id > $1 and kind = 'faculty_released' and to_email = 'meera@college.edu'`, [mark2])).rows.length === 1, 'and told no response is needed');

console.log('\nDean delegation');
await throwsLike(() => as(U.aryan, () => db.query(`select public.set_delegation($1, $2::date, $3::date)`, [F.sanjay, today, day(3)])), /Only the Dean or the Dean HRM Office/, 'students cannot name a delegate');
await throwsLike(() => as(U.dean, () => db.query(`select public.set_delegation($1, $2::date, $3::date)`, [F.sanjay, day(-1), day(3)])), /cannot be in the past/, 'delegation cannot start in the past');
await throwsLike(() => as(U.dean, () => db.query(`select public.set_delegation($1, $2::date, $3::date)`, [F.meera, today, day(3)])), /already has Dean access/, 'someone with Dean access does not need a delegation');
const aryanId = (await one(`select id from people where email = 'aryan@stu.college.edu'`)).id;
await throwsLike(() => as(U.dean, () => db.query(`select public.set_delegation($1, $2::date, $3::date)`, [aryanId, today, day(3)])), /active faculty member/, 'a student cannot be named');
await throwsLike(() => as(U.sanjay, () => db.query(`select public.decide_leave($1, true)`, [peRow.id])), /Only the Dean can decide/, 'faculty cannot decide before being named');
const delId = (await as(U.dean, () => one(`select public.set_delegation($1, $2::date, $3::date, 'Dean at a conference') as id`, [F.sanjay, today, day(3)]))).id;
ok((await db.query(`select 1 from email_outbox where kind = 'delegation_set' and to_email = 'sanjay@college.edu'`)).rows.length === 1, 'the delegate is emailed');
await throwsLike(() => as(U.dean, () => db.query(`select public.set_delegation($1, $2::date, $3::date)`, [F.sanjay, day(2), day(5)])), /already named/, 'overlapping delegation for the same person refused');
ok((await as(U.sanjay, () => one(`select public.can_decide() as c, public.my_delegation() as d`))).c === true, 'the delegate can decide during the dates');
ok((await as(U.sanjay, () => db.query(`select id from leave_requests where id = $1`, [peRow.id]))).rows.length === 1, 'the delegate can read requests like the Dean');
const ds = await as(U.sanjay, () => one(`select public.decide_leave($1, true) as s`, [peRow.id]));
const peAfter = await one(`select status, decided_by_delegate from leave_requests where id = $1`, [peRow.id]);
ok(ds.s === 'approved' && peAfter.decided_by_delegate === true, 'delegate decision recorded as a delegate decision');
ok(/on behalf of the Dean/.test((await one(`select message from leave_events where leave_id = $1 and kind = 'approved'`, [peRow.id])).message), 'history says "on behalf of the Dean"');
await throwsLike(() => as(U.priya, () => db.query(`select public.edit_leave($1, 'Changed again', $2::date, $2::date, '{}')`, [peRow.id, day(10)])), /Only requests waiting/, 'a decided request cannot be changed by the student');

const fresh = await as(U.priya, () => one(`select public.submit_leave('family', 'Cousin''s wedding', $1::date, $1::date, '{}') as ref`, [day(12)]));
ok((await db.query(`select 1 from email_outbox e join leave_requests r on r.id = e.leave_id where r.ref = $1 and e.kind = 'approver_new' and e.to_email = 'sanjay@college.edu'`, [fresh.ref])).rows.length === 1, 'new requests are emailed to the delegate too');
await as(U.dean, () => db.query(`select public.end_delegation($1)`, [delId]));
ok((await as(U.sanjay, () => one(`select public.can_decide() as c`))).c === false, 'ending the delegation takes the access away');
ok((await as(U.sanjay, () => db.query(`select id from leave_requests`))).rows.length === 0, 'and the delegate can no longer read requests');

console.log('\nDean HRM Office files, corrects and cancels');
await throwsLike(() => as(U.aryan, () => db.query(`select public.office_file_leave($1, 'medical', 'Hospital', $2::date, $3::date, '{}', false, null, null, null, 'note')`, [aryanId, day(-5), day(-4)])), /Only the Dean HRM Office/, 'students cannot file for others');
await throwsLike(() => as(U.office, () => db.query(`select public.office_file_leave($1, 'medical', 'Hospital', $2::date, $3::date, '{}')`, [aryanId, day(-5), day(-4)])), /Say why the office is filing/, 'office must say why it is filing');
const of = await as(U.office, () => one(`select public.office_file_leave($1, 'medical', 'Admitted to hospital with dengue', $2::date, $3::date, '{}', false, null, null, null, 'Father called the office on Monday') as ref`, [aryanId, day(-5), day(-4)]));
const ofRow = await one(`select * from leave_requests where ref = $1`, [of.ref]);
ok(ofRow.filed_by !== null && ofRow.status === 'submitted', `backdated medical leave filed by the office (${of.ref}), goes to the Dean`);
ok((await db.query(`select 1 from email_outbox where leave_id = $1 and kind = 'student_receipt' and subject like '%filed for you'`, [ofRow.id])).rows.length === 1, 'the student is told the office filed it');
const stuEvents = await as(U.aryan, () => db.query(`select kind from leave_events where leave_id = $1`, [ofRow.id]));
ok(stuEvents.rows.some(e => e.kind === 'submitted') && !stuEvents.rows.some(e => e.kind === 'office_note'), 'the student sees the filing but not the internal office note');
await throwsLike(() => as(U.office, () => db.query(`select public.office_file_leave($1, 'family', 'Again', $2::date, $2::date, '{}', false, null, null, null, 'duplicate')`, [aryanId, day(-4)])), /already has leave/, 'office filing still refuses overlaps');
await throwsLike(() => as(U.office, () => db.query(`select public.office_amend_leave($1, $2::date, $3::date, '{}', 'x')`, [ofRow.id, day(-5), day(-3)])), /Say why/, 'a correction needs a reason');
await as(U.office, () => db.query(`select public.office_amend_leave($1, $2::date, $3::date, '{}', 'Discharged a day later')`, [ofRow.id, day(-5), day(-3)]));
ok((await one(`select to_date::text t from leave_requests where id = $1`, [ofRow.id])).t === day(-3), 'office corrects the dates');
ok(/Corrected by the Dean HRM Office/.test((await one(`select message from leave_events where leave_id = $1 and kind = 'corrected'`, [ofRow.id])).message), 'correction is on the history with the reason');
await throwsLike(() => as(U.office, () => db.query(`select public.office_amend_leave($1, $2::date, $3::date, '{}', 'Same again')`, [ofRow.id, day(-5), day(-3)])), /Nothing has changed/, 'a correction must change something');
await as(U.office, () => db.query(`select public.office_cancel_leave($1, 'Filed for the wrong student')`, [ofRow.id]));
const ofC = await one(`select status, cancel_reason from leave_requests where id = $1`, [ofRow.id]);
ok(ofC.status === 'cancelled' && ofC.cancel_reason === 'Filed for the wrong student', 'office cancels a mistaken request with a reason');
await throwsLike(() => as(U.office, () => db.query(`select public.office_cancel_leave($1, 'again')`, [ofRow.id])), /already closed/, 'cannot cancel twice');

console.log('\nBulk approval');
const b1 = await as(U.aryan, () => one(`select public.submit_leave('official', 'Conference day 1', $1::date, $1::date, '{}') as ref`, [day(20)]));
const b2 = await as(U.aryan, () => one(`select public.submit_leave('official', 'Conference day 2', $1::date, $1::date, '{}') as ref`, [day(21)]));
const bid = async (r) => (await one(`select id from leave_requests where ref = $1`, [r])).id;
const [b1id, b2id, frId] = [await bid(b1.ref), await bid(b2.ref), await bid(fresh.ref)];
await db.query(`insert into ack_concerns (leave_id, faculty_id, concern) values ($1, $2, 'Exam that day')`, [b2id, F.meera]);
await throwsLike(() => as(U.aryan, () => db.query(`select public.decide_leaves_bulk($1::uuid[])`, [[b1id]])), /Only the Dean can decide/, 'students cannot bulk approve');
const bulk = (await as(U.dean, () => one(`select public.decide_leaves_bulk($1::uuid[], 'Approved together') as r`, [[b1id, b2id, frId]]))).r;
ok(bulk.decided === 2 && bulk.skipped.length === 1 && bulk.skipped[0].ref === b2.ref, `bulk approval decides ${bulk.decided} and skips the one with a concern`);
ok((await one(`select status from leave_requests where id = $1`, [b2id])).status === 'submitted', 'the request with a concern stays for the Dean to read');

console.log('\nFeedback and survey');
await throwsLike(() => asAnon(() => db.query(`select public.submit_feedback('problem', 'Broken')`)), /permission denied|Sign in/, 'feedback needs sign-in');
await as(U.aryan, () => db.query(`select public.submit_feedback('problem', 'The upload button does nothing on my phone', '/student/leave/LV-1001', 'iPhone')`));
await as(U.priya, () => db.query(`select public.submit_feedback('suggestion', 'Add WhatsApp reminders')`));
ok((await db.query(`select 1 from email_outbox where kind = 'office_feedback'`)).rows.length === 1, 'a reported problem is emailed to the office; suggestions are not');
ok((await as(U.aryan, () => db.query(`select * from feedback`))).rows.length === 1, 'people see only their own feedback');
ok((await as(U.office, () => db.query(`select * from feedback`))).rows.length === 2, 'the office sees all feedback');
const fbId = (await one(`select id from feedback where kind = 'problem'`)).id;
await as(U.office, () => db.query(`select public.set_feedback_status($1, 'done', 'Fixed in the next release')`, [fbId]));
ok((await one(`select status from feedback where id = $1`, [fbId])).status === 'done', 'the office marks feedback as done');
await throwsLike(() => as(U.aryan, () => db.query(`select public.submit_survey(5, 5)`)), /survey is not open/, 'the survey is closed until the office opens it');
await as(U.office, () => db.query(`update settings set survey_open = true where id = 1`));
await throwsLike(() => as(U.aryan, () => db.query(`select public.submit_survey(6, 5)`)), /1 to 5/, 'ratings must be 1 to 5');
await as(U.aryan, () => db.query(`select public.submit_survey(3, 5, true, 'Much quicker')`));
await as(U.aryan, () => db.query(`select public.submit_survey(4, 5, true, 'Much quicker')`));
await as(U.meera, () => db.query(`select public.submit_survey(5, 4, true)`));
ok((await one(`select count(*)::int n from survey_responses`)).n === 2, 'answering again updates the answer');

console.log('\nPilot metrics');
await throwsLike(() => as(U.aryan, () => db.query(`select public.pilot_metrics($1::date, $2::date)`, [day(-30), day(1)])), /Only the Dean and the Dean HRM Office/, 'students cannot see pilot results');
const pm = (await as(U.office, () => one(`select public.pilot_metrics($1::date, $2::date) as m`, [day(-30), day(1)]))).m;
ok(pm.requests.total > 5 && pm.decision.decided > 0 && pm.decision.pct !== null, `decision timing measured (${pm.decision.pct}% of ${pm.decision.decided + pm.decision.open_late} within ${pm.decision.window_hours} h)`);
ok(pm.ack.total > 0 && pm.ack.pct !== null && pm.ack.deemed >= 2, `faculty responses measured (${pm.ack.pct}% in time, ${pm.ack.deemed} deemed)`);
ok(pm.certificates.on_time === 1 && pm.certificates.missed === 1 && pm.certificates.pct === 50, `certificates on time measured (${pm.certificates.on_time} on time, ${pm.certificates.missed} missed)`);
ok(Number(pm.survey.satisfaction) === 4.5 && pm.survey.answered === 2, `satisfaction averaged (${pm.survey.satisfaction} from ${pm.survey.answered})`);
ok(pm.online.by_office === 1 && pm.decision.by_delegate === 1, 'office filings and delegate decisions counted');
const pmb = (await as(U.dean, () => one(`select public.pilot_metrics($1::date, $2::date, '1999-01') as m`, [day(-30), day(1)]))).m;
ok(pmb.requests.total === 0 && pmb.decision.pct === null, 'the Dean can filter by batch; empty batch gives no percentages');
const rowsCsv = await as(U.office, () => db.query(`select * from public.pilot_metrics_rows($1::date, $2::date)`, [day(-30), day(1)]));
ok(rowsCsv.rows.length === pm.requests.total && rowsCsv.rows.some(r => r.certificate_on_time === true), `per-request rows for the CSV (${rowsCsv.rows.length})`);

console.log('\nMonitoring and help');
await asAnon(() => db.query(`select public.log_app_error('client', 'TypeError: x is undefined', '/student/new', 'abc')`));
await as(U.aryan, () => db.query(`select public.log_app_error('server', 'Database timeout', '/approve')`));
ok((await as(U.office, () => db.query(`select * from app_errors`))).rows.length === 2, 'errors are recorded and the office can read them');
ok((await as(U.aryan, () => db.query(`select * from app_errors`))).rows.length === 0, 'students cannot read the error log');
const jm = (await one(`select public.run_scheduled_jobs() as j`)).j;
ok(jm.error_alerts === 1 && (await db.query(`select 1 from email_outbox where kind = 'office_errors'`)).rows.length >= 1, 'the office is emailed about new errors');
await as(U.aryan, () => db.query(`select public.log_app_error('client', 'Another one')`));
ok((await one(`select public.run_scheduled_jobs() as j`)).j.error_alerts === 0, 'at most one error alert per hour');
ok((await as(U.office, () => db.query(`select last_run_at from job_runs where name = 'scheduled_jobs'`))).rows.length === 1, 'the last job run is recorded for System health');
const help = (await asAnon(() => one(`select public.public_help() as h`))).h;
ok(help.ack_hours === 48 && help.link_days === 7, 'the help page reads the rules without signing in');


console.log('\nGmail sending');
await throwsLike(() => as(U.aryan, () => db.query(`select public.gmail_connect_start()`)), /Only the Dean HRM Office/, 'only the office can start connecting Gmail');
const gstate = (await as(U.office, () => one(`select public.gmail_connect_start() as s`))).s;
ok(/^[0-9a-f]{48}$/.test(gstate), 'office gets a one-time state');
await throwsLike(() => as(U.office, () => db.query(`select public.gmail_store_connection($1, 'tok', 'x@college.edu')`, [gstate])), /permission denied/, 'the app cannot store a token itself');
await throwsLike(() => as(U.office, () => db.query(`select public.gmail_credentials()`)), /permission denied/, 'the app cannot read the token');
await throwsLike(() => as(U.office, () => db.query(`select * from private.app_secrets`)), /permission denied/, 'the private schema is closed to clients');
await db.query(`set role service_role`);
ok((await one(`select public.gmail_store_connection('feedface', 'tok', 'x@college.edu') as r`)).r === false, 'an unknown state is refused');
ok((await one(`select public.gmail_store_connection($1, 'refresh-123', 'DeanHRM_Office@College.edu') as r`, [gstate])).r === true, 'the edge function stores the connection');
ok((await one(`select public.gmail_store_connection($1, 'other', 'evil@x.com') as r`, [gstate])).r === false, 'a state works only once');
const creds = (await one(`select public.gmail_credentials() as c`)).c;
await db.query(`reset role`);
ok(creds.refresh_token === 'refresh-123' && creds.sender === 'deanhrm_office@college.edu', 'the email function reads the token and sender');
ok((await as(U.office, () => one(`select gmail_sender from settings`))).gmail_sender === 'deanhrm_office@college.edu', 'settings show which account is connected');
await as(U.office, () => db.query(`select public.gmail_disconnect()`));
ok((await one(`select count(*)::int n from private.app_secrets where name = 'gmail_refresh_token' and value <> ''`)).n === 0 && (await one(`select gmail_sender from settings`)).gmail_sender === null, 'disconnecting removes the token');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
