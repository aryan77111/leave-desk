// Leave Desk: drains public.email_outbox through Resend.
// Called every minute by pg_cron (see migration 0004) with an x-cron-secret header.
// JWT verification is off for this function; the shared secret is checked below instead.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FALLBACK_FROM = Deno.env.get("EMAIL_FROM") ?? "Leave Desk <onboarding@resend.dev>";

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Mail = {
  id: number;
  to_email: string;
  to_name: string | null;
  subject: string;
  body: string;
  link: string | null;
  link_label: string | null;
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function html(m: Mail, appUrl: string | null, programme: string) {
  const href = m.link && appUrl ? new URL(m.link, appUrl).toString() : null;
  const greeting = m.to_name ? `Dear ${esc(m.to_name)},` : "Hello,";
  const body = esc(m.body).replace(/\n/g, "<br>");
  const button = href
    ? `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#003C6F;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:4px;font-weight:600;display:inline-block">${esc(m.link_label ?? "Open Leave Desk")}</a></p>
       <p style="color:#5B6676;font-size:12px">If the button does not work, copy this link: ${esc(href)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#F3F5F8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1B2430">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #D9E0E8;border-radius:6px">
    <tr><td style="background:#003C6F;color:#ffffff;padding:14px 20px;font-weight:700;font-size:15px;border-radius:6px 6px 0 0">Leave Desk <span style="color:#E4B84F;font-weight:600;font-size:12px;letter-spacing:.06em;margin-left:6px">${esc(programme.toUpperCase())}</span></td></tr>
    <tr><td style="padding:22px 20px;font-size:14px;line-height:1.55">
      <p style="margin:0 0 14px">${greeting}</p>
      <p style="margin:0">${body}</p>
      ${button}
    </td></tr>
    <tr><td style="padding:12px 20px;border-top:1px solid #D9E0E8;color:#5B6676;font-size:12px">Sent automatically by Leave Desk. Replies to this address are not monitored.</td></tr>
  </table></td></tr></table></body></html>`;
}

function text(m: Mail, appUrl: string | null) {
  const href = m.link && appUrl ? new URL(m.link, appUrl).toString() : null;
  return `${m.to_name ? `Dear ${m.to_name},\n\n` : ""}${m.body}${href ? `\n\n${m.link_label ?? "Open Leave Desk"}: ${href}` : ""}\n\n— Leave Desk`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = req.headers.get("x-cron-secret") ?? "";
  const { data: allowed, error: authErr } = await db.rpc("cron_secret_ok", { p_secret: secret });
  if (authErr || allowed !== true) return new Response("Forbidden", { status: 403 });

  if (!RESEND_API_KEY) {
    return Response.json({ sent: 0, skipped: "RESEND_API_KEY is not set" }, { status: 503 });
  }

  const { data: settings } = await db.from("settings").select("app_url, email_from, programme_name").eq("id", 1).single();
  const appUrl = settings?.app_url ?? null;
  if (!appUrl) {
    return Response.json({ sent: 0, skipped: "Set the app address in Settings before emails can be sent" }, { status: 503 });
  }
  const from = settings?.email_from || FALLBACK_FROM;
  const programme = settings?.programme_name ?? "MBA-HRM";

  const { data: batch, error } = await db.rpc("claim_emails", { p_limit: 25 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0, failed = 0;
  for (const m of (batch ?? []) as Mail[]) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `leave-desk-${m.id}` },
        body: JSON.stringify({
          from,
          to: [m.to_name ? `${m.to_name.replace(/[<>"]/g, "")} <${m.to_email}>` : m.to_email],
          subject: m.subject,
          html: html(m, appUrl, programme),
          text: text(m, appUrl),
        }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
      await db.rpc("mark_email", { p_id: m.id, p_ok: true });
      sent++;
    } catch (e) {
      await db.rpc("mark_email", { p_id: m.id, p_ok: false, p_error: String(e instanceof Error ? e.message : e) });
      failed++;
    }
  }
  return Response.json({ sent, failed });
});
