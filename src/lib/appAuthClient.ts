/** Tipos e utilitários do cliente para auth real (Fase 1K-C). */

export type AppUserRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "COMMERCIAL_MANAGER"
  | "SELLER"
  | "VIEWER";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: AppUserRole;
  permissions: string[];
  effectivePermissions: string[];
  accessProfileId: string | null;
  accessProfileName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  employeeDepartment: string | null;
  isActive: boolean;
  externalSellerId: number | null;
  externalSellerIds: number[];
  sellerResponsibleName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes";

export type { EffectiveAccessMeDto };

export type AuthMeResponse = {
  authenticated: boolean;
  user: AuthUser | null;
  /**
   * Bloco shadow P04 — presente só com EFFECTIVE_ACCESS_DTO_IN_ME=1.
   * Não substitui `user.permissions` / `effectivePermissions` (ainda autoridade).
   */
  effectiveAccess?: EffectiveAccessMeDto;
};

export type PermissionCatalogEntry = {
  key: string;
  label: string;
  group: string;
  description: string;
  module?: string;
  type?: "menu" | "section" | "tab" | "action";
  parentKey?: string;
  risk?: "normal" | "sensitive" | "critical";
  requires?: string[];
  recommendedFor?: string[];
};

export const APP_USER_ROLE_OPTIONS: { value: AppUserRole; label: string; hint: string }[] = [
  {
    value: "SUPER_ADMIN",
    label: "Super administrador",
    hint: "Acesso total; todas as permissões são concedidas automaticamente.",
  },
  {
    value: "ADMIN",
    label: "Administrador",
    hint: "Classificação administrativa; libere telas marcando permissões abaixo.",
  },
  {
    value: "COMMERCIAL_MANAGER",
    label: "Gestor comercial",
    hint: "Classificação comercial; libere telas marcando permissões abaixo.",
  },
  {
    value: "SELLER",
    label: "Vendedor",
    hint: "Classificação de vendedor; informe externalSellerId do Nomus e marque permissões.",
  },
  {
    value: "VIEWER",
    label: "Visualizador",
    hint: "Classificação de leitura; libere telas marcando permissões abaixo.",
  },
];

export const APP_PASSWORD_MIN_LENGTH = 8;

export const ROLE_LABELS: Record<AppUserRole, string> = {
  SUPER_ADMIN: "Super administrador",
  ADMIN: "Administrador",
  COMMERCIAL_MANAGER: "Gestor comercial",
  SELLER: "Vendedor",
  VIEWER: "Visualizador",
};

export function formatRoleLabel(role: AppUserRole): string {
  return ROLE_LABELS[role] ?? role;
}

export function summarizePermissions(permissions: string[], max = 4): string {
  if (permissions.length === 0) return "—";
  if (permissions.length <= max) return permissions.join(", ");
  return `${permissions.slice(0, max).join(", ")} +${permissions.length - max}`;
}
