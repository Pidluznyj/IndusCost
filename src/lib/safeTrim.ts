/** Normaliza texto de filtros/query params — nunca chama `.trim()` em undefined/null. */
export function safeTrim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Retorna string segura para inputs controlados (nunca undefined). */
export function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
