// Accounts and payments — the one place to change the price, the free limit and the keys.
//
// Everything here is PUBLIC by design: it ships to every visitor's browser. The Supabase "anon"
// key can only do what the database's row-level security allows (see supabase/migrations), and
// the payment secrets never live here — they're set inside Supabase (see SETUP-ACCOUNTS.md).
//
// Leave supabaseUrl / supabaseAnonKey empty and the app runs exactly as before: no sign-in,
// no paywall. Paste them in (and the checkout link) to switch accounts and payments on.

export const ACCOUNTS = {
  // Supabase → Project Settings → API → Project URL, e.g. 'https://abcdefgh.supabase.co'
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  // Supabase → Project Settings → API → "anon public" key
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  // Lemon Squeezy → Products → your product → Share → checkout link
  checkoutUrl: import.meta.env.VITE_LEMON_CHECKOUT_URL || '',
};

export const PRICING = {
  // Photos anyone can save for free; saving past this asks for the one-time unlock.
  freePhotoLimit: Number(import.meta.env.VITE_FREE_PHOTO_LIMIT) || 200,
  // Shown on the unlock screen — keep it in step with the price set in Lemon Squeezy.
  priceLabel: '$12',
};

export const accountsEnabled = Boolean(ACCOUNTS.supabaseUrl && ACCOUNTS.supabaseAnonKey);
export const paymentsEnabled = accountsEnabled && Boolean(ACCOUNTS.checkoutUrl);
