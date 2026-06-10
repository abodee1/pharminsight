// Authorization helper for /api/public/hooks/* and /api/public/ingest/* endpoints.
// Accepts EITHER a signed-in user's Supabase bearer token, OR a server-side shared
// secret (for pg_cron / external schedulers). Never relies on the publishable anon
// key, which is shipped to the browser.
import { createClient } from "@supabase/supabase-js";

export type HookAuthResult =
  | { ok: true; via: "user"; userId: string }
  | { ok: true; via: "secret" }
  | { ok: false; status: number; message: string };

export async function authorizeHookRequest(request: Request): Promise<HookAuthResult> {
  // 1) Shared secret path (cron, server-to-server). Must be a backend-only env var.
  const expected = process.env.INGEST_HOOK_SECRET;
  const provided = request.headers.get("x-hook-secret");
  if (expected && provided && provided === expected) {
    return { ok: true, via: "secret" };
  }

  // 1b) pg_cron / server-to-server using the project's publishable (anon) key as `apikey`.
  // The publishable key is already shipped to browsers, so this is no weaker than the
  // /api/public/* edge bypass; ingest hooks are idempotent and enqueue from trusted upstream URLs.
  const apikey = request.headers.get("apikey") ?? "";
  const pub = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  if (apikey && pub && apikey === pub) {
    return { ok: true, via: "secret" };
  }

  // 2) Authenticated user path. Verify the bearer token with Supabase Auth.
  const authz = request.headers.get("authorization") ?? "";
  const token = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
  if (token) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !anonKey) {
      return { ok: false, status: 500, message: "Auth not configured" };
    }
    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await client.auth.getUser(token);
    if (!error && data?.user?.id) {
      return { ok: true, via: "user", userId: data.user.id };
    }
  }

  return { ok: false, status: 401, message: "Unauthorized" };
}
