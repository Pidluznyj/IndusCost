/**
 * Validação de destino HTTP — proteção SSRF para URL configurável.
 */

export type UrlAllowlistResult =
  | { ok: true; url: URL }
  | { ok: false; code: string; message: string };

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

function isPrivateOrLocalIp(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;

  // IPv4 literal
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const parts = m.slice(1).map(Number);
    if (parts.some((p) => p > 255)) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // IPv6 literals comuns
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) {
    return true;
  }
  return false;
}

function hostMatchesAllowlist(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  for (const entry of allowedHosts) {
    const rule = entry.trim().toLowerCase();
    if (!rule) continue;
    if (rule.startsWith(".")) {
      if (host.endsWith(rule) || host === rule.slice(1)) return true;
      continue;
    }
    if (host === rule || host.endsWith(`.${rule}`)) return true;
  }
  return false;
}

export function validateMaterialStockSpreadsheetWebhookUrl(
  rawUrl: string | null | undefined,
  allowedHosts: string[]
): UrlAllowlistResult {
  if (!rawUrl?.trim()) {
    return {
      ok: false,
      code: "DESTINATION_MISSING",
      message: "URL do webhook não configurada.",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      ok: false,
      code: "DESTINATION_INVALID",
      message: "URL do webhook inválida.",
    };
  }
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      code: "DESTINATION_INVALID",
      message: "Somente HTTPS é permitido para o webhook.",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      code: "DESTINATION_INVALID",
      message: "URL do webhook não pode conter credenciais embutidas.",
    };
  }
  if (isPrivateOrLocalIp(parsed.hostname)) {
    return {
      ok: false,
      code: "DESTINATION_INVALID",
      message: "Destino bloqueado (rede privada/local).",
    };
  }
  if (!hostMatchesAllowlist(parsed.hostname, allowedHosts)) {
    return {
      ok: false,
      code: "DESTINATION_NOT_ALLOWED",
      message: "Host do webhook fora da allowlist.",
    };
  }
  return { ok: true, url: parsed };
}
