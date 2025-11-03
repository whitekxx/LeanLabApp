import { serve } from "https://deno.land/std@0.221.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4";
import { computeMultiplier } from "./lib.ts";

serve(async () => {
  const supabase = getClient();
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const openai = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;

  const { data: users, error: userError } = await supabase.rpc("active_users_last_60d");
  if (userError) {
    console.error("active_users_last_60d_failed", userError.message);
    return json({ ok: false, error: userError.message }, 500);
  }

  let processed = 0;

  for (const row of users ?? []) {
    const userId = row.user_id as string;
    if (!userId) continue;

    const { data: statsRows, error: statsError } = await supabase.rpc("user_4w_stats", { p_user_id: userId });
    if (statsError) {
      console.error("user_4w_stats_failed", statsError.message, { userId });
      continue;
    }

    const stats = statsRows?.[0];
    if (!stats) continue;

    const streak = Number(stats.weeks_streak ?? 0);
    const weeksActive = Number(stats.weeks_active ?? 0);
    const orderFreq = Number(stats.order_freq ?? 0);
    const reviewFreq = Number(stats.review_freq ?? 0);

    const scoreRaw = 40 * weeksActive + 40 * orderFreq + 20 * reviewFreq;
    const score = Math.min(100, Math.max(0, Math.round(scoreRaw)));
    const multiplier = computeMultiplier(score, streak);

    let nextMessage = `Multiplier ${multiplier.toFixed(2)}x locked in. Keep the ${streak}-week streak going!`;

    if (openai) {
      const prompt = `Brand: Lean Lab. Tone: smart, efficient, empowering.\nUser streak: ${streak} weeks. Loyalty score: ${score}. Multiplier: ${multiplier.toFixed(
        2
      )}x.\nGoal: 1 sentence to reinforce consistency and preview their next earn rate boost.`;
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 60,
        });
        const content = completion.choices?.[0]?.message?.content?.trim();
        if (content) nextMessage = content;
      } catch (err) {
        console.error("openai_generation_failed", err);
      }
    }

    await supabase.from("ai_personalization").upsert({
      user_id: userId,
      base_multiplier: multiplier,
      streak_weeks: streak,
      retention_score: score,
      next_message: nextMessage,
      updated_at: new Date().toISOString(),
    });
    processed += 1;
  }

  await supabase.rpc("refresh_kpi_materialized_views").catch((err) => {
    console.warn("refresh_kpi_materialized_views_failed", err?.message ?? err);
  });

  return json({ ok: true, processed });
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
