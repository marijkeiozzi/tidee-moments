interface LandingPageProps {
  onGetStarted: () => void;
}

const STEPS = [
  {
    n: '1',
    emoji: '📥',
    title: 'Bring in the whole roll',
    body: 'Drop in hundreds or thousands of photos at once. Screenshots and receipts go into their own pile, so only real memories get sorted.',
  },
  {
    n: '2',
    emoji: '✨',
    title: 'It sorts itself',
    body: 'Photos are grouped into moments. Near-identical shots are cut down to the best one, and blank or badly blurred shots are set aside — all on your device, nothing uploaded.',
  },
  {
    n: '3',
    emoji: '💌',
    title: 'Check, then share',
    body: 'Tap any photo to keep it or set it aside, then save the keepers as an album. Share it as a single page or a zip with grandparents and the rest of the family.',
  },
];

const FEATURES = [
  {
    emoji: '👀',
    title: 'Face-aware sorting',
    body: "When you've taken several shots of the same moment, it keeps the one where faces are turned to the camera, eyes are open and smiles are biggest — not just whichever frame is sharpest.",
  },
  {
    emoji: '🎯',
    title: 'Burst & duplicate cleanup',
    body: 'A run of near-identical shots of the same moment — even ten in a row — is cut down to the single best one, automatically.',
  },
  {
    emoji: '🌀',
    title: 'Blur & closed-eyes detection',
    body: 'Blank and badly blurred shots are set aside. Kept photos with closed eyes, soft focus or poor light get a "worth a look" badge, so a bad photo never slips into an album unnoticed.',
  },
  {
    emoji: '🤳',
    title: 'Screenshot & document filtering',
    body: 'Screenshots, receipts and app grabs are set aside in their own pile, so they never clutter up your actual memories.',
  },
  {
    emoji: '👨‍👩‍👧',
    title: 'People, auto-grouped',
    body: 'Kept photos are grouped by the faces in them, automatically. Name someone once, and every photo of Grandma is one tap away.',
  },
  {
    emoji: '📅',
    title: 'Organized by month',
    body: 'Every photo you keep lands on a month-by-month timeline, using the date it was taken — no manual date-wrangling required.',
  },
  {
    emoji: '✏️',
    title: 'Captions that stick',
    body: 'Add a caption to any photo once. It shows under the photo on your shared page and becomes its file name in the zip export.',
  },
  {
    emoji: '📁',
    title: 'Smart album names',
    body: "A day full of photos gets suggested as a big day, and a date that matches an earlier year's event album — a birthday, say — reuses that album's name.",
  },
  {
    emoji: '📤',
    title: 'Share your way',
    body: 'Export a zip of the full-size photos, or make one shareable page grandparents can open and save photos from — no app, no account.',
  },
];

const FAQS = [
  {
    q: 'Is it actually free?',
    a: 'Yes — every feature works with no account and no cost. Nothing to upgrade, nothing hidden behind a paywall.',
  },
  {
    q: 'Do my photos get uploaded anywhere?',
    a: 'No, never. Every check — blur, faces, duplicates, everything — runs on your own device, inside your browser. No photo is ever sent to a server.',
  },
  {
    q: 'What happens to the originals when I set a photo aside?',
    a: 'Nothing. Tidee Moments works on its own copy of your photos, stored in your browser. Setting a photo aside only affects that copy — your camera roll and original files are never touched.',
  },
  {
    q: 'Does it work on my phone?',
    a: "Yes, it's a website that runs in any up-to-date phone or computer browser — nothing to install. Very large batches sort faster on a computer.",
  },
  {
    q: "What if it's screenshots, not photos?",
    a: 'Screenshots are detected automatically and kept in a separate pile from your memories, so they never clutter up your albums. You can still look through that pile and keep anything you want.',
  },
];

