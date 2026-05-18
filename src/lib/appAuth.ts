import crypto from "crypto";
import { promisify } from "util";
import type { AppUser, AppUserRole } from "@prisma/client";

const scryptAsync = promisify(crypto.scrypt);

export const APP_SESSION_COOKIE_NAME = "induscost_session";
export const APP_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
export const APP_PASSWORD_MIN_LENGTH = 8;
const SCRYPT_KEYLEN = 64;

export type PermissionCatalogEntry = {
  key: string;
  label: string;
  group: string;
  description: string;
};

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  { key: "dashboard.view", label: "Dashboard", group: "Geral", description: "Visualizar painel principal." },
  { key: "crm.general.view", label: "CRM — Gestão Geral", group: "CRM", description: "Acessar gestão comercial geral." },
  { key: "crm.seller.view", label: "CRM — Gestão por Vendedor", group: "CRM", description: "Acessar gestão por vendedor." },
  { key: "crm.seller.all", label: "CRM — Todos os vendedores", group: "CRM", description: "Ver dados de todos os vendedores." },
  { key: "crm.seller.own", label: "CRM — Próprio vendedor", group: "CRM", description: "Ver apenas dados do vendedor vinculado." },
  { key: "customers.view", label: "Clientes — visualizar", group: "Cadastros", description: "Consultar clientes." },
  { key: "customers.edit", label: "Clientes — editar", group: "Cadastros", description: "Editar cadastro de clientes." },
  { key: "proposals.view", label: "Propostas — visualizar", group: "Comercial", description: "Consultar propostas." },
  { key: "proposals.edit", label: "Propostas — editar", group: "Comercial", description: "Criar e editar propostas." },
  { key: "sales_orders.view", label: "Pedidos — visualizar", group: "Comercial", description: "Consultar pedidos de venda." },
  { key: "products.view", label: "Produtos — visualizar", group: "Cadastros", description: "Consultar produtos." },
  { key: "costs.view", label: "Custos — visualizar", group: "Custeio", description: "Consultar custos e análises." },
  { key: "pricing.view", label: "Precificação — visualizar", group: "Comercial", description: "Consultar precificação." },
  { key: "purchases.view", label: "Compras — visualizar", group: "Compras", description: "Consultar compras." },
  { key: "settings.view", label: "Configurações", group: "Sistema", description: "Acessar configurações do sistema." },
  { key: "users.manage", label: "Usuários — gerenciar", group: "Sistema", description: "Cadastrar e administrar usuários." },
];

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);

const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

export type SafeAppUser = {
  id: string;
  name: string;
  email: string;
  role: AppUserRole;
  permissions: string[];
  effectivePermissions: string[];
  isActive: boolean;
  externalSellerId: number | null;
  sellerResponsibleName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AppAuthContext = SafeAppUser & {
  sessionId: string;
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

export function toSafeAppUser(user: AppUser): SafeAppUser {
  const permissions = filterKnownPermissions(user.permissions);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions,
    effectivePermissions: getEffectivePermissions({ role: user.role, permissions }),
    isActive: user.isActive,
    externalSellerId: user.externalSellerId,
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
