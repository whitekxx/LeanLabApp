import { serve } from "https://deno.land/std@0.221.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const supabase = getClient(req);

    // Require authenticated user and admin email
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ ok: false, error: "unauthorized" }, 401);
    const { data: isAdmin } = await supabase
      .from("app_admins")
      .select("email")
      .eq("email", user.email)
      .maybeSingle();
    if (!isAdmin) return json({ ok: false, error: "forbidden" }, 403);

    await supabase.rpc("refresh_kpi_materialized_views");
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

function getClient(req: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  const authHeader = req.headers.get("Authorization") ?? undefined;
  return createClient(url, key, { auth: { persistSession: false }, global: { headers: authHeader ? { Authorization: authHeader } : {} } });
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

