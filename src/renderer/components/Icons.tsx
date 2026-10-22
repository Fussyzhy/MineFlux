import type { ReactElement } from 'react'

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function IconDownload(): ReactElement {
  return (
    <svg {...base}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  )
}

export function IconPause(): ReactElement {
  return (
    <svg {...base}>
      <rect x="7" y="5" width="3.5" height="14" rx="1" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
    </svg>
  )
}

export function IconPlay(): ReactElement {
  return (
    <svg {...base}>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  )
}

export function IconStop(): ReactElement {
  return (
    <svg {...base}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

export function IconFolder(): ReactElement {
  return (
    <svg {...base}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

export function IconSearch(): ReactElement {
  return (
    <svg {...base}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  )
}

export function IconRefresh(): ReactElement {
  return (
    <svg {...base}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </svg>
  )
}

export function IconCheck(): ReactElement {
  return (
    <svg {...base}>
      <path d="m4 12 5 5L20 6" />
    </svg>
  )
}

export function IconAlert(): ReactElement {
  return (
    <svg {...base}>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 9v5" />
      <path d="M12 17.5v.01" />
    </svg>
  )
}

export function IconInstance(): ReactElement {
  return (
    <svg {...base}>
      <path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" />
      <path d="M3 7.5 12 12l9-4.5" />
      <path d="M12 12v9" />
    </svg>
  )
}

export function IconTasks(): ReactElement {
  return (
    <svg {...base}>
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </svg>
  )
}

export function IconSettings(): ReactElement {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v2.8M12 18.6v2.8M2.6 12h2.8M18.6 12h2.8M5.4 5.4l2 2M16.6 16.6l2 2M18.6 5.4l-2 2M7.4 16.6l-2 2" />
    </svg>
  )
}

export function IconInfo(): ReactElement {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6v.01" />
    </svg>
  )
}

export function IconTrash(): ReactElement {
  return (
    <svg {...base}>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  )
}

export function IconMinus(): ReactElement {
  return (
    <svg {...base}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function IconSquare(): ReactElement {
  return (
    <svg {...base}>
      <rect x="5.5" y="5.5" width="13" height="13" rx="1.6" />
    </svg>
  )
}

export function IconRestore(): ReactElement {
  return (
    <svg {...base}>
      <rect x="4" y="8" width="12" height="12" rx="1.6" />
      <path d="M8 4h10a2 2 0 0 1 2 2v10" />
    </svg>
  )
}

export function IconClose(): ReactElement {
  return (
    <svg {...base}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function IconArrowLeft(): ReactElement {
  return (
    <svg {...base}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </svg>
  )
}

export function IconChevronRight(): ReactElement {
  return (
    <svg {...base}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export function IconChevronDown(): ReactElement {
  return (
    <svg {...base}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
