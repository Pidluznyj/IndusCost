/**
 * Rótulos curtos visíveis no menu recolhido (rail) e breadcrumb do header.
 * Sem impacto em RBAC, rotas ou regras de negócio.
 */

import {
  NAVIGATION_GROUP_DEFINITIONS,
  resolveNavigationGroupIdForModule,
  type NavigationGroupId,
} from "@/src/lib/navigationGroups.js";
import {
  MODULE_LABELS,
  resolveModuleIdFromPath,
  type AppModuleId,
} from "@/src/lib/modulePermissions.js";
import { getModulePath } from "@/src/lib/navigationGroups.js";

export const NAVIGATION_GROUP_SHORT_LABELS: Record<NavigationGroupId, string> = {
  dashboard: "Home",
  engenharia: "Eng.",
  comercial: "Com.",
  financeiro: "Fin.",
  operacoes: "Ops.",
  administracao: "Adm.",
  outros: "Outros",
};

export const MODULE_SHORT_LABELS: Record<AppModuleId, string> = {
  dashboard: "Home",
  employees: "RH",
  machines: "Máq.",
  materials: "Supr.",
  purchases: "Compr.",
  maintenance: "Manut.",
  inventory: "Estoque",
  "operations-performance": "Perf.",
  projects: "Proj.",
  fleet: "Frota",
  products: "Prod.",
  "transformation-simulator": "Simul.",
  opex: "Opex",
  taxes: "Trib.",
  pricing: "Preço",
  proposals: "Prop.",
  "sales-orders": "Pedidos",
  customers: "Clientes",
  "crm-commercial": "CRM",
  commissions: "Comiss.",
  simulations: "Simul.",
  reports: "Relat.",
  finance: "Financ.",
  suppliers: "Forn.",
  guide: "Guia",
  settings: "Config.",
};

export type AppHeaderBreadcrumbSegment = {
  label: string;
  path?: string;
};

export function resolveModuleShortLabel(moduleId: AppModuleId): string {
  return MODULE_SHORT_LABELS[moduleId] ?? MODULE_LABELS[moduleId];
}

export function resolveNavigationGroupShortLabel(groupId: NavigationGroupId): string {
  return NAVIGATION_GROUP_SHORT_LABELS[groupId];
}

export function resolveNavigationGroupLabel(groupId: NavigationGroupId): string {
  const definition = NAVIGATION_GROUP_DEFINITIONS.find((group) => group.id === groupId);
  if (definition) return definition.label;
  if (groupId === "outros") return "Outros";
  return groupId;
}

/** Trilha contextual para o header global (grupo › módulo). */
export function resolveAppHeaderBreadcrumb(pathname: string): AppHeaderBreadcrumbSegment[] {
  const moduleId = resolveModuleIdFromPath(pathname);
  if (!moduleId) {
    return [{ label: MODULE_LABELS.dashboard }];
  }

  const moduleLabel = MODULE_LABELS[moduleId];
  const groupId = resolveNavigationGroupIdForModule(moduleId);

  if (groupId === "dashboard") {
    return [{ label: moduleLabel }];
  }

  const groupLabel = resolveNavigationGroupLabel(groupId);
  return [
    { label: groupLabel },
    { label: moduleLabel, path: getModulePath(moduleId) },
  ];
}
