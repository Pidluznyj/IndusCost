/**
 * CSP da superfície pública da Satisfação.
 *
 * Inclui apenas origens oficiais do Cloudflare Turnstile. Sem wildcard, sem
 * unsafe-eval. Em desenvolvimento (Vite HMR) o guard NÃO aplica esta CSP —
 * o eval do HMR quebraria a página.
 */

export const SATISFACTION_TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export function buildSatisfactionPublicCsp(): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${SATISFACTION_TURNSTILE_ORIGIN}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self' ${SATISFACTION_TURNSTILE_ORIGIN}`,
    "font-src 'self' data:",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `frame-src ${SATISFACTION_TURNSTILE_ORIGIN}`,
  ].join("; ");
}
