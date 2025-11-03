Supabase Functions Operations
=============================

This directory contains the Edge Functions and database assets that back the Lean Lab Meals app. After rotating secrets, follow the steps below to keep the deployed functions healthy.

Environment Variables
---------------------
Set the following secrets in your Supabase project (Dashboard → Project Settings → Functions) and update any schedulers or GitHub Actions that invoke these functions.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Project URL for service-side requests |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for privileged access |
| `OPENAI_API_KEY` | Used by `ai_chat` and `ai_weekly_analysis` |
| `CRON_SECRET` | Shared secret for scheduled `daily_reports` trigger |
| `STRIPE_WEBHOOK_SECRET` | Used inside `daily_reports` to validate payouts (if applicable) |

For local development copy the values into `supabase.functions.env` (ignored from commits). The Edge Function CLI will source them automatically when you run `supabase functions serve`.

Smoke Tests
-----------
After updating secrets, run quick checks to make sure both public endpoints authenticate correctly.

### AI Chat
Requires a test user access token (`SUPABASE_ACCESS_TOKEN`) and working OpenAI key.

```bash
SUPABASE_URL="https://<project>.supabase.co" \
SUPABASE_ACCESS_TOKEN="user-access-token" \
node supabase/scripts/smoke-ai-chat.mjs
```

The script invokes the `ai_chat` function with a short prompt and exits once the assistant responds.

### Daily Reports
Confirms the cron secret header is enforced.

```bash
CRON_SECRET="your-cron-secret" \
SUPABASE_URL="https://<project>.supabase.co" \
node supabase/scripts/smoke-daily-reports.mjs
```

Expected output: `{ ok: true, salesFridges: <n> }`. If you receive `server_misconfigured`, verify the `CRON_SECRET` is present in the Supabase Function settings.

Scripts
-------
Utility scripts referenced above live under `supabase/scripts/`. They use the Supabase client to authenticate calls and print helpful error messages if the environment is misconfigured.

```bash
node supabase/scripts/smoke-ai-chat.mjs
node supabase/scripts/smoke-daily-reports.mjs
```

> Tip: add these commands to your CI pipeline after secret rotations or Supabase deploys.

CI Integration
--------------
`.github/workflows/ci.yml` runs both smoke scripts on every push/PR. Configure these GitHub Secrets so the workflow can authenticate:

| Secret | Example | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | `https://<project>.supabase.co` | Project URL |
| `SUPABASE_ANON_KEY` | `eyJhbGc...` | Public anon key |
| `SUPABASE_TEST_EMAIL` | `ci-smoke@example.com` | Seeded auth user with email sign-in enabled |
| `SUPABASE_TEST_PASSWORD` | `super-secret` | Password for the test user |
| `SUPABASE_CRON_SECRET` | `7705525f...f7b64` | Must match `CRON_SECRET` configured in Supabase |

The test user needs access to the AI assistant feature (any regular customer account works). Rotate the password alongside other credentials and update the secret values when you rotate keys.
