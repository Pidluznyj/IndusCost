/**
 * Rótulos curtos visíveis no menu recolhido (rail) e breadcrumb do header.
 * Sem impacto em RBAC, rotas ou regras de negócio.
 */

import { resolveNestedBreadcrumbSegments } from "@/src/lib/appHeaderBreadcrumbNesting.js";
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
  cadeia_suprimentos: "Cad.",
  comercial: "Com.",
  financeiro: "Fin.",
  operacoes: "Ops.",
  gestao_pessoas: "Pessoas",
  administracao: "Adm.",
  outros: "Outros",
};

export const MODULE_SHORT_LABELS: Record<AppModuleId, string> = {
  dashboard: "Home",
  employees: "RH",
  "employees-dashboard": "Dash. Pessoas",
  "org-chart": "Org.",
  machines: "Máq.",
  materials: "Supr.",
  purchases: "Compr.",
  "sc-purchases": "Comp.SC",
  maintenance: "Manut.",
  inventory: "Estoque",
  "sc-inventory": "Est.SC",
  "sc-receiving": "Receb.",
  "operations-performance": "Perf.",
  "production-orders": "OPs",
  projects: "Proj.",
  fleet: "Frota",
  products: "Prod.",
  "transformation-simulator": "Simul.",
  opex: "Opex",
  taxes: "Trib.",
  pricing: "Preço",
  "commercial-price-table": "Tabela",
  proposals: "Prop.",
  "sales-orders": "Pedidos",
  "sales-order-flow": "Fluxo",
  "output-documents": "Doc. saída",
  customers: "Clientes",
  "crm-commercial": "CRM",
  commissions: "Comiss.",
  simulations: "Simul.",
  reports: "Relat.",
  finance: "Financ.",
  suppliers: "Forn.",
  "portfolio-reconciliation": "Conc.",
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

function finalizeBreadcrumb(
  crumbs: AppHeaderBreadcrumbSegment[]
): AppHeaderBreadcrumbSegment[] {
  if (crumbs.length === 0) return crumbs;
  const last = crumbs[crumbs.length - 1]!;
  crumbs[crumbs.length - 1] = { label: last.label };
  return crumbs;
}

/**
 * Trilha contextual do header global: Grupo › Módulo › [aba/subrota…].
 * - Grupo (menu accordion): sem path — não é clicável.
 * - Módulo e níveis intermediários: com path — voltam ao nível.
 * - Último segmento: página atual (sem link).
 */
export function resolveAppHeaderBreadcrumb(pathname: string): AppHeaderBreadcrumbSegment[] {
  const moduleId = resolveModuleIdFromPath(pathname);
  if (!moduleId) {
    return [{ label: MODULE_LABELS.dashboard }];
  }

  const moduleLabel = MODULE_LABELS[moduleId];
  const groupId = resolveNavigationGroupIdForModule(moduleId);
  const nested = resolveNestedBreadcrumbSegments(pathname);

  if (groupId === "dashboard") {
    return finalizeBreadcrumb(
      nested.length > 0
        ? [{ label: moduleLabel, path: getModulePath(moduleId) }, ...nested]
        : [{ label: moduleLabel }]
    );
  }

  const groupLabel = resolveNavigationGroupLabel(groupId);
  return finalizeBreadcrumb([
    { label: groupLabel },
    { label: moduleLabel, path: getModulePath(moduleId) },
    ...nested,
  ]);
}
