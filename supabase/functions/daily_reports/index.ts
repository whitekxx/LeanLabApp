import { serve } from "https://deno.land/std@0.221.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
    const secret = (Deno.env.get("CRON_SECRET") || "").trim();
    if (!secret) {
      console.error("daily_reports_missing_cron_secret");
      return json({ ok: false, error: "server_misconfigured" }, 500);
    }
    if (req.headers.get("x-cron-secret") !== secret) return json({ ok: false, error: "unauthorized" }, 401);

    const supabase = getClient();

    // Compute yesterday range in UTC
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const yStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const yEnd = todayStart;

    // Aggregate daily sales per fridge
    const { data: salesRows, error: salesErr } = await supabase
      .from("fridge_payments")
      .select("fridge_id, amount, created_at")
      .gte("created_at", yStart.toISOString())
      .lt("created_at", yEnd.toISOString());
    if (salesErr) throw salesErr;

    const totals = new Map<string, number>();
    for (const r of salesRows || []) {
      const id = String((r as any).fridge_id);
      const amt = Number((r as any).amount || 0);
      totals.set(id, (totals.get(id) || 0) + amt);
    }
    for (const [fridge_id, total] of totals.entries()) {
      await supabase
        .from("kpi_events")
        .insert({ event: "fridge_daily_sales", amount: total, meta: { fridge_id, date: yStart.toISOString().slice(0, 10) } })
        .catch(() => undefined);
    }

    // Restock alerts (low inventory)
    const { data: fridges } = await supabase.from("fridges").select("id, low_stock_threshold");
    for (const f of fridges || []) {
      const fridgeId = (f as any).id as string;
      const threshold = Number((f as any).low_stock_threshold ?? 5);
      const { data: inv } = await supabase
        .from("fridge_inventory")
        .select("product_id, quantity")
        .eq("fridge_id", fridgeId)
        .lte("quantity", threshold);
      for (const row of inv || []) {
        const product_id = (row as any).product_id as string;
        const quantity = Number((row as any).quantity || 0);
        await supabase
          .from("kpi_events")
          .insert({ event: "fridge_restock_alert", amount: null, meta: { fridge_id: fridgeId, product_id, quantity, threshold } })
          .catch(() => undefined);
      }
    }

    return json({ ok: true, salesFridges: totals.size });
  } catch (err) {
    console.error("daily_reports_error", err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

function getClient() {
  const url = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || Deno.env.get("PROJECT_URL");
  const key = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key, { auth: { persistSession: false } });
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
