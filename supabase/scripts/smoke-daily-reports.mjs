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
  const cronSecret = getEnv("CRON_SECRET");
  const anonKey = getEnv("SUPABASE_ANON_KEY");

  const endpoint = `${url.replace(/\/$/, "")}/functions/v1/daily_reports`;
  console.log(`Invoking ${endpoint}…`);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "x-cron-secret": cronSecret,
    },
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.ok) {
    console.error("daily_reports smoke test failed", res.status, payload);
    process.exit(1);
  }

  console.log("Daily reports result:", payload);
}

main().catch((err) => {
  console.error("smoke-daily-reports error", err);
  process.exit(1);
});
