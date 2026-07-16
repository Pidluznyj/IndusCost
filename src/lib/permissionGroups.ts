/**
 * Agrupamento visual de permissões alinhado à sidebar (Engenharia, Comercial, etc.).
 * Não altera permission keys, grants nem lógica de autorização — apenas exibição/gestão.
 */

import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  PERMISSION_GROUP_ORDER,
  type PermissionCatalogEntry,
} from "@/src/lib/permissionCatalog.js";
import {
  buildGroupTree,
  clearGroup,
  enablePermission,
  selectAllInGroup,
  selectViewOnlyForGroup,
  type PermissionTreeNode,
} from "@/src/lib/permissionCatalogUtils.js";
import { MODULE_LABELS, type AppModuleId } from "@/src/lib/modulePermissions.js";

export type PermissionAccessGroupId =
  | "dashboard-sistema"
  | "engenharia"
  | "comercial"
  | "financeiro"
  | "operacoes"
  | "administracao"
  | "outros";

export type PermissionAccessGroupDefinition = {
  id: PermissionAccessGroupId;
  label: string;
  order: number;
  description: string;
  relatedMenuLabels: readonly string[];
};

export type PermissionAccessCatalogSection = {
  catalogGroup: string;
  entries: PermissionCatalogEntry[];
  tree: PermissionTreeNode[];
};

export type PermissionAccessGroupSection = PermissionAccessGroupDefinition & {
  catalogSections: PermissionAccessCatalogSection[];
  permissionKeys: readonly string[];
  selectedCount: number;
  totalCount: number;
};

const MODULE_TO_ACCESS_GROUP: Partial<Record<string, PermissionAccessGroupId>> = {
  dashboard: "dashboard-sistema",
  reports: "financeiro",
  guide: "administracao",
  products: "engenharia",
  "transformation-simulator": "engenharia",
  materials: "engenharia",
  simulations: "engenharia",
  projects: "engenharia",
  "crm-commercial": "comercial",
  customers: "comercial",
  proposals: "comercial",
  "sales-orders": "comercial",
  pricing: "comercial",
  commissions: "comercial",
  finance: "financeiro",
  suppliers: "financeiro",
  opex: "financeiro",
  taxes: "financeiro",
  purchases: "operacoes",
  maintenance: "operacoes",
  inventory: "operacoes",
  fleet: "operacoes",
  machines: "operacoes",
  "operations-performance": "operacoes",
  "production-orders": "operacoes",
  employees: "administracao",
  settings: "administracao",
  costs: "outros",
};

const CATALOG_GROUP_TO_ACCESS_GROUP: Record<string, PermissionAccessGroupId> = {
  Geral: "dashboard-sistema",
  CRM: "comercial",
  Clientes: "comercial",
  Propostas: "comercial",
  "Pedidos de Venda": "comercial",
  Comissões: "comercial",
  "Precificação / Impostos": "comercial",
  "Engenharia / Produtos": "engenharia",
  Projetos: "engenharia",
  Financeiro: "financeiro",
  Compras: "operacoes",
  Manutenção: "operacoes",
  "Gestão de Frota": "operacoes",
  Estoque: "operacoes",
  "Custos / Operação": "operacoes",
  "Configurações / Sistema": "administracao",
};

