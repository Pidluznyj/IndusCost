/**
 * Capacidades do visualizador na ficha de Pessoas 360° (cadastro mestre). Só decidem o que a
 * UI mostra; cada rota aplica a guarda oficial no servidor (RBAC do módulo de origem).
 */
import { buildSystemLinksViewerCaps, type SystemLinksViewerCaps } from "@/src/lib/employeeSystemLinks.js";

export type PeopleMasterCaps = SystemLinksViewerCaps & {
  /** Criar/editar dados canônicos (admin.employees.people:update). */
  canEditPerson: boolean;
  /** Inativar/reativar identidade (admin.employees.people:manage). */
  canManagePersonStatus: boolean;
  /** Habilitar acesso = criar conta (admin.settings.security:manage, mesma guarda de Usuários). */
  canCreateUsers: boolean;
  /** Habilitar motorista (operations.fleet:manage + fleet.manage|fleet.drivers.manage). */
  canManageDrivers: boolean;
  /** Regularizar conta existente: links:manage E user_link:manage (mesma régua das rotas). */
  canAttachAccount: boolean;
  /** Unificar/reverter exige SUPER_ADMIN (com step-up no servidor). */
  canMerge: boolean;
};

export function buildPeopleMasterCaps(input: { role?: string | null; permissions?: string[] | null }): PeopleMasterCaps {
  const base = buildSystemLinksViewerCaps(input);
  const role = input.role ?? "";
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  const perms = new Set(input.permissions ?? []);
  const has = (p: string) => isAdmin || perms.has(p);
  return {
    ...base,
    canEditPerson: has("employees.edit"),
    canManagePersonStatus: has("employees.edit") || has("users.manage"),
    canCreateUsers: has("users.manage"),
    canManageDrivers: has("fleet.manage") || has("fleet.drivers.manage"),
    canAttachAccount: base.canManagePersonLink && (has("employees.user_link.manage") || has("employees.edit") || has("users.manage")),
    canMerge: role === "SUPER_ADMIN",
  };
}
