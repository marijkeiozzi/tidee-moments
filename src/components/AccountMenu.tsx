import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../lib/account';
import { PRICING } from '../config';
import AuthDialog from './AuthDialog';

// The header's account control: "Sign in" when signed out, the person's name (and plan) when
// signed in. Renders nothing at all while accounts aren't set up (config.ts).
export default function AccountMenu() {
  const account = useAccount();
  const [dialog, setDialog] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A "reset your password" link opens straight into the new-password form.
  useEffect(() => {
    if (account.recovering) setDialog(true);
  }, [account.recovering]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (account.status === 'disabled' || account.status === 'loading') return null;

  if (account.status === 'signedOut') {
    return (
      <>
        <button onClick={() => setDialog(true)} className="whitespace-nowrap text-[#8A8177] hover:text-[#231F1B] transition-colors">
          Sign in
        </button>
        {dialog && <AuthDialog onClose={() => setDialog(false)} />}
      </>
    );
  }

  const name = account.profile?.displayName || account.user?.email?.split('@')[0] || 'You';
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 whitespace-nowrap text-[#231F1B]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="w-7 h-7 rounded-full bg-[#BB5133] text-white text-sm font-semibold flex items-center justify-center">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden sm:inline">{name}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-white border border-black/10 rounded-2xl shadow-lg p-4 z-50 text-sm" role="menu">
          <p className="font-semibold text-[#231F1B] truncate">{name}</p>
          <p className="text-[#8A8177] truncate mb-3">{account.user?.email}</p>
          <p className="mb-3">
            {account.isPaid ? (
              <span className="inline-block bg-[#BB5133]/10 text-[#BB5133] font-semibold text-xs px-2.5 py-1 rounded-full">Unlocked — thank you!</span>
            ) : (
              <span className="text-[#5B5349]">Free plan · save up to {PRICING.freePhotoLimit} photos</span>
            )}
          </p>
          <button
            onClick={async () => {
              setOpen(false);
              await account.signOut();
            }}
            className="text-[#8A8177] hover:text-[#231F1B]"
            role="menuitem"
          >
            Sign out
          </button>
        </div>
      )}
      {dialog && <AuthDialog onClose={() => setDialog(false)} />}
    </div>
  );
}
