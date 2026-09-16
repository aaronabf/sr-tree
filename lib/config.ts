/** First edition of Sustain-Release. */
export const FIRST_YEAR = 2014

/** Calendar years with no festival (2020 was cancelled). They don't count toward "Year N". */
export const SKIPPED_YEARS: ReadonlySet<number> = new Set([2020])

/**
 * Whether next year's edition can be entered yet. Off by default so people
 * don't pre-register for a festival that hasn't been announced; set
 * NEXT_PUBLIC_ALLOW_NEXT_YEAR=true once it has.
 */
export function allowNextYear(): boolean {
  return process.env.NEXT_PUBLIC_ALLOW_NEXT_YEAR === "true"
}

/** The latest year that can be picked in the forms. */
export function lastSelectableYear(now = new Date()): number {
  return now.getFullYear() + (allowNextYear() ? 1 : 0)
}

/** Whether the festival happened (or can be entered) in a calendar year. */
export function isFestivalYear(year: number, now = new Date()): boolean {
  return (
    Number.isInteger(year) &&
    year >= FIRST_YEAR &&
    year <= lastSelectableYear(now) &&
    !SKIPPED_YEARS.has(year)
  )
}

/** Selectable years, newest first: first edition through the last selectable year, minus cancelled years. */
export function festivalYears(now = new Date()): number[] {
  const years: number[] = []
  for (let y = lastSelectableYear(now); y >= FIRST_YEAR; y--) {
    if (!SKIPPED_YEARS.has(y)) {
      years.push(y)
    }
  }
  return years
}

/** The festival year before `year`, skipping cancelled years; null for the first edition. */
export function previousFestivalYear(year: number): number | null {
  for (let y = year - 1; y >= FIRST_YEAR; y--) {
    if (!SKIPPED_YEARS.has(y)) {
      return y
    }
  }
  return null
}

/** Same list, oldest first. Handy for row layout. */
export function festivalYearsAsc(now = new Date()): number[] {
  return festivalYears(now).reverse()
}

/** Edition number: 2014 -> 1, 2019 -> 6, 2021 -> 7 (2020 skipped), 2024 -> 10. */
export function editionNumber(year: number): number {
  let n = 0
  for (let y = FIRST_YEAR; y <= year; y++) {
    if (!SKIPPED_YEARS.has(y)) {
      n++
    }
  }
  return n
}

/** "Year 10 (2024)" */
export function yearLabel(year: number): string {
  return `Year ${editionNumber(year)} (${year})`
}

/** "Y10 (2024)" for tight spots like legend chips. */
export function yearShort(year: number): string {
  return `Y${editionNumber(year)} (${year})`
}

/** Default year suggested in the form: this year, or the latest festival year before it. */
export function defaultYear(now = new Date()): number {
  const y = now.getFullYear()
  return isFestivalYear(y, now) ? y : (festivalYears(now).find((fy) => fy < y) ?? FIRST_YEAR)
}

/** Neon-ish palette used for edges/legend; one hue per edition, cycles. */
export const YEAR_COLORS = [
  "#39ff14", // acid green
  "#ff00c8", // hot magenta
  "#00f0ff", // cyan
  "#ffe600", // yellow
  "#ff6a00", // orange
  "#b26bff", // violet
  "#ff2e63", // red-pink
  "#5cff9d", // mint
  "#4d8cff", // blue
  "#ffb3f6", // pink
  "#c8ff00", // lime
  "#ff9f1c", // amber
  "#7dffef", // aqua
]

export function yearColor(year: number): string {
  const i = Math.max(0, editionNumber(year) - 1)
  return YEAR_COLORS[i % YEAR_COLORS.length]
}
