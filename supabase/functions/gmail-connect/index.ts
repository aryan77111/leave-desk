// Leave Desk: connect the Google (Gmail) account that emails are sent from.
//
// 1. The Dean HRM Office clicks "Connect Gmail" in Rules and settings. The app asks the database for a
//    one-time state (gmail_connect_start) and sends the browser here with ?state=…
// 2. This function redirects to Google's sign-in, asking only for permission to send email.
// 3. Google sends the browser back here with ?code=…&state=…; the code is exchanged for a token,
//    which is stored in the private schema (gmail_store_connection checks the state), and the
//    browser goes back to Rules and settings.
//
// Secrets (Supabase → Edge Functions → Secrets): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
// In Google Cloud, the OAuth client's authorised redirect URI must be exactly
//   https://<project>.supabase.co/functions/v1/gmail-connect
// JWT verification is off: the browser arrives here by redirect, and the state proves who started it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/gmail-connect`;
const SCOPES = "openid email https://www.googleapis.com/auth/gmail.send";

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function backToSettings(result: string, reason?: string) {
  const { data } = await db.from("settings").select("app_url").eq("id", 1).single();
  const base = data?.app_url ?? "https://leave-desk-hrm.vercel.app";
  const url = new URL("/office/settings", base);
  url.searchParams.set("gmail", result);
  if (reason) url.searchParams.set("reason", reason.slice(0, 120));
  url.hash = "email";
  return Response.redirect(url.toString(), 302);
}

function emailFromIdToken(idToken: string | undefined): string | null {
  // The token comes straight from Google over HTTPS in exchange for our secret, so reading its
  // payload without re-verifying the signature is safe here.
  try {
    const payload = idToken?.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json.email_verified === false ? null : (json.email ?? null);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const googleError = url.searchParams.get("error");

  if (!CLIENT_ID || !CLIENT_SECRET) return backToSettings("error", "Google client ID and secret are not set in Supabase");
  if (!/^[0-9a-f]{48}$/.test(state)) return backToSettings("error", "The link was incomplete. Try Connect Gmail again");
  if (googleError) return backToSettings("error", googleError === "access_denied" ? "Permission was not given" : googleError);

  // Step 1: send the browser to Google.
  if (!code) {
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", CLIENT_ID);
    auth.searchParams.set("redirect_uri", REDIRECT_URI);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", SCOPES);
    auth.searchParams.set("access_type", "offline");
    auth.searchParams.set("prompt", "consent select_account");
    auth.searchParams.set("include_granted_scopes", "false");
    auth.searchParams.set("state", state);
    return Response.redirect(auth.toString(), 302);
  }

  // Step 2: Google sent the browser back with a code.
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.refresh_token) {
    return backToSettings("error", tok.error_description ?? tok.error ?? "Google did not return a token. Remove Leave Desk from your Google account's third-party access and try again");
  }
  if (!String(tok.scope ?? "").includes("gmail.send")) return backToSettings("error", "Tick the permission to send email on your behalf");
  const email = emailFromIdToken(tok.id_token);
  if (!email) return backToSettings("error", "Could not read which account signed in");

  const { data: stored, error } = await db.rpc("gmail_store_connection", { p_state: state, p_refresh_token: tok.refresh_token, p_email: email });
  if (error || stored !== true) return backToSettings("error", "This connect link expired. Click Connect Gmail again");
  return backToSettings("connected");
});
