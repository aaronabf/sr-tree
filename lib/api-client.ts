/**
 * Browser-side helpers shared by the add form and the person panel.
 */
import type { PersonRef, Pick } from "./types"

/** Turn a type-ahead choice into the `{ id }` / `{ name }` shape the API takes; "nobody" is null. */
export function toRef(pick: Pick): PersonRef | null {
  if (pick.kind === "existing") {
    return { id: pick.id }
  }
  if (pick.kind === "new") {
    return { name: pick.name }
  }
  return null
}

type Failure = { ok: false; error: string }

/** Call a mutation endpoint and get its typed JSON back; network failures become a friendly error. */
export async function request<T extends { ok: true }>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T | Failure> {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return (await res.json()) as T | Failure
  } catch {
    return { ok: false, error: "Network hiccup. Try again." }
  }
}

/** Like `request`, for callers that only care whether it worked. Returns the error message or null. */
export async function mutate(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<string | null> {
  const res = await request<{ ok: true }>(url, method, body)
  return res.ok ? null : res.error
}
