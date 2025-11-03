import { serve } from "https://deno.land/std@0.221.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

    const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!secret) return json({ ok: false, error: "server_misconfigured" }, 500);

    const sigHeader = req.headers.get("stripe-signature") || req.headers.get("Stripe-Signature");
    if (!sigHeader) return json({ ok: false, error: "missing_signature" }, 400);

    const rawBody = await req.text();
    if (!(await verifyStripeSignature(rawBody, sigHeader, secret))) {
      return json({ ok: false, error: "invalid_signature" }, 400);
    }

    const event = JSON.parse(rawBody) as StripeEvent;
    const type = event.type;
    const obj: any = event.data?.object || {};

    // Extract fridge id from metadata keys or client_reference_id
    const meta = obj.metadata || {};
    const fridgeId = coalesce(
      meta["fridge_id"],
      meta["fridgeId"],
      meta["FRIDGE_ID"],
      obj.client_reference_id,
      obj.client_reference
    );
    if (!fridgeId) return json({ ok: false, error: "missing_fridge_id" }, 200);

    const amountCents = pickAmountCents(type, obj);
    const amount = Math.round((amountCents || 0)) / 100;
    const currency = (obj.currency || obj.currency_code || "usd").toString().toLowerCase();
    const paymentId = (obj.payment_intent || obj.id || event.id).toString();

    const supabase = getClient();
    // Insert payment row (idempotent via unique stripe_payment_id)
    const insertRes = await supabase
      .from("fridge_payments")
      .insert({ stripe_payment_id: paymentId, amount, currency, fridge_id: fridgeId, meta: obj })
      .select("id")
      .maybeSingle();

    // If duplicate (unique violation), proceed silently
    const inserted = insertRes.data;

    if (inserted) {
      // Emit KPI event for analytics
      await supabase
        .from("kpi_events")
        .insert({ event: "fridge_sale", user_id: null, order_id: null, amount, meta: { fridge_id: fridgeId, currency, payment_id: paymentId, type } })
        .catch(() => undefined);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("stripe_webhook_error", err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

// Types used for minimal parsing
type StripeEvent = { type: string; id: string; data?: { object?: Record<string, unknown> } };

function coalesce<T>(...vals: T[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && String(v).length > 0) return v;
  return undefined;
}

function pickAmountCents(type: string, obj: any): number {
  // Try common Stripe entities in priority order
  if (typeof obj.amount_received === "number") return obj.amount_received;
  if (typeof obj.amount_total === "number") return obj.amount_total;
  if (typeof obj.amount === "number") return obj.amount;
  // Fallback: if there are line_items totals
  if (obj?.amount_subtotal) return Number(obj.amount_subtotal) || 0;
  return 0;
}

function timingSafeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

function hex(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const hexes = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0"));
  return hexes.join("");
}

function parseStripeSignatureHeader(header: string): { t: string; v1?: string } {
  const parts = header.split(/,\s*/);
  const out: Record<string, string> = {};
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k && v) out[k] = v;
  }
  return { t: out["t"], v1: out["v1"] } as { t: string; v1?: string };
}

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    const parsed = parseStripeSignatureHeader(sigHeader);
    if (!parsed?.t || !parsed?.v1) return false;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const toSign = encoder.encode(`${parsed.t}.${payload}`);
    const sig = await crypto.subtle.sign("HMAC", key, toSign);
    const computed = hex(sig);
    return timingSafeEq(computed, parsed.v1!);
  } catch {
    return false;
  }
}

function getClient() {
  // SUPABASE_* keys are reserved; platform injects SUPABASE_URL.
  // Store your service key as SERVICE_ROLE_KEY via `supabase secrets set`.
  const url = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || Deno.env.get("PROJECT_URL");
  const key = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key, { auth: { persistSession: false } });
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
