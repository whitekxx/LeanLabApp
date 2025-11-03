import { serve } from "https://deno.land/std@0.221.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4";

type Payload = {
  content?: string;
  threadId?: string;
};

serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
    const { content, threadId }: Payload = await req.json();
    if (!content || !content.trim()) return json({ ok: false, error: "content required" }, 400);

    const supabase = getClient(req);
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) return json({ ok: false, error: "unauthorized" }, 401);
    const userId = userRes.user.id as string;

    // Ensure or create thread
    let threadIdFinal = threadId?.trim() || "";
    if (threadIdFinal) {
      const { data: t } = await supabase.from("ai_threads").select("id,user_id").eq("id", threadIdFinal).maybeSingle();
      if (!t || t.user_id !== userId) threadIdFinal = "";
    }
    if (!threadIdFinal) {
      const title = content.length > 60 ? content.slice(0, 57) + "…" : content;
      const { data: inserted, error: insErr } = await supabase
        .from("ai_threads")
        .insert({ user_id: userId, title })
        .select("id")
        .maybeSingle();
      if (insErr || !inserted) return json({ ok: false, error: insErr?.message || "thread create failed" }, 500);
      threadIdFinal = inserted.id as string;
    }

    // Insert user message
    await supabase.from("ai_messages").insert({ thread_id: threadIdFinal, role: "user", content });

    // Rate limit: max 8 messages per minute across all threads
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount } = await supabase
      .from("ai_messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", oneMinuteAgo)
      .in(
        "thread_id",
        (await supabase.from("ai_threads").select("id").eq("user_id", userId)).data?.map((t) => t.id) || []
      );
    if ((recentCount ?? 0) > 8) return json({ ok: false, error: "rate_limited" }, 429);

    // Load context (last 15 messages)
    const { data: msgs } = await supabase
      .from("ai_messages")
      .select("role,content,created_at")
      .eq("thread_id", threadIdFinal)
      .order("created_at", { ascending: true })
      .limit(15);

    const defaultPrompt = `Lean Lab Meals is a modern meal prep company designed as a self-operating system. Every process — orders, marketing, logistics, finance, and growth — should be automated, measured, and improved weekly.

The company operates with first-principles efficiency, minimal tools, and zero redundancy.

The AI agent’s role is to think like an executive systems engineer — optimizing throughput, profit margin, and customer experience while reducing manual friction.

Every improvement or automation should be built as if Elon Musk designed it:
* Simplicity over aesthetics
* Function before form
* Automation before manpower
* Data-driven decisions before intuition
* Centralization before expansion.

The goal: Create a self-sustaining business that scales infinitely without adding complexity.

You are the Lean Lab AI assistant. Be concise, friendly, and helpful. Offer 1–2 actionable, high-leverage suggestions when relevant. Prefer simple, automatable solutions and prioritize throughput, margin, and user experience.`;

    // Optional live override from settings
    const { data: setting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ai_system_prompt")
      .maybeSingle();
    const systemPrompt = (setting?.value as string) || defaultPrompt;

    const messages = [{ role: "system", content: systemPrompt } as const].concat(
      (msgs || []).map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content || "") }))
    );

    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) return json({ ok: false, error: "server misconfigured: OPENAI_API_KEY missing" }, 500);
    const openai = new OpenAI({ apiKey: openAiKey });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.4,
      max_tokens: 400,
    });
    const assistantText = completion.choices?.[0]?.message?.content?.toString?.() || "";
    await supabase.from("ai_messages").insert({ thread_id: threadIdFinal, role: "assistant", content: assistantText });
    await supabase.from("ai_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadIdFinal);
    const kpiInsert = await supabase
      .from("kpi_events")
      .insert({ event: "ai_usage", user_id: userId, amount: null, meta: { thread_id: threadIdFinal } });
    if (kpiInsert.error) {
      console.error("ai_chat kpi_events insert failed", kpiInsert.error);
    }

    return json({ ok: true, threadId: threadIdFinal, message: assistantText }, 200);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

function getClient(req: Request) {
  const url = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || Deno.env.get("PROJECT_URL");
  const key = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  const authHeader = req.headers.get("Authorization") ?? undefined;
  return createClient(url, key, { auth: { persistSession: false }, global: { headers: authHeader ? { Authorization: authHeader } : {} } });
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
