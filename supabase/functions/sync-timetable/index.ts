// Leave Desk: pulls each term's class-schedule sheet from Google Drive and applies it to the timetable.
//
// Called every 10 minutes by pg_cron (x-cron-secret header, migration 0011), or by the Dean HRM Office
// through "Sync now" on the Timetable page (their own sign-in token). JWT verification is off for this
// function; both callers are checked below.
//
// Body (optional): { "sheet": "<timetable_sheets.id>", "force": true }
//   sheet: sync only this sheet; force: apply even if the sheet is unchanged or the safety stop triggers.
//
// Every active (not archived, not paused) term sheet is checked. A sheet only changes the classes it
// created, so this term's and next term's sheets can both be connected. Once a sheet's last date has
// passed it is archived automatically and never read again.
//
// Sheets must be shared as "Anyone with the link can view". Uploaded .xlsx files and native Google
// Sheets both work, and the schedule can be on any tab.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import { type Cell, type CourseCode, type ParseResult, parseSheet } from "./parse.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Sheet = { id: string; batch: string; term: string; file_id: string; last_hash: string | null; last_status: string | null };

type Outcome = {
  status: "ok" | "blocked"; added?: number; restored?: number; changed?: number; cancelled?: number;
  upcoming?: number; would_cancel?: number; leaves_affected?: number;
};

/** Today's date in college time (IST). */
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function summary(r: Outcome): string {
  const added = (r.added ?? 0) + (r.restored ?? 0);
  if (added + (r.changed ?? 0) + (r.cancelled ?? 0) === 0) return "Up to date. No changes.";
  const leaves = r.leaves_affected ? `; ${r.leaves_affected} leave request${r.leaves_affected === 1 ? "" : "s"} affected` : "";
  return `${added} added, ${r.changed ?? 0} changed, ${r.cancelled ?? 0} cancelled${leaves}.`;
}

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

/** Reads every tab and keeps the one that yields the most classes. */
function readWorkbook(bytes: Uint8Array, codes: CourseCode[]): { tab: string; parsed: ParseResult } {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  let best: { tab: string; parsed: ParseResult } | null = null;
  let firstError: string | null = null;
  for (const tab of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[tab], { header: 1, raw: true, defval: null, blankrows: true });
    try {
      const parsed = parseSheet(grid, codes);
      const score = parsed.sessions.length * 1000 + parsed.unreadable.length;
      if (!best || score > best.parsed.sessions.length * 1000 + best.parsed.unreadable.length) best = { tab, parsed };
    } catch (e) {
      firstError ??= e instanceof Error ? e.message : String(e);
    }
  }
  if (!best) throw new Error(firstError ?? "The workbook has no tabs.");
  return best;
}

async function syncOne(sheet: Sheet, force: boolean) {
  const mark = (fields: Record<string, unknown>) =>
    db.from("timetable_sheets").update({ last_checked_at: new Date().toISOString(), ...fields }).eq("id", sheet.id);
  try {
    const { data: codes, error: codeErr } = await db.from("sheet_course_codes")
      .select("course_code, variant, course_name, faculty_id, sections, elective").eq("sheet_id", sheet.id).order("course_code").order("variant");
    if (codeErr) throw new Error(codeErr.message);
    if (!codes?.length) throw new Error("No course codes are set up for this sheet yet. Add them under Course codes.");

    const bytes = await download(sheet.file_id);
    const hash = await sha256([bytes, JSON.stringify(codes)]);
    if (!force && hash === sheet.last_hash && sheet.last_status === "ok") {
      await mark({});
      return { sheet: sheet.id, batch: sheet.batch, term: sheet.term, status: "unchanged" };
    }

    const { tab, parsed } = readWorkbook(bytes, codes as CourseCode[]);
    if (parsed.sessions.length === 0) {
      throw new Error(parsed.unreadable.length
        ? `None of the classes in the sheet could be read (${parsed.unreadable.length} cells). Check the course codes.`
        : "No classes were found in the sheet. Has its layout changed?");
    }

    const report = {
      sheet_name: tab,
      sessions_in_sheet: parsed.sessions.length,
      first_date: parsed.firstDate,
      last_date: parsed.lastDate,
      unreadable_count: parsed.unreadable.length,
      unreadable: parsed.unreadable.slice(0, 60),
      skipped: parsed.skipped.slice(0, 40),
    };
    const { data, error } = await db.rpc("apply_timetable_sheet", {
      p_sheet: sheet.id,
      p_rows: parsed.sessions,
      p_protected: parsed.unreadable.map((u) => ({ date: u.date, start: u.start })),
      p_force: force,
    });
    if (error) throw new Error(error.message);
    const r = data as Outcome;
    const now = new Date().toISOString();

    if (r.status === "blocked") {
      await mark({
        last_status: "blocked",
        last_message: `Not applied: ${r.would_cancel} of the ${r.upcoming} upcoming classes are missing from the sheet. Check the sheet; if that is right, use Sync anyway.`,
        last_report: { ...report, ...r },
      });
    } else {
      const termOver = !!parsed.lastDate && parsed.lastDate < todayIst();
      await mark({
        last_synced_at: now,
        last_hash: hash,
        last_status: "ok",
        last_message: termOver ? `Term over (last day ${parsed.lastDate}). Archived automatically; its classes stay as they were.` : summary(r),
        last_report: { ...report, ...r },
        ...(termOver ? { archived_at: now, enabled: false } : {}),
      });
    }
    return { sheet: sheet.id, batch: sheet.batch, term: sheet.term, ...r };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await mark({ last_status: "error", last_message: message });
    return { sheet: sheet.id, batch: sheet.batch, term: sheet.term, status: "error", message };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!(await allowed(req))) return new Response("Forbidden", { status: 403 });

  const body = await req.json().catch(() => ({})) as { sheet?: string; force?: boolean };
  let q = db.from("timetable_sheets").select("id, batch, term, file_id, last_hash, last_status").is("archived_at", null);
  q = body.sheet ? q.eq("id", body.sheet) : q.eq("enabled", true);
  const { data: sheets, error } = await q.order("batch", { ascending: false }).order("created_at");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const sheet of (sheets ?? []) as Sheet[]) results.push(await syncOne(sheet, body.force === true));
  return Response.json({ results });
});
