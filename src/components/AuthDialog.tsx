import { useState, type FormEvent } from 'react';
import { useAccount } from '../lib/account';

export type AuthMode = 'signIn' | 'signUp' | 'forgot' | 'reset';

interface AuthDialogProps {
  initialMode?: AuthMode;
  // Shown above the form when the dialog was opened for a reason ("Create a free account to unlock").
  reason?: string;
  onClose: () => void;
  onSignedIn?: () => void;
}

const inputClass =
  'w-full bg-white border border-black/10 rounded-xl px-4 py-3 text-[15px] text-[#231F1B] focus:outline-none focus:border-[#BB5133]/60';

// Sign in, create an account, forgot password and set a new password — one small dialog.
export default function AuthDialog({ initialMode = 'signIn', reason, onClose, onSignedIn }: AuthDialogProps) {
  const account = useAccount();
  const [mode, setMode] = useState<AuthMode>(account.recovering ? 'reset' : initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchTo(next: AuthMode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signUp') {
        const { needsConfirmation } = await account.signUp(email.trim(), password, name.trim());
        if (needsConfirmation) {
          setNotice(`Almost done — we've sent a link to ${email.trim()}. Tap it to confirm your account, then come back here.`);
        } else {
          onSignedIn?.();
          onClose();
        }
      } else if (mode === 'signIn') {
        await account.signIn(email.trim(), password);
        onSignedIn?.();
        onClose();
      } else if (mode === 'forgot') {
        await account.sendPasswordReset(email.trim());
        setNotice(`If there's an account for ${email.trim()}, a reset link is on its way. Open it on this device.`);
      } else {
        await account.setNewPassword(password);
        setNotice("Your password has been changed. You're signed in.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const title = { signIn: 'Welcome back', signUp: 'Create your account', forgot: 'Reset your password', reset: 'Choose a new password' }[mode];
  const button = { signIn: 'Sign in', signUp: 'Create account', forgot: 'Send reset link', reset: 'Save new password' }[mode];

  return (
    <div className="fixed inset-0 z-[55] bg-black/40 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-sm bg-[#FBF8F2] rounded-3xl p-6 shadow-xl text-[#231F1B]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h2 className="font-serif text-3xl">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-[#8A8177] hover:text-[#231F1B] p-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {reason && <p className="text-sm text-[#5B5349] mb-1">{reason}</p>}
        <p className="text-xs text-[#8A8177] mb-5">Your account holds your email, name and plan — never your photos.</p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === 'signUp' && (
            <input className={inputClass} placeholder="Your first name" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} required />
          )}
          {mode !== 'reset' && (
            <input className={inputClass} type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          )}
          {mode !== 'forgot' && (
            <input
              className={inputClass}
              type="password"
              placeholder={mode === 'signIn' ? 'Password' : 'New password (8+ characters)'}
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              minLength={mode === 'signIn' ? undefined : 8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
          {error && (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" role="alert">
              {error}
            </p>
          )}
          {notice ? (
            <p className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2" role="status">
              {notice}
            </p>
          ) : (
            <button type="submit" disabled={busy} className="w-full bg-[#231F1B] hover:bg-black text-white font-medium py-3.5 rounded-full transition-colors disabled:opacity-50">
              {busy ? 'One moment…' : button}
            </button>
          )}
        </form>

        <div className="text-sm text-[#8A8177] mt-4 flex flex-col items-center gap-2">
          {mode === 'signIn' && (
            <>
              <button onClick={() => switchTo('forgot')} className="hover:text-[#231F1B]">Forgot your password?</button>
              <span>
                New here?{' '}
                <button onClick={() => switchTo('signUp')} className="text-[#BB5133] font-medium hover:underline">Create an account</button>
              </span>
            </>
          )}
          {mode === 'signUp' && (
            <span>
              Already have an account?{' '}
              <button onClick={() => switchTo('signIn')} className="text-[#BB5133] font-medium hover:underline">Sign in</button>
            </span>
          )}
          {mode === 'forgot' && (
            <button onClick={() => switchTo('signIn')} className="text-[#BB5133] font-medium hover:underline">Back to sign in</button>
          )}
        </div>
      </div>
    </div>
  );
}
