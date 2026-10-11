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
for (const f of ['20261012000001_core.sql', '20261012000002_workflow.sql', '20261012000003_storage.sql', '20261012000005_tuning.sql', '20261012000006_rename_office.sql', '20261012000007_dean_approves_all.sql']) {
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
await throwsLike(() => as(U.meera, () => db.query(`select public.decide_leave($1, true)`, [medRow.id])), /Only the Dean can decide/, 'faculty cannot decide');
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
