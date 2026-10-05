# Switching on accounts and payments

Tidee Moments has sign-up, sign-in and a one-time unlock built in. They stay switched off
until the three public values in `src/config.ts` are filled in — until then the site works
exactly as before (no sign-in, no paywall).

You'll create two free accounts:

- **Supabase** — stores each person's email, display name and plan (free or unlocked).
  Never photos.
- **Lemon Squeezy** — takes the payment, handles sales tax/VAT, and emails receipts.

Allow about 30–45 minutes. Do everything in **test mode** first; switch to live at the end.

---

## Part 1 — Supabase (accounts)

1. Go to [supabase.com](https://supabase.com) → **Start your project** → sign up.
2. **New project**: name it `tidee-moments`, pick a strong database password (save it in
   your password manager), choose the region nearest your customers → **Create**.
   Wait a minute for it to finish setting up.
3. **Create the database table.** Left menu → **SQL Editor** → **New query**. Open
   `supabase/migrations/001_profiles.sql` from this project, copy all of it, paste it in,
   and press **Run**. You should see "Success. No rows returned".
4. **Tell Supabase where the site lives.** Left menu → **Authentication** → **URL
   Configuration**:
   - **Site URL**: `https://marijkeiozzi.github.io/tidee-moments/`
   - **Redirect URLs** → Add: `https://marijkeiozzi.github.io/tidee-moments/**`
5. **Email settings.** Authentication → **Providers** → **Email**: leave **Confirm email**
   on (people confirm their address once). Supabase's built-in email sender only sends a few
   emails an hour — fine for testing. Before launch, add your own email sender under
   **Authentication → Emails → SMTP Settings** (e.g. Resend or Postmark, both have free tiers).
6. **Copy the two public values** — left menu → **Project Settings** → **API**:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (a long string starting `eyJ…`)

   These two are safe to share with me — they're designed to be public. **Never** send the
   **service_role** key to anyone.

## Part 2 — Lemon Squeezy (payments)

1. Go to [lemonsqueezy.com](https://www.lemonsqueezy.com) → sign up → create your store.
   (They'll ask for business and payout details before you can go live.)
2. Make sure **Test mode** is on (toggle at the bottom-left of the dashboard).
3. **Products** → **New product**:
   - Name: `Tidee Moments — Unlock`
   - Pricing: **Single payment**, your price (the app currently shows **$12** — tell me if
     you choose something else and I'll change the label)
   - Under **Confirmation modal** / button link, set the button to go back to
     `https://marijkeiozzi.github.io/tidee-moments/`
   - **Publish** the product.
4. On the product, click **Share** and copy the **checkout link**
   (looks like `https://yourstore.lemonsqueezy.com/buy/1234abcd-…`).

## Part 3 — Connect payments to accounts (the webhook)

This small server function marks someone as "unlocked" the moment Lemon Squeezy confirms
their payment.

1. In Supabase: left menu → **Edge Functions** → **Deploy a new function** → **Via editor**.
   - Name it exactly `lemon-webhook`.
   - Replace the sample code with everything in `supabase/functions/lemon-webhook/index.ts`.
   - Click **Deploy**.
   - Open the function's **Details / Settings** and turn **Enforce JWT verification OFF**
     (Lemon Squeezy proves who it is with its own signature instead), then save.
   - Copy the function URL (looks like
     `https://abcdefgh.supabase.co/functions/v1/lemon-webhook`).
2. In Lemon Squeezy: **Settings** → **Webhooks** → **+** (add):
   - **Callback URL**: the function URL from step 1
   - **Signing secret**: make up a long random password (save it — you need it once more)
   - **Events**: tick `order_created` and `order_refunded`
   - Save.
3. Back in Supabase: **Edge Functions** → **Secrets** (or Project Settings → Edge
   Functions) → add a secret:
   - Name: `LEMON_SQUEEZY_WEBHOOK_SECRET`
   - Value: the same signing secret from step 2.

## Part 4 — Send me three values

Send me:

1. the Supabase **Project URL**
2. the Supabase **anon public** key
3. the Lemon Squeezy **checkout link**

I'll put them into `src/config.ts`, deploy, and walk through a test purchase with you using
Lemon Squeezy's test card (`4242 4242 4242 4242`, any future date, any CVC).

## Part 5 — Going live

When the test purchase works:

1. In Lemon Squeezy, switch **Test mode** off. Products and webhooks are separate in live
   mode — re-create the product and the webhook there (same settings), and send me the
   **live** checkout link.
2. Add a real email sender in Supabase (Part 1, step 5).
3. Publish a privacy policy and terms (needed before taking money) — I can draft them once you
   send your business name and support email.

---

### What's stored, and where

| Where | What | Never |
| --- | --- | --- |
| Supabase | Email, password (hashed by Supabase), display name, plan, payment date, order number | Photos, captions, albums |
| Lemon Squeezy | Name, email, payment details, receipt | Photos |
| The person's own device | Every photo, album, caption and backup | — |

### Changing the price or the free limit

Both are in `src/config.ts` (`PRICING`). The price there is only the label shown in the app —
the real price is whatever the Lemon Squeezy product charges, so change both together.
