import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { ACCOUNTS, accountsEnabled } from '../config';

// Sign-in and the plan (free / paid). Accounts hold an email, a display name and the plan —
// never photos, which stay on the device. With no Supabase keys in config.ts this whole layer
// reports 'disabled' and the app behaves as it always has.

export interface Profile {
  displayName: string;
  plan: 'free' | 'lifetime';
}

export type AccountStatus = 'disabled' | 'loading' | 'signedOut' | 'signedIn';

interface AccountState {
  status: AccountStatus;
  user: User | null;
  profile: Profile | null;
  isPaid: boolean;
  // True after following a "reset your password" email link — the app asks for a new password.
  recovering: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsConfirmation: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  setNewPassword: (password: string) => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
  checkoutUrl: () => string | null;
}

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient | null {
  if (!accountsEnabled) return null;
  if (!client) client = createClient(ACCOUNTS.supabaseUrl, ACCOUNTS.supabaseAnonKey);
  return client;
}

// Where email links (confirm, reset password) send people back to: this page.
function siteUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

// Supabase's own messages are written for developers; these are for parents.
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return "That email and password don't match. Check them, or reset your password.";
  if (m.includes('already registered') || m.includes('already been registered')) return "There's already an account with that email — sign in instead.";
  if (m.includes('email not confirmed')) return 'Please confirm your email first — we sent you a link when you signed up.';
  if (m.includes('password should be') || m.includes('weak')) return 'Please choose a longer password (at least 8 characters).';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many tries — please wait a minute and try again.';
  if (m.includes('fetch') || m.includes('network')) return "Couldn't reach the sign-in service. Check your connection and try again.";
  return message;
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(friendly(error.message));
}

const AccountContext = createContext<AccountState | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountStatus>(accountsEnabled ? 'loading' : 'disabled');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recovering, setRecovering] = useState(false);

  const loadProfile = useCallback(async (u: User | null): Promise<Profile | null> => {
    const sb = supabase();
    if (!sb || !u) {
      setProfile(null);
      return null;
    }
    const { data } = await sb.from('profiles').select('display_name, plan').eq('id', u.id).maybeSingle();
    const next: Profile = {
      displayName: data?.display_name || (u.user_metadata?.display_name as string) || '',
      plan: data?.plan === 'lifetime' ? 'lifetime' : 'free',
    };
    setProfile(next);
    return next;
  }, []);

  useEffect(() => {
    const sb = supabase();
    if (!sb) return;
    let active = true;
    sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      const u = data.session?.user ?? null;
      setUser(u);
      setStatus(u ? 'signedIn' : 'signedOut');
      loadProfile(u);
    });
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      setStatus(u ? 'signedIn' : 'signedOut');
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      // Deferred: Supabase advises against awaiting its own calls inside this callback.
      setTimeout(() => loadProfile(u), 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // Coming back to the tab (e.g. from the checkout page) re-checks the plan.
  useEffect(() => {
    if (!user) return;
    const onFocus = () => {
      if (document.visibilityState === 'visible') loadProfile(user);
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, loadProfile]);

  const value = useMemo<AccountState>(
    () => ({
      status,
      user,
      profile,
      isPaid: profile?.plan === 'lifetime',
      recovering,
      async signUp(email, password, displayName) {
        const sb = supabase();
        if (!sb) throw new Error('Accounts are not set up yet.');
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName }, emailRedirectTo: siteUrl() },
        });
        fail(error);
        // With email confirmation on (the Supabase default) there's no session until the link
        // in the email is clicked.
        return { needsConfirmation: !data.session };
      },
      async signIn(email, password) {
        const sb = supabase();
        if (!sb) throw new Error('Accounts are not set up yet.');
        const { error } = await sb.auth.signInWithPassword({ email, password });
        fail(error);
      },
      async signOut() {
        await supabase()?.auth.signOut();
        setProfile(null);
      },
      async sendPasswordReset(email) {
        const sb = supabase();
        if (!sb) throw new Error('Accounts are not set up yet.');
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: siteUrl() });
        fail(error);
      },
      async setNewPassword(password) {
        const sb = supabase();
        if (!sb) throw new Error('Accounts are not set up yet.');
        const { error } = await sb.auth.updateUser({ password });
        fail(error);
        setRecovering(false);
      },
      refreshProfile: () => loadProfile(user),
      checkoutUrl() {
        if (!ACCOUNTS.checkoutUrl || !user) return null;
        // Lemon Squeezy passes custom data through to the webhook, which uses user_id to mark
        // this account as paid; the email is pre-filled so the receipt goes to the same place.
        const url = new URL(ACCOUNTS.checkoutUrl);
        url.searchParams.set('checkout[custom][user_id]', user.id);
        if (user.email) url.searchParams.set('checkout[email]', user.email);
        return url.toString();
      },
    }),
    [status, user, profile, recovering, loadProfile],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountState {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used inside AccountProvider');
  return ctx;
}
