// Leave Desk: pulls the live class-schedule sheets from Google Drive and applies them to the timetable.
//
// Called every 10 minutes by pg_cron (x-cron-secret header, migration 0011), or by the Dean HRM Office
// through "Sync now" on the Timetable page (their own sign-in token). JWT verification is off for this
// function; both callers are checked below.
//
// Body (optional): { "batch": "2025-27", "force": true }
//   batch: sync only this batch; force: apply even if the sheet is unchanged or the safety stop triggers.
//
// Sheets must be shared as "Anyone with the link can view". Both uploaded .xlsx files and native
// Google Sheets work.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import { type Cell, type CourseCode, parseSheet } from "./parse.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Source = { batch: string; file_id: string; enabled: boolean; last_hash: string | null; last_status: string | null };

async function allowed(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-cron-secret");
  if (secret) {
    const { data } = await db.rpc("cron_secret_ok", { p_secret: secret });
    return data === true;
  }
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.from("people").select("id").eq("user_id", user.id).eq("active", true).contains("roles", ["office"]).maybeSingle();
  return !!data;
}

async function download(fileId: string): Promise<Uint8Array> {
  const urls = [
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/export?format=xlsx`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "LeaveDesk-TimetableSync/1.0" } });
      if (!res.ok) { await res.body?.cancel(); continue; }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) return bytes; // a zip, i.e. an .xlsx
    } catch { /* try the next form */ }
  }
  throw new Error("Could not download the sheet. Check that it is shared as \"Anyone with the link can view\" and that the link is right.");
}

async function sha256(parts: (Uint8Array | string)[]): Promise<string> {
  const enc = new TextEncoder();
  const chunks = parts.map((p) => (typeof p === "string" ? enc.encode(p) : p));
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", all))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function syncOne(src: Source, force: boolean) {
  const note = (status: string | null, message: string | null, report?: unknown) =>
    db.rpc("note_timetable_check", { p_batch: src.batch, p_status: status, p_message: message, p_report: report ?? null });
  try {
    const { data: codes, error: codeErr } = await db.from("course_codes")
      .select("course_code, variant, course_name, faculty_id, sections, elective").eq("batch", src.batch);
    if (codeErr) throw new Error(codeErr.message);
    if (!codes?.length) throw new Error("No course codes are set up for this batch yet.");

    const bytes = await download(src.file_id);
    const hash = await sha256([bytes, JSON.stringify(codes)]);
    if (!force && hash === src.last_hash && src.last_status === "ok") {
      await note(null, null);
      return { batch: src.batch, status: "unchanged" };
    }

    const wb = XLSX.read(bytes, { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const parsed = parseSheet(grid, codes as CourseCode[]);
    if (parsed.sessions.length === 0) throw new Error("No classes were found in the sheet. Has its layout changed?");

    const report = {
      sheet_name: wb.SheetNames[0],
      sessions_in_sheet: parsed.sessions.length,
      first_date: parsed.firstDate,
      last_date: parsed.lastDate,
      unreadable_count: parsed.unreadable.length,
      unreadable: parsed.unreadable.slice(0, 60),
      skipped: parsed.skipped.slice(0, 40),
    };
    const { data, error } = await db.rpc("apply_timetable", {
      p_batch: src.batch,
      p_rows: parsed.sessions,
      p_protected: parsed.unreadable.map((u) => ({ date: u.date, start: u.start })),
      p_force: force,
      p_hash: hash,
      p_report: report,
    });
    if (error) throw new Error(error.message);
    return { batch: src.batch, ...(data as Record<string, unknown>) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await note("error", message);
    return { batch: src.batch, status: "error", message };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!(await allowed(req))) return new Response("Forbidden", { status: 403 });

  const body = await req.json().catch(() => ({})) as { batch?: string; force?: boolean };
  let q = db.from("timetable_sources").select("batch, file_id, enabled, last_hash, last_status");
  q = body.batch ? q.eq("batch", body.batch) : q.eq("enabled", true);
  const { data: sources, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const src of (sources ?? []) as Source[]) results.push(await syncOne(src, body.force === true));
  return Response.json({ results });
});
