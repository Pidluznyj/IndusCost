import type { AppUserRole } from "@/src/lib/auth/appAuth.shared.js";

export type { AppUserRole };

export const APP_USER_ROLE_VALUES: AppUserRole[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "COMMERCIAL_MANAGER",
  "SELLER",
  "VIEWER",
];

export function parseAppUserRole(raw: unknown): AppUserRole | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toUpperCase();
  return APP_USER_ROLE_VALUES.includes(normalized as AppUserRole)
    ? (normalized as AppUserRole)
    : null;
}
