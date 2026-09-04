export default function Logo({ className = 'w-11 h-11' }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 120" className={`${className} shrink-0`} role="img" aria-label="Tidee Moments">
      <g transform="translate(64,66)">
        <rect x="-38" y="-56" width="40" height="17" rx="7" fill="#EA7987" />
        <rect x="-56" y="-45" width="112" height="90" rx="18" fill="#EA7987" />
        <circle cx="38" cy="-28" r="5" fill="#FBD4D8" />
        <circle cx="0" cy="2" r="34" fill="#C9505F" />
        <path
          d="M0 26 C-25 5 -23 -21 -8 -21 C-1 -21 0 -15 0 -12 C0 -15 1 -21 8 -21 C23 -21 25 5 0 26 Z"
          fill="#FFFFFF"
        />
      </g>
    </svg>
  );
}
