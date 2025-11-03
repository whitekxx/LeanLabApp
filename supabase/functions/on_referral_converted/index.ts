import { serve } from "https://deno.land/std@0.221.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { referralBonus } from "./lib.ts";

type ReferralPayload = {
  referralId?: string;
};

serve(async (req) => {
  try {
    const { referralId }: ReferralPayload = await req.json();
    if (!referralId) {
      return json({ ok: false, error: "referralId required" }, 400);
    }

    const supabase = getClient();

    const { data: referral, error } = await supabase
      .from("referrals")
      .select("id,referrer_user_id,referred_user_id,converted,converted_order_id")
      .eq("id", referralId)
      .maybeSingle();

    if (error || !referral) {
      return json({ ok: false, error: error?.message || "referral not found" }, 400);
    }

    if (!referral.converted) {
      return json({ ok: false, error: "referral not converted" }, 409);
    }

    const { data: existing } = await supabase
      .from("lean_transactions")
      .select("id")
      .eq("referral_id", referral.id)
      .eq("type", "referral")
      .maybeSingle();

    if (existing) {
      return json({ ok: true, message: "already rewarded" }, 200);
    }

    const amount = referralBonus();

    const { error: txError } = await supabase.from("lean_transactions").insert({
      user_id: referral.referrer_user_id,
      type: "referral",
      amount,
      referral_id: referral.id,
      note: "referral conversion bonus",
      meta: { referred_user_id: referral.referred_user_id, order_id: referral.converted_order_id },
    });

    if (txError && txError.code !== "23505") {
      return json({ ok: false, error: txError.message }, 500);
    }

    await supabase.rpc("ensure_wallet_exists", { p_user_id: referral.referrer_user_id });
    await supabase.rpc("inc_wallet", { p_user_id: referral.referrer_user_id, p_delta: amount });

    await supabase.from("kpi_events").insert({
      event: "referral_converted",
      user_id: referral.referrer_user_id,
      order_id: referral.converted_order_id,
      amount,
      meta: { referral_id: referral.id, referred_user_id: referral.referred_user_id },
    });

    return json({ ok: true, amount }, 200);
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
