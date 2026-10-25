/** Per-sheet color themes: tab accent + chart palette + heatmap color. */

export const THEME_IDS = ["snow", "ocean", "green", "purple", "orange", "rose", "teal", "gray"] as const
export type ThemeId = (typeof THEME_IDS)[number]

export interface Theme {
  /** Accent used on the tab and as the first series color. */
  main: string
  palette: string[]
  /** "r, g, b" for heatmap cell backgrounds. */
  heat: string
}

export const THEMES: Record<ThemeId, Theme> = {
  snow: {
    main: "#29b5e8",
    palette: ["#29b5e8", "#11567f", "#ff9f36", "#7d44cf", "#2ca58d", "#d45b90", "#8a8a8a", "#e8c547", "#5b8def", "#71d3dc"],
    heat: "41, 181, 232",
  },
  ocean: {
    main: "#2563eb",
    palette: ["#2563eb", "#1e3a8a", "#60a5fa", "#0ea5e9", "#93c5fd", "#1d4ed8", "#38bdf8", "#3730a3", "#7dd3fc", "#64748b"],
    heat: "37, 99, 235",
  },
  green: {
    main: "#16a34a",
    palette: ["#16a34a", "#14532d", "#84cc16", "#22c55e", "#4d7c0f", "#86efac", "#65a30d", "#166534", "#bef264", "#6b7280"],
    heat: "22, 163, 74",
  },
  purple: {
    main: "#7c3aed",
    palette: ["#7c3aed", "#4c1d95", "#a78bfa", "#c026d3", "#6d28d9", "#e879f9", "#8b5cf6", "#86198f", "#c4b5fd", "#6b7280"],
    heat: "124, 58, 237",
  },
  orange: {
    main: "#ea580c",
    palette: ["#ea580c", "#9a3412", "#f59e0b", "#fb923c", "#b45309", "#fcd34d", "#f97316", "#78350f", "#fdba74", "#6b7280"],
    heat: "234, 88, 12",
  },
  rose: {
    main: "#e11d48",
    palette: ["#e11d48", "#881337", "#f472b6", "#fb7185", "#be123c", "#f9a8d4", "#db2777", "#9f1239", "#fda4af", "#6b7280"],
    heat: "225, 29, 72",
  },
  teal: {
    main: "#0d9488",
    palette: ["#0d9488", "#134e4a", "#2dd4bf", "#06b6d4", "#0f766e", "#99f6e4", "#14b8a6", "#155e75", "#67e8f9", "#6b7280"],
    heat: "13, 148, 136",
  },
  gray: {
    main: "#52525b",
    palette: ["#3f3f46", "#71717a", "#a1a1aa", "#18181b", "#52525b", "#d4d4d8", "#27272a", "#8a8a8a", "#e4e4e7", "#29b5e8"],
    heat: "82, 82, 91",
  },
}

export function theme(id: string | undefined): Theme {
  return THEMES[(THEME_IDS as readonly string[]).includes(id ?? "") ? (id as ThemeId) : "snow"]
}

/** Theme for the n-th new sheet (1-based), so sheets get distinct colors automatically. */
export const themeForIndex = (n: number): ThemeId => THEME_IDS[(n - 1) % THEME_IDS.length]
