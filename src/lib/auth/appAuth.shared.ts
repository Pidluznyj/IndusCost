/**
 * Contrato puro de autenticação / permissões (browser-safe).
 * Sem crypto, util, Prisma, fs ou qualquer API Node.
 */

import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  type PermissionCatalogEntry,
} from "@/src/lib/permissionCatalog.js";
import { normalizePermissionsVersion } from "@/src/lib/permissionsVersion.js";

export type { PermissionCatalogEntry };
export { PERMISSION_CATALOG, ALL_PERMISSION_KEYS };

/** Roles de domínio — espelham o enum Prisma sem importá-lo. */
export type AppUserRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "COMMERCIAL_MANAGER"
  | "SELLER"
  | "VIEWER";

export const APP_SESSION_COOKIE_NAME = "induscost_session";
export const APP_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
export const APP_PASSWORD_MIN_LENGTH = 8;

const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

/** DTO público alinhado a `/api/auth/me` (sem campos de sessão). */
export type SafeAppUser = {
  id: string;
  name: string;
  email: string;
  role: AppUserRole;
  permissions: string[];
  effectivePermissions: string[];
  /** Versão monotônica de ACL — bump em cada save (P21). */
  permissionsVersion: number;
  accessProfileId: string | null;
  accessProfileName: string | null;
  /** Vínculo com Pessoas / RH (`Employee.id`). */
  employeeId: string | null;
  employeeName: string | null;
  employeeDepartment: string | null;
  isActive: boolean;
  externalSellerId: number | null;
  /** Todos os IDs Nomus vinculados ao login (vendedor). */
  externalSellerIds: number[];
  sellerResponsibleName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AppAuthContext = SafeAppUser & {
  sessionId: string;
  /** Epoch da sessão na emissão (P21). */
  sessionPermissionsVersionAtIssue: number;
  /** Chave de identidade consolidada (sessão) — filtra todos os IDs Nomus com mesmo nome. */
  sellerIdentityKey?: string | null;
  /**
   * Fotografia canônica anexada pelo requireResource no request atual.
   * Não é serializada no /me e não substitui o DTO público.
   */
  canonicalAccess?: {
    viewResources: string[];
  };
};

export function canViewCanonicalResource(
  user: Pick<AppAuthContext, "canonicalAccess">,
  resourceKey: string
): boolean | null {
  if (!user.canonicalAccess) return null;
  return user.canonicalAccess.viewResources.includes(resourceKey);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const t = normalizeEmail(email);
  return t.length >= 3 && t.includes("@") && t.includes(".");
}

export function validatePasswordMin(password: string): string | null {
  if (typeof password !== "string" || password.length < APP_PASSWORD_MIN_LENGTH) {
    return `A senha deve ter no mínimo ${APP_PASSWORD_MIN_LENGTH} caracteres.`;
  }
  return null;
}

export function filterKnownPermissions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) return [];
  const out: string[] = [];
  for (const raw of permissions) {
    if (typeof raw !== "string") continue;
    const key = raw.trim();
    if (PERMISSION_KEY_SET.has(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

export function getEffectivePermissions(user: {
  role: AppUserRole;
  permissions: string[];
}): string[] {
  if (user.role === "SUPER_ADMIN") {
    return [...ALL_PERMISSION_KEYS];
  }
  return filterKnownPermissions(user.permissions).sort();
}

export function hasPermission(
  user: {
    role: AppUserRole;
    permissions: string[];
    effectivePermissions?: string[];
  },
  permission: string
): boolean {
  const effective = user.effectivePermissions ?? getEffectivePermissions(user);
  return effective.includes(permission);
}

export function hasAnyPermission(
  user: {
    role: AppUserRole;
    permissions: string[];
    effectivePermissions?: string[];
  },
  permissions: string[]
): boolean {
  return permissions.some((p) => hasPermission(user, p));
}

/** Normaliza versão de ACL (reexport útil para DTO/sessão). */
export { normalizePermissionsVersion };