// Warm gradient "photos" for the hero collage — abstract, no real photo assets needed, tuned to
// evoke beach/golden-hour/cozy-indoor family moments in the same warm palette as the page itself.
function PolaroidPhoto({ gradient, className }: { gradient: string; className?: string }) {
  return (
    <div className={`absolute bg-white p-2 pb-8 rounded-sm shadow-xl ${className ?? ''}`}>
      <div className="w-full h-full rounded-[2px]" style={{ background: gradient }} />
    </div>
  );
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-[#F6F1E7] text-[#231F1B]">
      <div className="max-w-6xl mx-auto px-6 sm:px-10">
        <header className="flex items-center justify-between py-6 border-b border-black/5">
          <span className="font-serif italic text-2xl sm:text-3xl tracking-tight">
            Tidee Moments<span className="text-[#BB5133]">.</span>
          </span>
          <nav className="hidden sm:flex items-center gap-8 text-[15px]">
            <button onClick={onGetStarted} className="text-[#231F1B] font-medium hover:opacity-70 transition-opacity">
              Albums
            </button>
            <button onClick={onGetStarted} className="text-[#8A8177] hover:text-[#231F1B] transition-colors">
              Sort photos
            </button>
          </nav>
          <button
            onClick={onGetStarted}
            className="bg-[#231F1B] text-white text-sm font-medium px-5 py-2.5 rounded-full hover:bg-black transition-colors"
          >
            Get started
          </button>
        </header>

        <section className="grid lg:grid-cols-2 gap-12 items-center py-16 sm:py-24">
          <div>
            <p className="text-[#BB5133] text-xs font-semibold tracking-[0.2em] uppercase mb-5">
              For parents with full camera rolls
            </p>
            <h1 className="font-serif text-5xl sm:text-6xl leading-[1.05] mb-6">
              Thousands of
              <br />
              photos.
              <br />
              <span className="italic text-[#BB5133]">Only the keepers.</span>
            </h1>
            <p className="text-[#5B5349] text-lg leading-relaxed max-w-md mb-8">
              Drop in the whole camera roll. We'll set aside the blurry shots and duplicates and keep the best of
              every run of near-identical photos, so your albums come together in minutes, not evenings.
            </p>
            <button
              onClick={onGetStarted}
              className="inline-flex items-center gap-2 bg-[#231F1B] text-white font-medium text-[15px] px-7 py-4 rounded-full hover:bg-black hover:scale-[1.02] transition-all"
            >
              Start sorting <span aria-hidden>→</span>
            </button>
          </div>

          <div className="relative h-[420px] hidden lg:block">
            <PolaroidPhoto
              gradient="linear-gradient(135deg, #F4D9A8 0%, #E8B77C 45%, #D99A6C 100%)"
              className="w-56 h-72 left-4 top-0 -rotate-6"
            />
            <PolaroidPhoto
              gradient="linear-gradient(135deg, #E7CCB8 0%, #C99A7C 55%, #8A6350 100%)"
              className="w-56 h-72 right-0 top-6 rotate-6"
            />
            <PolaroidPhoto
              gradient="linear-gradient(160deg, #EFE3C9 0%, #D9C79A 40%, #A8C08A 75%, #7FA06B 100%)"
              className="w-64 h-80 left-24 top-32 -rotate-3"
            />
          </div>
        </section>
      </div>

      <div className="max-w-3xl mx-auto px-6 sm:px-10 pb-16">
        <section className="mb-14">
          <h2 className="text-center font-serif text-2xl mb-8">How it works</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {STEPS.map((s) => (
              <div key={s.n} className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-7 h-7 shrink-0 rounded-full bg-[#BB5133] text-white text-sm font-bold flex items-center justify-center">
                    {s.n}
                  </span>
                  <span className="text-2xl">{s.emoji}</span>
                </div>
                <h3 className="font-bold text-[#231F1B] mb-1">{s.title}</h3>
                <p className="text-sm text-[#7A7266] leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-14">
          <h2 className="text-center font-serif text-2xl mb-1">Everything runs on your device</h2>
          <p className="text-center text-sm text-[#8A8177] mb-8">
            No uploads, no account, no subscription — the checks run on small models right in your browser, so your photos never leave your device.
          </p>
          <div className="grid sm:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm">
                <span className="text-2xl">{f.emoji}</span>
                <h3 className="font-bold text-[#231F1B] mt-2 mb-1">{f.title}</h3>
                <p className="text-sm text-[#7A7266] leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-14">
          <h2 className="text-center font-serif text-2xl mb-8">Questions parents actually ask</h2>
          <div className="max-w-xl mx-auto flex flex-col gap-3">
            {FAQS.map((f) => (
              <details key={f.q} className="bg-white border border-black/5 rounded-2xl p-4 group">
                <summary className="font-semibold text-[#231F1B] cursor-pointer list-none flex items-center justify-between">
                  {f.q}
                  <span className="text-[#BB5133] group-open:rotate-45 transition-transform text-xl leading-none">+</span>
                </summary>
                <p className="text-sm text-[#7A7266] mt-2 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="text-center bg-white border border-black/5 rounded-2xl p-10">
          <h2 className="font-serif text-2xl mb-2">Ready to tidy up your memories?</h2>
          <p className="text-sm text-[#7A7266] mb-6 max-w-md mx-auto">
            Built for busy parents, grandparents preserving family memories, and anyone with a camera roll they've
            been meaning to tidee up for years.
          </p>
          <button
            onClick={onGetStarted}
            className="inline-flex items-center gap-2 bg-[#231F1B] text-white font-medium px-7 py-3 rounded-full hover:bg-black hover:scale-[1.02] transition-all"
          >
            Start sorting <span aria-hidden>→</span>
          </button>
        </section>
      </div>
    </div>
  );
}
