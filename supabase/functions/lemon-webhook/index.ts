// Supabase Edge Function: Lemon Squeezy calls this after a purchase, and it marks the buyer's
// Tidee Moments account as paid. Deploy it as "lemon-webhook" (see SETUP-ACCOUNTS.md) with
// "Verify JWT" turned OFF — Lemon Squeezy signs its requests instead, and that signature is
// checked below with the secret you set as LEMON_SQUEEZY_WEBHOOK_SECRET.
//
// The checkout link the app opens carries the buyer's account id as custom data
// (checkout[custom][user_id]), which comes back here in meta.custom_data.user_id.
import { createClient } from 'npm:@supabase/supabase-js@2';

const encoder = new TextEncoder();

async function signatureMatches(body: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  // Constant-time comparison.
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = Deno.env.get('LEMON_SQUEEZY_WEBHOOK_SECRET');
  if (!secret) return new Response('Webhook secret not configured', { status: 500 });

  const body = await req.text();
  const signature = req.headers.get('X-Signature') ?? '';
  if (!(await signatureMatches(body, signature, secret))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(body);
  const eventName: string = event?.meta?.event_name ?? '';
  const userId: string | undefined = event?.meta?.custom_data?.user_id;
  const order = event?.data?.attributes ?? {};

  // Only a paid order unlocks; refunds put the account back to free.
  const paid = eventName === 'order_created' && order.status === 'paid';
  const refunded = eventName === 'order_refunded';
  if ((!paid && !refunded) || !userId) {
    return new Response('Ignored', { status: 200 });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error } = await admin
    .from('profiles')
    .update(
      paid
        ? { plan: 'lifetime', paid_at: new Date().toISOString(), lemon_order_id: String(event?.data?.id ?? '') }
        : { plan: 'free', paid_at: null },
    )
    .eq('id', userId);
  if (error) return new Response(`Database error: ${error.message}`, { status: 500 });

  return new Response('OK', { status: 200 });
});
