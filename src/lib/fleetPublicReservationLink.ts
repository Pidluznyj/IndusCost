/** Link compartilhável da reserva pública por QR (base URL + path). */

export const FLEET_PUBLIC_RESERVATION_PATH = "/public/fleet/reservation";
export const FLEET_PUBLIC_RESERVATION_INITIAL_STEP = "cpf" as const;

export function normalizePublicReservationBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isLocalhostOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Resolve a base URL para link/QR compartilhável.
 * Prioridade: FleetSettings.publicReservationBaseUrl → origin da requisição (se não for localhost).
 */
export function resolvePublicReservationBaseUrl(
  settings: Record<string, string>,
  requestOrigin?: string | null
): string | null {
  const configured = settings.publicReservationBaseUrl?.trim();
  if (configured) return normalizePublicReservationBaseUrl(configured);

  const origin = requestOrigin?.trim();
  if (origin && !isLocalhostOrigin(origin)) {
    return normalizePublicReservationBaseUrl(origin);
  }

  return null;
}

export function buildPublicReservationUrl(token: string, baseUrl?: string | null): string {
  const path = `${FLEET_PUBLIC_RESERVATION_PATH}/${token}`;
  if (!baseUrl?.trim()) return path;
  const base = normalizePublicReservationBaseUrl(baseUrl);
  return `${base}${path}`;
}

export function resolveClientPublicReservationBaseUrl(
  apiBaseUrl: string | null | undefined,
  windowOrigin: string
): string | null {
  if (apiBaseUrl?.trim()) return normalizePublicReservationBaseUrl(apiBaseUrl);
  if (!isLocalhostOrigin(windowOrigin)) return normalizePublicReservationBaseUrl(windowOrigin);
  return null;
}
