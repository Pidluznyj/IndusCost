/**
 * Mapa central sidebar → resourceKey (catálogo relacional).
 * Fonte única para não espalhar strings de menu.
 */

import type { AppModuleId } from "@/src/lib/modulePermissions.js";
import type { NavigationGroupId } from "@/src/lib/navigationGroups.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";

/** Módulos com resourceKey explícito (demais usam canAccessModule legado). */
export const SIDEBAR_MODULE_RESOURCE_KEYS: Partial<Record<AppModuleId, string>> = {
  dashboard: ResourceKeys.DASHBOARD,
  finance: ResourceKeys.FINANCEIRO,
  "portfolio-reconciliation": ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA,
  "crm-commercial": ResourceKeys.COMERCIAL_CRM,
  "sales-orders": ResourceKeys.COMERCIAL_PEDIDOS_VENDA,
  commissions: ResourceKeys.COMISSOES,
  materials: ResourceKeys.SUPRIMENTOS,
  settings: ResourceKeys.CONFIGURACOES,
};

/** Grupos accordion com resourceKey (visibilidade = filhos filtrados; chave documenta o pai). */
export const SIDEBAR_GROUP_RESOURCE_KEYS: Partial<Record<NavigationGroupId, string>> = {
  dashboard: ResourceKeys.DASHBOARD,
  financeiro: ResourceKeys.FINANCEIRO,
  comercial: ResourceKeys.COMERCIAL,
  administracao: ResourceKeys.ADMIN,
};

export function resolveSidebarModuleResourceKey(
  moduleId: AppModuleId
): string | null {
  return SIDEBAR_MODULE_RESOURCE_KEYS[moduleId] ?? null;
}

export function resolveSidebarGroupResourceKey(
  groupId: NavigationGroupId
): string | null {
  return SIDEBAR_GROUP_RESOURCE_KEYS[groupId] ?? null;
}
