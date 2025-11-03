import { serve } from "https://deno.land/std@0.221.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { startOfWeek, canAwardReviewCredit } from "./lib.ts";

type ReviewPayload = {
  reviewId?: string;
};

serve(async (req) => {
  try {
    const { reviewId }: ReviewPayload = await req.json();
    if (!reviewId) {
      return json({ ok: false, error: "reviewId required" }, 400);
    }

    const supabase = getClient();

    const { data: review, error } = await supabase
      .from("meal_reviews")
      .select("id,user_id,status,created_at")
      .eq("id", reviewId)
      .maybeSingle();

    if (error || !review) {
      return json({ ok: false, error: error?.message || "review not found" }, 400);
    }

    if (review.status !== "approved") {
      return json({ ok: false, error: "review not approved" }, 409);
    }

    const { data: existing } = await supabase
      .from("lean_transactions")
      .select("id")
      .eq("review_id", review.id)
      .eq("type", "review")
      .maybeSingle();

    if (existing) {
      return json({ ok: true, message: "already rewarded" }, 200);
    }

    const weekStart = startOfWeek(new Date());
    const { count } = await supabase
      .from("lean_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", review.user_id)
      .eq("type", "review")
      .gte("created_at", weekStart.toISOString());

    if (!canAwardReviewCredit(count ?? 0)) {
      return json({ ok: true, message: "weekly cap reached" }, 200);
    }

    const amount = 1;
    const { error: insertError } = await supabase.from("lean_transactions").insert({
      user_id: review.user_id,
      type: "review",
      amount,
      review_id: review.id,
      note: "approved review bonus",
    });

    if (insertError && insertError.code !== "23505") {
      return json({ ok: false, error: insertError.message }, 500);
    }

    await supabase.rpc("ensure_wallet_exists", { p_user_id: review.user_id });
    await supabase.rpc("inc_wallet", { p_user_id: review.user_id, p_delta: amount });

    await supabase.from("kpi_events").insert({
      event: "review_approved",
      user_id: review.user_id,
      amount,
      meta: { review_id: review.id },
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
