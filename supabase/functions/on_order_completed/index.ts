import { serve } from "https://deno.land/std@0.221.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calculateEarn } from "./lib.ts";

type OrderPayload = {
  orderId?: string;
};

serve(async (req) => {
  try {
    const { orderId }: OrderPayload = await req.json();
    if (!orderId) {
      return json({ ok: false, error: "orderId required" }, 400);
    }

    const supabase = getClient();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,user_id,status,meal_count,subtotal,credits_redeemed,is_subscription")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return json({ ok: false, error: orderError?.message || "order not found" }, 400);
    }

    if (order.status !== "completed") {
      return json({ ok: false, error: "order not completed" }, 409);
    }

    const { data: existing } = await supabase
      .from("lean_transactions")
      .select("id")
      .eq("order_id", order.id)
      .eq("type", "earn")
      .maybeSingle();

    if (existing) {
      return json({ ok: true, message: "already credited" }, 200);
    }

    const { data: personalization } = await supabase
      .from("ai_personalization")
      .select("base_multiplier")
      .eq("user_id", order.user_id)
      .maybeSingle();

    const multiplier = Number(personalization?.base_multiplier ?? 1);
    const earn = calculateEarn({
      subtotal: Number(order.subtotal ?? 0),
      creditsRedeemed: Number(order.credits_redeemed ?? 0),
      mealCount: Number(order.meal_count ?? 0),
      isSubscription: Boolean(order.is_subscription),
      multiplier,
    });

    if (earn.credits <= 0) {
      return json({ ok: true, credits: 0, rate: earn.rate }, 200);
    }

    const { error: txError } = await supabase.from("lean_transactions").insert({
      user_id: order.user_id,
      type: "earn",
      amount: earn.credits,
      order_id: order.id,
      note: `earn ${(earn.rate * 100).toFixed(1)}% on $${earn.earnable.toFixed(2)}`,
    });

    if (txError && txError.code !== "23505") {
      return json({ ok: false, error: txError.message }, 500);
    }

    await supabase.rpc("ensure_wallet_exists", { p_user_id: order.user_id });
    await supabase.rpc("inc_wallet", { p_user_id: order.user_id, p_delta: earn.credits });

    await supabase.from("kpi_events").insert({
      event: "order_completed",
      user_id: order.user_id,
      order_id: order.id,
      amount: earn.credits,
      meta: { meal_count: order.meal_count, rate: earn.rate },
    });

    return json({ ok: true, credits: earn.credits, rate: earn.rate }, 200);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

function getClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing Supabase environment variables");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