export const PERMISSION_ACCESS_GROUP_DEFINITIONS: readonly PermissionAccessGroupDefinition[] = [
  {
    id: "dashboard-sistema",
    label: "Dashboard / Sistema",
    order: 1,
    description: "Painel principal e permissões gerais de sistema.",
    relatedMenuLabels: [MODULE_LABELS.dashboard],
  },
  {
    id: "engenharia",
    label: "Engenharia",
    order: 2,
    description: "Produtos, suprimentos, simulações e projetos.",
    relatedMenuLabels: [
      MODULE_LABELS.products,
      MODULE_LABELS.materials,
      MODULE_LABELS.simulations,
      MODULE_LABELS.projects,
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    order: 3,
    description: "CRM, clientes, propostas, pedidos, formação de preço e comissões.",
    relatedMenuLabels: [
      MODULE_LABELS["crm-commercial"],
      MODULE_LABELS.customers,
      MODULE_LABELS.proposals,
      MODULE_LABELS["sales-orders"],
      MODULE_LABELS.pricing,
      MODULE_LABELS.commissions,
    ],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    order: 4,
    description: "Financeiro, tributos, custos indiretos, relatórios e subdomínios financeiros.",
    relatedMenuLabels: [
      MODULE_LABELS.finance,
      MODULE_LABELS.suppliers,
      MODULE_LABELS.opex,
      MODULE_LABELS.taxes,
      MODULE_LABELS.reports,
    ],
  },
  {
    id: "operacoes",
    label: "Operações",
    order: 5,
    description: "Estoque, compras, máquinas, performance, ordens de produção, manutenção e frota.",
    relatedMenuLabels: [
      MODULE_LABELS.inventory,
      MODULE_LABELS.purchases,
      MODULE_LABELS.machines,
      MODULE_LABELS["operations-performance"],
      MODULE_LABELS["production-orders"],
      MODULE_LABELS.maintenance,
      MODULE_LABELS.fleet,
    ],
  },
  {
    id: "administracao",
    label: "Administração",
    order: 6,
    description: "Pessoas/RH, usuários, perfis de acesso e configurações.",
    relatedMenuLabels: [
      MODULE_LABELS.employees,
      MODULE_LABELS.settings,
      MODULE_LABELS.guide,
    ],
  },
  {
    id: "outros",
    label: "Sistema / Outros",
    order: 99,
    description: "Permissões legadas ou sem mapeamento explícito.",
    relatedMenuLabels: [],
  },
];

const ACCESS_GROUP_ORDER = PERMISSION_ACCESS_GROUP_DEFINITIONS.map((group) => group.id);

const catalogGroupOrderIndex = new Map<string, number>(
  PERMISSION_GROUP_ORDER.map((group, index) => [group, index])
);

export function resolveAccessGroupForCatalogEntry(
  entry: PermissionCatalogEntry
): PermissionAccessGroupId {
  const byModule = MODULE_TO_ACCESS_GROUP[entry.module];
  if (byModule) return byModule;

  const byCatalogGroup = CATALOG_GROUP_TO_ACCESS_GROUP[entry.group];
  if (byCatalogGroup) return byCatalogGroup;

  if (entry.module === "taxes") return "financeiro";
  if (entry.module === "pricing") return "comercial";

  return "outros";
}

export function resolveAccessGroupForPermissionKey(key: string): PermissionAccessGroupId {
  const entry = PERMISSION_CATALOG.find((item) => item.key === key);
  return entry ? resolveAccessGroupForCatalogEntry(entry) : "outros";
}

export function buildPermissionAccessGroupMap(): Map<
  PermissionAccessGroupId,
  PermissionCatalogEntry[]
> {
  const map = new Map<PermissionAccessGroupId, PermissionCatalogEntry[]>();
  for (const definition of PERMISSION_ACCESS_GROUP_DEFINITIONS) {
    map.set(definition.id, []);
  }
  for (const entry of PERMISSION_CATALOG) {
    const groupId = resolveAccessGroupForCatalogEntry(entry);
    map.get(groupId)?.push(entry);
  }
  return map;
}

function sortCatalogSections(
  sections: PermissionAccessCatalogSection[]
): PermissionAccessCatalogSection[] {
  return sections.sort((a, b) => {
    const ai = catalogGroupOrderIndex.get(a.catalogGroup) ?? 999;
    const bi = catalogGroupOrderIndex.get(b.catalogGroup) ?? 999;
    if (ai !== bi) return ai - bi;
    return a.catalogGroup.localeCompare(b.catalogGroup, "pt-BR");
  });
}

export function buildPermissionAccessGroupSections(
  selected: readonly string[],
  searchQuery = ""
): PermissionAccessGroupSection[] {
  const selectedSet = new Set(selected);
  const byAccessGroup = buildPermissionAccessGroupMap();

  return PERMISSION_ACCESS_GROUP_DEFINITIONS.map((definition) => {
    const entries = byAccessGroup.get(definition.id) ?? [];
    const catalogGroupMap = new Map<string, PermissionCatalogEntry[]>();

    for (const entry of entries) {
      const list = catalogGroupMap.get(entry.group) ?? [];
      list.push(entry);
      catalogGroupMap.set(entry.group, list);
    }

    const catalogSections = sortCatalogSections(
      [...catalogGroupMap.entries()].map(([catalogGroup, catalogEntries]) => ({
        catalogGroup,
        entries: catalogEntries,
        tree: buildGroupTree(catalogGroup, searchQuery),
      }))
    ).filter((section) => section.tree.length > 0 || !searchQuery.trim());

    const permissionKeys = entries.map((entry) => entry.key);

    return {
      ...definition,
      catalogSections,
      permissionKeys,
      selectedCount: permissionKeys.filter((key) => selectedSet.has(key)).length,
      totalCount: permissionKeys.length,
    };
  }).filter((section) => section.totalCount > 0);
}

export function getUnmappedPermissionKeys(): string[] {
  return PERMISSION_CATALOG.filter(
    (entry) => resolveAccessGroupForCatalogEntry(entry) === "outros"
  ).map((entry) => entry.key);
}

export function selectAllInAccessGroup(
  accessGroupId: PermissionAccessGroupId,
  current: string[]
): string[] {
  const section = buildPermissionAccessGroupSections(current).find(
    (group) => group.id === accessGroupId
  );
  if (!section) return current;
  let acc = [...current];
  for (const catalogGroup of new Set(section.catalogSections.map((s) => s.catalogGroup))) {
    acc = selectAllInGroup(catalogGroup, acc);
  }
  return acc;
}

export function clearAccessGroup(
  accessGroupId: PermissionAccessGroupId,
  current: string[]
): string[] {
  const section = buildPermissionAccessGroupSections(current).find(
    (group) => group.id === accessGroupId
  );
  if (!section) return current;
  let acc = [...current];
  for (const catalogGroup of new Set(section.catalogSections.map((s) => s.catalogGroup))) {
    acc = clearGroup(catalogGroup, acc);
  }
  return acc;
}

export function selectViewOnlyForAccessGroup(
  accessGroupId: PermissionAccessGroupId,
  current: string[]
): string[] {
  const section = buildPermissionAccessGroupSections(current).find(
    (group) => group.id === accessGroupId
  );
  if (!section) return current;
  let acc = [...current];
  for (const catalogGroup of new Set(section.catalogSections.map((s) => s.catalogGroup))) {
    acc = selectViewOnlyForGroup(catalogGroup, acc);
  }
  return acc;
}

/** Auditoria: todas as keys do catálogo continuam válidas e mapeadas uma vez. */
export function auditPermissionAccessGroupCoverage(): {
  catalogKeys: readonly string[];
  groupedKeys: string[];
  unmappedKeys: string[];
} {
  const groupedKeys = PERMISSION_ACCESS_GROUP_DEFINITIONS.flatMap((definition) => {
    const entries = buildPermissionAccessGroupMap().get(definition.id) ?? [];
    return entries.map((entry) => entry.key);
  });

  return {
    catalogKeys: ALL_PERMISSION_KEYS,
    groupedKeys,
    unmappedKeys: getUnmappedPermissionKeys(),
  };
}

export function getAccessGroupPanelId(accessGroupId: PermissionAccessGroupId): string {
  return `permission-access-group-panel-${accessGroupId}`;
}

export function getAccessGroupButtonId(accessGroupId: PermissionAccessGroupId): string {
  return `permission-access-group-button-${accessGroupId}`;
}

export function getRelatedSidebarModulesForAccessGroup(
  accessGroupId: PermissionAccessGroupId
): AppModuleId[] {
  switch (accessGroupId) {
    case "dashboard-sistema":
      return ["dashboard"];
    case "engenharia":
      return ["products", "transformation-simulator", "materials", "simulations", "projects"];
    case "comercial":
      return ["crm-commercial", "customers", "proposals", "sales-orders", "pricing", "commissions"];
    case "financeiro":
      return ["finance", "suppliers", "opex", "taxes", "reports"];
    case "operacoes":
      return [
        "inventory",
        "purchases",
        "machines",
        "operations-performance",
        "production-orders",
        "maintenance",
        "fleet",
      ];
    case "administracao":
      return ["employees", "settings", "guide"];
    default:
      return [];
  }
}

export const PERMISSION_ACCESS_GROUP_IDS = ACCESS_GROUP_ORDER;
