import Logo from './Logo';

interface LandingPageProps {
  onGetStarted: () => void;
}

const STEPS = [
  {
    n: '1',
    emoji: '📤',
    title: 'Upload',
    body: 'Drop in photos from your camera roll, phone, or computer.',
  },
  {
    n: '2',
    emoji: '🔄',
    title: 'Swipe to tidee up',
    body: 'Fly through one photo at a time — swipe right to keep, left to delete, up to save to an album. Free on-device checks flag blurry shots and duplicates as you go.',
  },
  {
    n: '3',
    emoji: '📁',
    title: 'Share',
    body: 'Group the best shots into albums, then export or share them with grandparents and the rest of the family.',
  },
];

const FEATURES = [
  {
    emoji: '👀',
    title: 'Face-aware sorting',
    body: "Picks the best shot out of every burst by who's actually in it — eyes open, facing the camera, genuinely smiling — not just whichever frame is technically sharpest.",
  },
  {
    emoji: '🎯',
    title: 'Burst & duplicate cleanup',
    body: 'Ten near-identical shots from the same moment get quietly reduced to the one worth keeping, automatically.',
  },
  {
    emoji: '🌀',
    title: 'Blur & closed-eyes detection',
    body: 'Flags out-of-focus, poorly-exposed, and blinking shots for you to skip — so you never build an album around a bad photo by accident.',
  },
  {
    emoji: '🤳',
    title: 'Screenshot & document filtering',
    body: 'Recipe screenshots, receipts, and app grabs get set aside separately, so they never clutter up your actual memories.',
  },
  {
    emoji: '👨‍👩‍👧',
    title: 'People, auto-grouped',
    body: "Kept photos get clustered by who's in them, so \"every photo of Grandma\" or \"all of Emma this year\" is one tap away.",
  },
  {
    emoji: '📅',
    title: 'Organized by month',
    body: 'Your camera roll sorts itself into a real timeline — no manual date-wrangling required.',
  },
  {
    emoji: '✏️',
    title: 'Captions that stick',
    body: 'Add a note to any photo once, and it carries straight through into every album, export, and shared page.',
  },
  {
    emoji: '📁',
    title: 'Smart album names',
    body: 'Big days and recurring dates get a suggested album name pulled straight from the photos themselves.',
  },
  {
    emoji: '📤',
    title: 'Share your way',
    body: 'Export a zip of the originals, or generate one shareable page grandparents can open and save photos from — no app, no account.',
  },
];

const FAQS = [
  {
    q: 'Is it actually free?',
    a: 'Yes — every feature works with no account and no cost. Nothing to upgrade, nothing hidden behind a paywall.',
  },
  {
    q: 'Do my photos get uploaded anywhere?',
    a: 'No, never. Every check — blur, faces, duplicates, everything — runs entirely on your own device. No photo ever leaves your browser.',
  },
  {
    q: 'What happens to the originals when I hit delete?',
    a: "Nothing — \"Delete\" only removes the photo from Tidee Moments' own copy. It never touches your camera roll or the original file on your device.",
  },
  {
    q: 'Does it work on my phone?',
    a: "Yes, it's a website that works in any modern mobile or desktop browser — nothing to install.",
  },
  {
    q: "What if it's screenshots, not photos?",
    a: 'Screenshots are detected automatically and kept in a separate pile from your actual memories, so they never clutter up your photo bundles.',
  },
];

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 pt-10 pb-16">
        <header className="flex items-center gap-3 mb-10">
          <Logo className="w-11 h-11 sm:w-12 sm:h-12" />
          <div>
            <span
              className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight leading-none bg-clip-text text-transparent"
              style={{ backgroundImage: 'linear-gradient(90deg, #EA7987, #C9505F)' }}
            >
              tidee moments
            </span>
            <p className="text-xs text-white mt-1">Turn a photo pile into keepsakes ✨</p>
          </div>
        </header>

        <section className="text-center mb-12">
          <p className="text-stone-400 max-w-xl mx-auto mb-6 mt-2">
            Tidee Moments helps busy parents blaze through thousands of camera-roll photos in minutes —
            swipe to tidee up, let free on-device checks flag the blurry ones, and save what matters into
            albums you can share.
          </p>
          <button
            onClick={onGetStarted}
            className="bg-rose-400 hover:bg-rose-500 text-white font-semibold text-lg px-8 py-3 rounded-full shadow-md hover:shadow-lg hover:scale-105 transition-all"
          >
            Tidee up for free →
          </button>
          <p className="text-xs text-stone-500 mt-3">No account needed · Free to start</p>
        </section>

        <section className="mb-14">
          <h2 className="text-center font-bold text-stone-100 text-xl mb-6">How it works</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {STEPS.map((s) => (
              <div key={s.n} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-7 h-7 shrink-0 rounded-full bg-rose-400 text-white text-sm font-bold flex items-center justify-center">
                    {s.n}
                  </span>
                  <span className="text-2xl">{s.emoji}</span>
                </div>
                <h3 className="font-bold text-stone-800 mb-1">{s.title}</h3>
                <p className="text-sm text-stone-500 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-14">
          <h2 className="text-center font-bold text-stone-100 text-xl mb-1">Everything runs on your device</h2>
          <p className="text-center text-sm text-stone-400 mb-6">No AI, no uploads, no subscription — just free, local checks doing the tedious part for you.</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm">
                <span className="text-2xl">{f.emoji}</span>
                <h3 className="font-bold text-stone-800 mt-2 mb-1">{f.title}</h3>
                <p className="text-sm text-stone-500 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-14">
          <h2 className="text-center font-bold text-stone-100 text-xl mb-6">Questions parents actually ask</h2>
          <div className="max-w-xl mx-auto flex flex-col gap-3">
            {FAQS.map((f) => (
              <details key={f.q} className="bg-white border border-stone-200 rounded-2xl p-4 group">
                <summary className="font-semibold text-stone-700 cursor-pointer list-none flex items-center justify-between">
                  {f.q}
                  <span className="text-rose-300 group-open:rotate-45 transition-transform text-xl leading-none">+</span>
                </summary>
                <p className="text-sm text-stone-500 mt-2 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="text-center bg-gradient-to-br from-rose-50 via-white to-rose-50 border border-stone-200 rounded-2xl p-8">
          <h2 className="font-bold text-stone-800 text-xl mb-2">Ready to tidy up your memories?</h2>
          <p className="text-sm text-stone-500 mb-5">
            Built for busy parents, grandparents preserving family memories, and anyone with a camera roll
            they've been meaning to tidee up for years.
          </p>
          <button
            onClick={onGetStarted}
            className="bg-rose-400 hover:bg-rose-500 text-white font-semibold px-6 py-2.5 rounded-full shadow-sm hover:shadow-md hover:scale-105 transition-all"
          >
            Tidee up for free →
          </button>
        </section>
      </div>
    </div>
  );
}
