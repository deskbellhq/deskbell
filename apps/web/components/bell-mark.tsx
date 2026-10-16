/**
 * The Deskbell mark: a service bell inside a speech bubble. Copied between the
 * docs site, the dashboard and the marketing site rather than shared, because
 * they are separate deployments with no common package. Keep the shapes
 * identical if any copy changes; `.github/assets/logo.svg` is the reference.
 *
 * The bubble takes `currentColor`, so the host picks the green; the bell is
 * always the cream of the mark.
 */
export function BellMark({ className = "", size = 22 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="4.5" y="2.5" width="55" height="52.5" rx="8.5" fill="currentColor" />
      <path
        d="M45 49v6.2L58 61.5 57 49z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <g fill="#FFFDF8">
        <rect x="28.6" y="15.8" width="6.8" height="2.7" rx="1.35" />
        <rect x="30.8" y="17.8" width="2.4" height="3.4" />
        <path d="M19.3 31.6C19.3 24.4 24.6 20.6 32 20.6s12.7 3.8 12.7 11z" />
        <rect x="18.1" y="31.4" width="27.8" height="2.1" rx="1.05" />
        <path
          d="M18.6 35.2h26.8l2.6 4.8H16z"
          stroke="#FFFDF8"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
