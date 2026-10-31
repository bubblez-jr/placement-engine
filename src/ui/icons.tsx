import type { SVGProps } from 'react'

// A small hand-drawn icon set (24px grid, 1.8 stroke) so the app needs no icon library.

type IconName =
  | 'home'
  | 'plus'
  | 'building'
  | 'sliders'
  | 'shield'
  | 'check'
  | 'x'
  | 'alert'
  | 'arrow-left'
  | 'arrow-right'
  | 'download'
  | 'copy'
  | 'map-pin'
  | 'users'
  | 'clock'
  | 'file'
  | 'scale'
  | 'lock'

const PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9v11.5h13V9',
  plus: 'M12 5v14M5 12h14',
  building: 'M4 21V5.5L12 3l8 2.5V21M4 21h16M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  shield: 'M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6zM8.5 12l2.5 2.5 4.5-5',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2v.1',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 19.5h14',
  copy: 'M9 9h10.5v10.5H9zM5 15V4.5h10.5',
  'map-pin': 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  users: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.6 5.2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  file: 'M6 3h8.5L19 7.5V21H6zM14 3v5h5M9 12.5h7M9 16h7',
  scale: 'M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0zM19 7l-2.5 6a3 3 0 0 0 5 0z',
  lock: 'M6.5 10.5h11V20h-11zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
}

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** Product mark: a home with a tick, on a rounded square. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7.5" fill="var(--accent)" />
      <path d="M7 15.5 16 8l9 7.5V25H7z" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="m12 18.5 3 3 5.5-6" fill="none" stroke="var(--rail-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
