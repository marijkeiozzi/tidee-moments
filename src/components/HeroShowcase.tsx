import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';

// The landing page's live hero: a 3D stack of polaroids that tilts with the cursor and plays a
// looping "sorting" demo — blurry and duplicate shots grey out and sink back, keepers lift
// forward with a badge. Pure CSS 3D + framer-motion (already a dependency), no WebGL, so it
// stays light on phones. Honors prefers-reduced-motion with a still frame.

type Verdict = 'keeper' | 'blurry' | 'duplicate';

interface Card {
  id: string;
  scene: ReactNode;
  verdict: Verdict;
  // resting position in the stack (px / deg); z is depth toward the viewer
  x: number;
  y: number;
  z: number;
  rotate: number;
  w: number;
}

// --- Illustrated "photos" (flat SVG scenes in the site's warm palette) ---------------------

function Beach() {
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full block" aria-hidden>
      <defs>
        <linearGradient id="sky1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F7C59F" />
          <stop offset="1" stopColor="#F29E7C" />
        </linearGradient>
      </defs>
      <rect width="200" height="160" fill="url(#sky1)" />
      <circle cx="140" cy="78" r="26" fill="#FBE3B5" />
      <rect y="92" width="200" height="30" fill="#D98A6C" />
      <rect y="96" width="200" height="4" fill="#E8A688" opacity=".7" />
      <path d="M0 118 Q60 108 120 116 T200 112 V160 H0Z" fill="#EBC79B" />
      {/* parent and child silhouettes holding hands */}
      <g fill="#5B3A37">
        <circle cx="62" cy="96" r="6" />
        <rect x="56" y="102" width="12" height="20" rx="5" />
        <rect x="57" y="120" width="4" height="12" rx="2" />
        <rect x="63" y="120" width="4" height="12" rx="2" />
        <circle cx="82" cy="108" r="4.5" />
        <rect x="78" y="112" width="9" height="13" rx="4" />
        <rect x="79" y="124" width="3" height="8" rx="1.5" />
        <rect x="83" y="124" width="3" height="8" rx="1.5" />
        <path d="M67 108 L79 114" stroke="#5B3A37" strokeWidth="2.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function Birthday() {
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full block" aria-hidden>
      <rect width="200" height="160" fill="#F3DCCB" />
      <g opacity=".55">
        <circle cx="30" cy="30" r="3" fill="#E7867A" />
        <circle cx="170" cy="22" r="3" fill="#E9B86A" />
        <circle cx="150" cy="58" r="2.5" fill="#BB5133" />
        <circle cx="48" cy="64" r="2.5" fill="#E9B86A" />
      </g>
      {/* bunting */}
      <path d="M0 14 Q100 40 200 14" stroke="#C99A7C" strokeWidth="1.5" fill="none" />
      {[20, 50, 80, 110, 140, 170].map((x, i) => (
        <path key={x} d={`M${x - 8} ${18 + Math.sin((x / 200) * Math.PI) * 18} l8 14 l8 -14z`} fill={['#E7867A', '#E9B86A', '#BB5133'][i % 3]} />
      ))}
      <rect x="20" y="128" width="160" height="32" fill="#D7B49A" />
      {/* cake */}
      <rect x="62" y="96" width="76" height="34" rx="6" fill="#FFF6EC" />
      <rect x="62" y="96" width="76" height="10" rx="5" fill="#E7867A" />
      <rect x="72" y="74" width="56" height="24" rx="6" fill="#FFF6EC" />
      <rect x="72" y="74" width="56" height="8" rx="4" fill="#E9B86A" />
      {[86, 100, 114].map((x) => (
        <g key={x}>
          <rect x={x - 2} y="60" width="4" height="15" rx="2" fill="#BB5133" />
          <ellipse cx={x} cy="55" rx="3" ry="5" fill="#F6B04D" />
        </g>
      ))}
    </svg>
  );
}

