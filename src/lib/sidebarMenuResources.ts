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
  "sales-order-flow": ResourceKeys.COMERCIAL_FLUXO_PEDIDOS,
  "output-documents": ResourceKeys.COMERCIAL_DOCUMENTOS_SAIDA,
  commissions: ResourceKeys.COMISSOES,
  materials: ResourceKeys.SUPRIMENTOS,
  settings: ResourceKeys.CONFIGURACOES,
  customers: ResourceKeys.COMERCIAL_CLIENTES,
  proposals: ResourceKeys.COMERCIAL_PROPOSTAS,
  "commercial-price-table": ResourceKeys.COMERCIAL_TABELA_COMERCIAL,
  pricing: ResourceKeys.COMERCIAL_FORMACAO_PRECO,
  products: ResourceKeys.ENGENHARIA_PRODUTOS,
  "transformation-simulator": ResourceKeys.ENGENHARIA_SIMULADOR_INJECAO,
  simulations: ResourceKeys.ENGENHARIA_SIMULACOES,
  projects: ResourceKeys.ENGENHARIA_PROJETOS,
  inventory: ResourceKeys.OPERACOES_ESTOQUE,
  purchases: ResourceKeys.OPERACOES_COMPRAS,
  machines: ResourceKeys.OPERACOES_MAQUINAS,
  "operations-performance": ResourceKeys.OPERACOES_PERFORMANCE,
  "production-orders": ResourceKeys.OPERACOES_ORDENS_PRODUCAO,
  maintenance: ResourceKeys.OPERACOES_MANUTENCAO,
  fleet: ResourceKeys.OPERACOES_FROTA,
  employees: ResourceKeys.ADMIN_PESSOAS,
  "employees-dashboard": ResourceKeys.ADMIN_PESSOAS_DASHBOARD,
  "org-chart": ResourceKeys.ADMIN_PESSOAS,
  guide: ResourceKeys.ADMIN_GUIA,
  opex: ResourceKeys.FINANCE_OPEX,
  taxes: ResourceKeys.FINANCE_TAXES,
  reports: ResourceKeys.FINANCE_REPORTS,
  suppliers: ResourceKeys.FINANCE_SUPPLIERS,
};

/** Grupos accordion com resourceKey (visibilidade = filhos filtrados; chave documenta o pai). */
export const SIDEBAR_GROUP_RESOURCE_KEYS: Partial<Record<NavigationGroupId, string>> = {
  dashboard: ResourceKeys.DASHBOARD,
  financeiro: ResourceKeys.FINANCEIRO,
  comercial: ResourceKeys.COMERCIAL,
  gestao_pessoas: ResourceKeys.ADMIN_PESSOAS,
  administracao: ResourceKeys.ADMIN,
  engenharia: ResourceKeys.ENGENHARIA,
  operacoes: ResourceKeys.OPERACOES,
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
