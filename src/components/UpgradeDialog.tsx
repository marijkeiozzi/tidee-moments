import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../lib/account';
import { PRICING } from '../config';
import AuthDialog from './AuthDialog';

interface UpgradeDialogProps {
  savingCount: number; // photos in the album being saved
  alreadySaved: number; // photos already kept before this album
  onUnlocked: () => void;
  onClose: () => void;
}

const POLL_MS = 4000;

// Shown when saving would go past the free limit. Two steps: an account (so the purchase
// belongs to someone and follows them to any device), then a one-time payment on Lemon
// Squeezy in a new tab. When the payment lands, the plan flips and saving carries on by itself.
export default function UpgradeDialog({ savingCount, alreadySaved, onUnlocked, onClose }: UpgradeDialogProps) {
  const account = useAccount();
  const [authOpen, setAuthOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState<string | null>(null);

  // Already unlocked (e.g. paid on another device, or the webhook just landed) → carry on, once.
  const continued = useRef(false);
  useEffect(() => {
    if (account.isPaid && !continued.current) {
      continued.current = true;
      onUnlocked();
    }
  }, [account.isPaid, onUnlocked]);

  // While the checkout tab is open, keep checking for the payment.
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => account.refreshProfile(), POLL_MS);
    return () => clearInterval(id);
  }, [waiting, account]);

  const remaining = Math.max(0, PRICING.freePhotoLimit - alreadySaved);

  function openCheckout() {
    const url = account.checkoutUrl();
    if (!url) return;
    const tab = window.open(url, '_blank', 'noopener');
    // Some in-app browsers block new tabs — then offer a plain link to tap.
    if (!tab) setPopupBlocked(url);
    setWaiting(true);
  }

  const signedIn = account.status === 'signedIn';

  return (
    <div className="fixed inset-0 z-[52] bg-black/40 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm bg-[#FBF8F2] rounded-3xl p-6 shadow-xl text-[#231F1B]">
        <p className="text-[#BB5133] text-xs font-semibold tracking-[0.2em] uppercase mb-2">Unlock Tidee Moments</p>
        <h2 className="font-serif text-3xl mb-2">Keep every keeper</h2>
        <p className="text-sm text-[#5B5349] mb-1">
          You're saving {savingCount.toLocaleString()} photos. The free plan saves up to {PRICING.freePhotoLimit} in total
          {alreadySaved > 0 ? ` and you've used ${Math.min(alreadySaved, PRICING.freePhotoLimit)}` : ''}
          {remaining > 0 ? ` — ${remaining} left.` : '.'}
        </p>
        <p className="text-sm text-[#5B5349] mb-5">
          Unlock unlimited albums for <strong>{PRICING.priceLabel}, once</strong>. No subscription, and your photos still never leave
          your device.
        </p>

        {!signedIn ? (
          <>
            <button
              onClick={() => setAuthOpen(true)}
              className="w-full bg-[#231F1B] hover:bg-black text-white font-medium py-3.5 rounded-full transition-colors"
            >
              Create a free account to continue
            </button>
            <p className="text-xs text-[#8A8177] mt-2 text-center">So your purchase works on all your devices.</p>
          </>
        ) : waiting ? (
          <div className="text-center" role="status">
            <div className="w-8 h-8 mx-auto mb-3 rounded-full border-4 border-[#EFDFC8] border-t-[#BB5133] animate-spin" />
            <p className="text-sm text-[#231F1B] font-medium">Waiting for your payment…</p>
            <p className="text-xs text-[#8A8177] mt-1">Finish checkout in the other tab — your album saves by itself as soon as it's done.</p>
            {popupBlocked && (
              <a href={popupBlocked} target="_blank" rel="noopener" className="inline-block mt-3 text-sm text-[#BB5133] font-medium underline">
                Open checkout
              </a>
            )}
            <button onClick={openCheckout} className="block mx-auto mt-3 text-xs text-[#8A8177] hover:text-[#231F1B]">
              Checkout didn't open? Try again
            </button>
          </div>
        ) : (
          <button
            onClick={openCheckout}
            className="w-full bg-[#231F1B] hover:bg-black text-white font-medium py-3.5 rounded-full transition-colors"
          >
            Unlock for {PRICING.priceLabel}
          </button>
        )}

        <button onClick={onClose} className="w-full text-sm text-[#8A8177] hover:text-[#231F1B] mt-3">
          Not now — keep reviewing
        </button>
      </div>
      {authOpen && (
        <AuthDialog
          initialMode="signUp"
          reason="Create a free account first — it takes a few seconds."
          onClose={() => setAuthOpen(false)}
        />
      )}
    </div>
  );
}
