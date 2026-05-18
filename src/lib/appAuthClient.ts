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
  isActive: boolean;
  externalSellerId: number | null;
  sellerResponsibleName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthMeResponse = {
  authenticated: boolean;
  user: AuthUser | null;
};

export type PermissionCatalogEntry = {
  key: string;
  label: string;
  group: string;
  description: string;
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
    hint: "Perfil administrativo com permissões amplas (padrão do sistema).",
  },
  {
    value: "COMMERCIAL_MANAGER",
    label: "Gestor comercial",
    hint: "Gestão geral e por vendedor de todos os responsáveis.",
  },
  {
    value: "SELLER",
    label: "Vendedor",
    hint: "Gestão por vendedor vinculada; informe externalSellerId do Nomus.",
  },
  {
    value: "VIEWER",
    label: "Visualizador",
    hint: "Acesso mínimo (dashboard).",
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
