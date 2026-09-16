/**
 * Title-case a name ("aLiCe" -> "Alice", "mary-kate o'brien" -> "Mary-Kate O'Brien").
 * Only the first letter of each part is touched so "McKay" and "DJ" survive.
 */
export function tidyName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

/** Key used for case-insensitive uniqueness checks. */
export function nameKey(name: string): string {
  return tidyName(name).toLowerCase()
}