function Swing() {
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full block" aria-hidden>
      <defs>
        <linearGradient id="sky3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#CFE3D4" />
          <stop offset="1" stopColor="#EEF0D8" />
        </linearGradient>
      </defs>
      <rect width="200" height="160" fill="url(#sky3)" />
      <path d="M0 112 Q50 96 100 106 T200 100 V160 H0Z" fill="#9FBF85" />
      <path d="M0 128 Q70 116 140 126 T200 122 V160 H0Z" fill="#87AB6E" />
      <circle cx="160" cy="70" r="26" fill="#7FA06B" />
      <rect x="157" y="88" width="6" height="26" fill="#7A5A44" />
      {/* swing frame */}
      <path d="M40 40 H120" stroke="#7A5A44" strokeWidth="5" strokeLinecap="round" />
      <path d="M44 40 L30 124 M116 40 L130 124" stroke="#7A5A44" strokeWidth="4" strokeLinecap="round" />
      <path d="M70 42 L60 98 M92 42 L86 98" stroke="#5B3A37" strokeWidth="1.6" />
      <rect x="56" y="96" width="34" height="5" rx="2" fill="#5B3A37" />
      {/* child mid-swing */}
      <g fill="#BB5133">
        <circle cx="74" cy="72" r="7" fill="#5B3A37" />
        <rect x="66" y="79" width="16" height="18" rx="6" />
        <path d="M80 94 L96 102" stroke="#BB5133" strokeWidth="5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function Balloon() {
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full block" aria-hidden>
      <rect width="200" height="160" fill="#EAD9F0" />
      <rect y="118" width="200" height="42" fill="#D9C2A6" />
      <path d="M0 118 H200" stroke="#C9AE90" strokeWidth="2" />
      {/* balloons */}
      <path d="M128 70 Q120 100 112 120" stroke="#8A6E78" strokeWidth="1.2" fill="none" />
      <path d="M148 64 Q132 100 114 120" stroke="#8A6E78" strokeWidth="1.2" fill="none" />
      <ellipse cx="128" cy="48" rx="17" ry="21" fill="#E7867A" />
      <ellipse cx="150" cy="44" rx="15" ry="19" fill="#E9B86A" />
      {/* toddler */}
      <circle cx="96" cy="88" r="13" fill="#F1C6A8" />
      <path d="M84 84 Q96 66 108 84" fill="#7A5A44" />
      <rect x="82" y="100" width="28" height="24" rx="10" fill="#F2A7A0" />
      <path d="M108 106 L116 118" stroke="#F1C6A8" strokeWidth="5" strokeLinecap="round" />
      <circle cx="91" cy="89" r="1.4" fill="#5B3A37" />
      <circle cx="101" cy="89" r="1.4" fill="#5B3A37" />
      <path d="M92 95 Q96 98 100 95" stroke="#5B3A37" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Picnic() {
  return (
    <svg viewBox="0 0 200 160" className="w-full h-full block" aria-hidden>
      <rect width="200" height="160" fill="#F6E3B8" />
      <circle cx="40" cy="36" r="16" fill="#FBEFD2" />
      <path d="M0 90 Q100 74 200 92 V160 H0Z" fill="#B7C98E" />
      {/* checked blanket */}
      <path d="M30 150 L60 104 H160 L182 150Z" fill="#E7867A" />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${48 + i * 28} 150 L${70 + i * 24} 104`} stroke="#F6E3B8" strokeWidth="4" opacity=".7" />
      ))}
      <path d="M44 128 H172" stroke="#F6E3B8" strokeWidth="4" opacity=".7" />
      <rect x="94" y="96" width="30" height="20" rx="4" fill="#A0703F" />
      <path d="M98 96 Q109 82 120 96" stroke="#7A5A44" strokeWidth="3" fill="none" />
      <circle cx="140" cy="118" r="7" fill="#BB5133" />
      <circle cx="74" cy="122" r="6" fill="#E9B86A" />
    </svg>
  );
}

const CARDS: Card[] = [
  { id: 'picnic', scene: <Picnic />, verdict: 'duplicate', x: -150, y: -110, z: -60, rotate: -10, w: 200 },
  { id: 'balloon', scene: <Balloon />, verdict: 'keeper', x: 120, y: -120, z: -20, rotate: 8, w: 200 },
  { id: 'swing', scene: <Swing />, verdict: 'blurry', x: -170, y: 70, z: 10, rotate: -5, w: 190 },
  { id: 'birthday', scene: <Birthday />, verdict: 'keeper', x: 140, y: 80, z: 40, rotate: 7, w: 200 },
  { id: 'beach', scene: <Beach />, verdict: 'keeper', x: -10, y: -10, z: 90, rotate: -2, w: 250 },
];

const TAG: Record<Verdict, string> = { keeper: '✓ Keeper', blurry: 'Blurry', duplicate: 'Duplicate' };

// Loop: 0 = unsorted pile, 1 = sorted (rejects sink, keepers lift), held, then back.
const PHASE_MS = 2600;

export default function HeroShowcase() {
  const reduceMotion = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const [sorted, setSorted] = useState(false);
  const [count, setCount] = useState(0);

  // Cursor-driven tilt, springy so it feels physical.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateY = useSpring(useTransform(mx, [-1, 1], [-14, 14]), { stiffness: 80, damping: 18 });
  const rotateX = useSpring(useTransform(my, [-1, 1], [10, -10]), { stiffness: 80, damping: 18 });

  useEffect(() => {
    if (reduceMotion) {
      setSorted(true);
      setCount(2431);
      return;
    }
    const id = setInterval(() => setSorted((s) => !s), PHASE_MS);
    return () => clearInterval(id);
  }, [reduceMotion]);

  // Running "photos sorted" counter while the demo plays.
  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => setCount((c) => (c >= 2431 ? 0 : Math.min(2431, c + 37))), 80);
    return () => clearInterval(id);
  }, [reduceMotion]);

  // Without a cursor (phones), drift slowly on its own.
  useEffect(() => {
    if (reduceMotion || window.matchMedia?.('(hover: hover)').matches) return;
    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame++;
      mx.set(Math.sin(frame / 140) * 0.6);
      my.set(Math.cos(frame / 180) * 0.4);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion, mx, my]);

  function handlePointerMove(e: React.PointerEvent) {
    if (reduceMotion || e.pointerType !== 'mouse') return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    mx.set(((e.clientX - rect.left) / rect.width) * 2 - 1);
    my.set(((e.clientY - rect.top) / rect.height) * 2 - 1);
  }

  function handlePointerLeave() {
    mx.set(0);
    my.set(0);
  }

  const keepers = Math.round(count * 0.13);

  return (
    <div
      ref={stageRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="relative w-full h-[320px] sm:h-[400px] md:h-[420px] lg:h-[480px] select-none"
      style={{ perspective: 1200 }}
      aria-hidden
    >
      {/* soft glow behind the stack */}
      <div className="absolute inset-[12%] rounded-full bg-[#E8B77C]/30 blur-3xl" />

      {/* Scaling lives on a plain wrapper: framer-motion writes its own inline transform on the
          tilting stage, which would silently override Tailwind's scale classes. */}
      <div
        className="absolute left-1/2 top-[46%] scale-[0.55] sm:scale-[0.72] md:scale-[0.6] lg:scale-[0.8] xl:scale-[0.95]"
        style={{ transformStyle: 'preserve-3d' }}
      >
        <motion.div
          style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
          animate={reduceMotion ? undefined : { y: [0, -8, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        >
          {CARDS.map((card, i) => {
            const rejected = sorted && card.verdict !== 'keeper';
            const lifted = sorted && card.verdict === 'keeper';
            return (
              <motion.div
                key={card.id}
                className="absolute"
                style={{ width: card.w, marginLeft: -card.w / 2, marginTop: -card.w * 0.55, transformStyle: 'preserve-3d' }}
                initial={false}
                animate={{
                  x: card.x + (rejected ? (card.x < 0 ? -30 : 30) : 0),
                  y: card.y + (rejected ? 30 : 0),
                  z: card.z + (lifted ? 60 : rejected ? -120 : 0),
                  rotate: card.rotate + (rejected ? (card.x < 0 ? -6 : 6) : 0),
                }}
                transition={{ type: 'spring', stiffness: 70, damping: 16, delay: reduceMotion ? 0 : i * 0.08 }}
              >
                <div className="bg-white p-2.5 pb-9 rounded-[3px] shadow-[0_18px_40px_-12px_rgba(60,35,30,0.45)]">
                  <motion.div
                    className="aspect-[5/4] overflow-hidden rounded-[2px]"
                    initial={false}
                    animate={{
                      opacity: rejected ? 0.5 : 1,
                      filter: rejected ? `grayscale(1) blur(${card.verdict === 'blurry' ? 2.5 : 0.6}px)` : 'grayscale(0) blur(0px)',
                    }}
                    transition={{ duration: 0.6, delay: reduceMotion ? 0 : i * 0.08 }}
                  >
                    {card.scene}
                  </motion.div>
                </div>
                <motion.span
                  className={`absolute left-3 bottom-2 text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full ${
                    card.verdict === 'keeper' ? 'bg-[#BB5133] text-white' : 'bg-[#231F1B]/75 text-white'
                  }`}
                  initial={false}
                  animate={{ opacity: sorted ? 1 : 0, y: sorted ? 0 : 6 }}
                  transition={{ duration: 0.4, delay: reduceMotion ? 0 : 0.3 + i * 0.08 }}
                >
                  {TAG[card.verdict]}
                </motion.span>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* live status pill */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-0 sm:bottom-2 flex items-center gap-2 bg-white/90 backdrop-blur border border-black/5 shadow-sm rounded-full px-4 py-2 text-xs sm:text-sm text-[#231F1B] whitespace-nowrap">
        <span className="relative flex w-2 h-2">
          {!reduceMotion && <span className="absolute inline-flex w-full h-full rounded-full bg-[#BB5133] opacity-60 animate-ping" />}
          <span className="relative inline-flex w-2 h-2 rounded-full bg-[#BB5133]" />
        </span>
        Sorted <span className="font-semibold tabular-nums">{count.toLocaleString()}</span> photos ·{' '}
        <span className="font-semibold tabular-nums text-[#BB5133]">{keepers.toLocaleString()}</span> keepers
      </div>
    </div>
  );
}
