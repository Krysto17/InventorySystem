export function normalizeUsername(raw: string): string {
  const u = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!u) throw new Error("Username cannot be empty");
  if (!/^[a-z0-9_]+$/.test(u)) throw new Error("Username must be alphanumeric/underscore");
  return u;
}

export function usernameToEmail(username: string, domain: string): string {
  return `${normalizeUsername(username)}@${domain}`;
}
