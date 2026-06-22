// Flatten a Supabase embedded relation that may arrive as a single object or as
// a one-element array (PostgREST returns an array for some to-one embeds).
// Returns the single row, or null. Replaces the per-file `g1`/`get1` copies.
export function one<T>(v: unknown): T | null {
  return Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);
}
