/** Link público do checklist por QR fixo do veículo. */

import { normalizePublicReservationBaseUrl } from "@/src/lib/fleetPublicReservationLink.js";

export const FLEET_VEHICLE_CHECKLIST_PATH = "/public/fleet/vehicle-checklist";

export function buildVehicleChecklistPublicPath(publicToken: string): string {
  const token = publicToken.trim();
  return `${FLEET_VEHICLE_CHECKLIST_PATH}/${encodeURIComponent(token)}`;
}

export function buildVehicleChecklistPublicUrl(
  publicToken: string,
  baseUrl?: string | null
): string {
  const path = buildVehicleChecklistPublicPath(publicToken);
  if (!baseUrl?.trim()) return path;
  const base = normalizePublicReservationBaseUrl(baseUrl);
  return `${base}${path}`;
}

export function resolveVehicleChecklistBaseUrl(
  configuredBaseUrl: string | null | undefined,
  requestOrigin?: string | null
): string | null {
  const configured = configuredBaseUrl?.trim();
  if (configured) return normalizePublicReservationBaseUrl(configured);
  if (requestOrigin?.trim()) return normalizePublicReservationBaseUrl(requestOrigin);
  return null;
}
