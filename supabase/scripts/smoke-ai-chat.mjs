/* eslint-disable no-console */
import { createClient } from "@supabase/supabase-js";

function getEnv(key, required = true) {
  const value = (process.env[key] || "").trim();
  if (!value && required) {
    console.error(`Missing required environment variable ${key}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const url = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  const prompt = process.argv.slice(2).join(" ") || "Ping check – respond with OK.";

  let accessToken = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();
  if (!accessToken) {
    const email = getEnv("SUPABASE_TEST_EMAIL");
    const password = getEnv("SUPABASE_TEST_PASSWORD");
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session?.access_token) {
      console.error("Failed to sign in test user", error);
      process.exit(1);
    }
    accessToken = data.session.access_token;
  }
  const endpoint = `${url.replace(/\/$/, "")}/functions/v1/ai_chat`;
  console.log(`Invoking ${endpoint}…`);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ content: prompt }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.ok) {
    console.error("AI chat smoke test failed", res.status, payload);
    process.exit(1);
  }

  console.log("AI chat response:", payload.message);
  console.log("Thread ID:", payload.threadId);
}

main().catch((err) => {
  console.error("smoke-ai-chat error", err);
  process.exit(1);
});
