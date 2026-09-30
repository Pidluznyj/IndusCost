const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Audit userId: UUID real ou null. Nunca persiste string inventada. */
export function exposureAuditUserId(userId: string | null | undefined): string | null {
  const value = String(userId ?? "").trim();
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}
