/**
 * Autenticação server-only: crypto/scrypt, sessão e mapeamento Prisma → DTO.
 * Não importar a partir do bundle frontend.
 */

import crypto from "crypto";
import { promisify } from "util";
import type { AppUser } from "@prisma/client";
import {
  filterKnownPermissions,
  getEffectivePermissions,
  normalizePermissionsVersion,
  type AppAuthContext,
  type AppUserRole,
  type SafeAppUser,
} from "./appAuth.shared.js";

export * from "./appAuth.shared.js";

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt:v1:${salt.toString("base64")}:${derived.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "scrypt" || parts[1] !== "v1") {
    return false;
  }
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
  /**
   * PERM-31 — sessão /me: SUPER_ADMIN não recebe catálogo expandido
   * (use `effectiveAccess.isSuperAdmin` / role no FE).
   */
  sessionCompact?: boolean;
};

export function toSafeAppUser(
  user: AppUser,
  options: SafeAppUserOptions = {}
): SafeAppUser {
  const permissions = filterKnownPermissions(user.permissions);
  const employeeName = options.employee
    ? options.employee.socialName?.trim() || options.employee.name.trim() || null
    : null;
  const role = user.role as AppUserRole;
  const effectivePermissions =
    options.sessionCompact && role === "SUPER_ADMIN"
      ? []
      : getEffectivePermissions({ role, permissions });
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
    permissions: options.sessionCompact && role === "SUPER_ADMIN" ? [] : permissions,
    effectivePermissions,
    permissionsVersion: normalizePermissionsVersion(
      (user as AppUser & { permissionsVersion?: number }).permissionsVersion
    ),
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
    mustChangePassword:
      (user as AppUser & { mustChangePassword?: boolean }).mustChangePassword === true,
    passwordChangedAt:
      (user as AppUser & { passwordChangedAt?: Date | null }).passwordChangedAt?.toISOString() ??
      null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toAppAuthContext(
  user: AppUser,
  session: { id: string; permissionsVersionAtIssue?: number | null }
): AppAuthContext {
  return {
    ...toSafeAppUser(user),
    sessionId: session.id,
    sessionPermissionsVersionAtIssue: normalizePermissionsVersion(
      session.permissionsVersionAtIssue
    ),
  };
}

declare global {
  namespace Express {
    interface Request {
      appAuth?: AppAuthContext;
    }
  }
}
