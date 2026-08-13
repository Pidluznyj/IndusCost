import { fetchJsonOk, HttpError } from "@/src/lib/http";
import {
  ADMIN_ELEVATION_REQUIRED_CODE,
  ADMIN_ELEVATION_TTL_MS,
  type AdminElevationStatus,
} from "@/src/lib/auth/adminElevation.shared";

export function isAdminElevationRequired(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.status === 403 &&
    error.code === ADMIN_ELEVATION_REQUIRED_CODE
  );
}

export async function fetchAdminElevationStatus(): Promise<AdminElevationStatus> {
  return fetchJsonOk<AdminElevationStatus>("/api/auth/admin-elevation/status", {
    suppressAuthEvent: true,
  });
}

export async function confirmAdminElevation(password: string): Promise<AdminElevationStatus> {
  return fetchJsonOk<AdminElevationStatus>("/api/auth/admin-elevation/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    suppressAuthEvent: true,
  });
}

export function adminElevationConfirmedMessage(ttlMs: number = ADMIN_ELEVATION_TTL_MS): string {
  const minutes = Math.round(ttlMs / 60_000);
  return `Acesso administrativo confirmado por ${minutes} minutos.`;
}
