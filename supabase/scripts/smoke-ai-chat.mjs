/* eslint-disable no-console */

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
    accessToken = await signInWithPassword(url, anonKey, email, password);
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

async function signInWithPassword(url, anonKey, email, password) {
  const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Failed to sign in test user", res.status, text);
    process.exit(1);
  }
  const payload = await res.json();
  const token = payload.access_token;
  if (!token) {
    console.error("Sign-in response missing access_token");
    process.exit(1);
  }
  return token;
}

main().catch((err) => {
  console.error("smoke-ai-chat error", err);
  process.exit(1);
});
