// Paystack webhook: switches Premium on when Paystack confirms a payment.
//
// Deployed as a Supabase Edge Function named "paystack-webhook" with JWT verification turned off
// (Paystack cannot send a sign-in token). It needs one secret, PAYSTACK_SECRET_KEY; Supabase provides
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to every function automatically.
//
// Every request is checked twice: its signature must match the secret key, and the transaction is then
// looked up again directly with Paystack. Only a successful payment of the exact price of a known plan,
// made from a site checkout that names the member's account, switches anything on.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Must match the prices in site/config.js. Amounts are in the currency's main unit.
const PLANS: Record<string, { days: number; NGN: number; USD: number }> = {
  weekly: { days: 7, NGN: 2500, USD: 4.99 },
  monthly: { days: 30, NGN: 7500, USD: 14.99 },
  yearly: { days: 365, NGN: 60000, USD: 119.99 },
};

const SECRET = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

async function signatureOk(body: string, signature: string | null): Promise<boolean> {
  if (!SECRET || !signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const body = await req.text();
  if (!(await signatureOk(body, req.headers.get("x-paystack-signature")))) return new Response("bad signature", { status: 401 });

  const event = JSON.parse(body);
  if (event.event !== "charge.success") return new Response("ignored");

  // Ask Paystack directly rather than trusting the message body.
  const reference = String(event.data?.reference ?? "");
  const verify = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  }).then((r) => r.json());
  const tx = verify?.data;
  if (!verify?.status || tx?.status !== "success") return new Response("not successful", { status: 200 });

  const meta = typeof tx.metadata === "string" ? JSON.parse(tx.metadata || "{}") : (tx.metadata ?? {});
  const plan = PLANS[meta.plan];
  const currency = String(tx.currency) as "NGN" | "USD";
  if (!plan || !meta.user_id || !(currency in plan)) return new Response("not a GoalCast plan payment", { status: 200 });
  if (tx.amount !== Math.round(plan[currency] * 100)) return new Response("amount does not match the plan", { status: 200 });

  const { data: found, error } = await admin.auth.admin.getUserById(meta.user_id);
  if (error || !found?.user) return new Response("unknown account", { status: 200 });
  const current = found.user.app_metadata ?? {};
  const seen: string[] = current.payments ?? [];
  if (seen.includes(reference)) return new Response("already applied");

  // Paying again before the plan ends adds the new period on top of the remaining time.
  const today = isoDay(new Date());
  const start = current.plan && current.plan_until && current.plan_until >= today ? new Date(`${current.plan_until}T00:00:00Z`) : new Date();
  start.setUTCDate(start.getUTCDate() + plan.days);

  const { error: updateError } = await admin.auth.admin.updateUserById(meta.user_id, {
    app_metadata: { ...current, plan: meta.plan, plan_until: isoDay(start), payments: [...seen, reference].slice(-20) },
  });
  if (updateError) return new Response("could not update the account", { status: 500 });  // Paystack retries on errors
  return new Response("premium on");
});
