import crypto from "crypto";
import { promisify } from "util";
import type { AppUser, AppUserRole } from "@prisma/client";
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  type PermissionCatalogEntry,
} from "@/src/lib/permissionCatalog";

const scryptAsync = promisify(crypto.scrypt);

export const APP_SESSION_COOKIE_NAME = "induscost_session";
export const APP_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
export const APP_PASSWORD_MIN_LENGTH = 8;
const SCRYPT_KEYLEN = 64;

export type { PermissionCatalogEntry };
export { PERMISSION_CATALOG, ALL_PERMISSION_KEYS };

const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

export type SafeAppUser = {
  id: string;
  name: string;
  email: string;
  role: AppUserRole;
  permissions: string[];
  effectivePermissions: string[];
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
  /** Chave de identidade consolidada (sessão) — filtra todos os IDs Nomus com mesmo nome. */
  sellerIdentityKey?: string | null;
};

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
  user: { role: AppUserRole; permissions: string[]; effectivePermissions?: string[] },
  permission: string
): boolean {
  const effective = user.effectivePermissions ?? getEffectivePermissions(user);
  return effective.includes(permission);
}

export function hasAnyPermission(
  user: { role: AppUserRole; permissions: string[]; effectivePermissions?: string[] },
  permissions: string[]
): boolean {
  return permissions.some((p) => hasPermission(user, p));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt:v1:${salt.toString("base64")}:${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "scrypt" || parts[1] !== "v1") return false;
  try {
    const salt = Buffer.from(parts[2], "base64");
    const expected = Buffer.from(parts[3], "base64");
    const derived = (await scryptAsync(password, salt, expected.length)) as Buffer;
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function createOpaqueSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export type SafeAppUserOptions = {
  accessProfileName?: string | null;
  employee?: {
    id: string;
    name: string;
    socialName?: string | null;
    department?: string | null;
  } | null;
};

export function toSafeAppUser(user: AppUser, options: SafeAppUserOptions = {}): SafeAppUser {
  const permissions = filterKnownPermissions(user.permissions);
  const employeeName = options.employee
    ? (options.employee.socialName?.trim() || options.employee.name.trim() || null)
    : null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions,
    effectivePermissions: getEffectivePermissions({ role: user.role, permissions }),
    accessProfileId: user.accessProfileId ?? null,
    accessProfileName: options.accessProfileName ?? null,
    employeeId: user.employeeId ?? null,
    employeeName,
    employeeDepartment: options.employee?.department?.trim() || null,
    isActive: user.isActive,
    externalSellerId: user.externalSellerId,
    externalSellerIds: Array.isArray(user.externalSellerIds)
      ? user.externalSellerIds.filter((id) => Number.isFinite(id) && id > 0)
      : user.externalSellerId != null
        ? [user.externalSellerId]
        : [],
    sellerResponsibleName: user.sellerResponsibleName,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toAppAuthContext(user: AppUser, sessionId: string): AppAuthContext {
  return { ...toSafeAppUser(user), sessionId };
}

declare global {
  namespace Express {
    interface Request {
      appAuth?: AppAuthContext;
    }
  }
}
