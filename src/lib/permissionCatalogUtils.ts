import {
  PERMISSION_CATALOG,
  PERMISSION_GROUP_ORDER,
  type PermissionCatalogEntry,
  type PermissionRisk,
} from "@/src/lib/permissionCatalog";
import { canAccessModule, type AppModuleId } from "@/src/lib/modulePermissions";

export type PermissionTemplateId =
  | "seller"
  | "commercial_manager"
  | "purchases"
  | "engineering"
  | "system_admin"
  | "read_only"
  | "fleet_admin"
  | "fleet_operator"
  | "fleet_financial"
  | "fleet_maintenance"
  | "fleet_requester"
  | "fleet_viewer";

export const PERMISSION_TEMPLATES: Record<
  PermissionTemplateId,
  { label: string; description: string; suggestedRole?: string; permissions: string[] }
> = {
  seller: {
    label: "Vendedor",
    description: "CRM, clientes, propostas e pedidos do vendedor.",
    suggestedRole: "SELLER",
    permissions: [
      "dashboard.view",
      "crm.view",
      "crm.seller.view",
      "crm.seller.own",
      "crm.customer_cockpit.view",
      "crm.activities.create",
      "crm.activities.edit",
      "customers.view",
      "customers.commercial360.view",
      "proposals.view",
      "proposals.create",
      "proposals.edit",
      "proposals.print",
      "sales_orders.view",
      "sales_orders.detail.view",
      "sales_orders.invoice.view",
      "output_documents.view",
    ],
  },
  commercial_manager: {
    label: "Gestor Comercial",
    description: "Visão comercial ampla, CRM geral e indicadores.",
    suggestedRole: "COMMERCIAL_MANAGER",
    permissions: [
      "dashboard.view",
      "crm.view",
      "crm.general.view",
      "crm.seller.view",
      "crm.seller.all",
      "crm.customer_cockpit.view",
      "crm.activities.create",
      "crm.activities.edit",
      "crm.profile.edit",
      "crm.customers.assign_seller",
      "customers.view",
      "customers.create",
      "customers.edit",
      "customers.commercial360.view",
      "proposals.view",
      "proposals.create",
      "proposals.edit",
      "proposals.print",
      "proposals.indicators.view",
      "proposals.material_report.view",
      "reports.material_demand.view",
      "sales_orders.view",
      "sales_orders.detail.view",
      "sales_orders.invoice.view",
      "output_documents.view",
      "reports.view",
    ],
  },
  purchases: {
    label: "Compras",
    description: "Compras, materiais e consulta de produtos.",
    permissions: [
      "dashboard.view",
      "purchases.view",
      "purchases.create",
      "purchases.edit",
      "purchases.indicators.view",
      "materials.view",
      "products.view",
    ],
  },
  engineering: {
    label: "Engenharia / Custos",
    description: "Engenharia de produto, materiais, máquinas e simulações.",
    permissions: [
      "dashboard.view",
      "products.view",
      "products.create",
      "products.edit",
      "products.export.engineering",
      "products.tab.info",
      "products.tab.bom",
      "products.tab.routing",
      "products.tab.tree",
      "products.tab.cost",
      "products.tab.composition",
      "materials.view",
      "materials.edit",
      "machines.view",
      "machines.edit",
      "employees.view",
      "opex.view",
      "simulations.view",
      "simulations.create",
      "projects.view",
      "projects.manage",
    ],
  },
  system_admin: {
    label: "Administração do Sistema",
    description: "Configurações, usuários e parâmetros sensíveis.",
    suggestedRole: "ADMIN",
    permissions: [
      "dashboard.view",
      "settings.view",
      "users.manage",
      "settings.branding.view",
      "settings.branding.edit",
      "settings.global_params.view",
      "settings.global_params.edit",
      "settings.nomus.view",
      "settings.price_tables.view",
      "settings.price_tables.manage",
      "settings.operational.view",
      "settings.operational.manage",
      "finance.view",
      "finance.accountsReceivable.view",
      "finance.portfolioReconciliation.view",
      "finance.portfolioReconciliation.conciliation.view",
      "finance.portfolioReconciliation.intelligence.view",
      "finance.portfolioReconciliation.orderToCashAudit.view",
      "crm.customers.assign_seller",
    ],
  },
  read_only: {
    label: "Somente Leitura",
    description: "Consulta sem ações de escrita ou exclusão.",
    suggestedRole: "VIEWER",
    permissions: [
      "dashboard.view",
      "crm.view",
      "crm.general.view",
      "crm.seller.view",
      "customers.view",
      "customers.commercial360.view",
      "proposals.view",
      "sales_orders.view",
      "sales_orders.detail.view",
      "output_documents.view",
      "products.view",
      "purchases.view",
      "pricing.view",
      "reports.view",
      "finance.view",
      "finance.accountsReceivable.view",
      "finance.portfolioReconciliation.view",
      "finance.portfolioReconciliation.conciliation.view",
      "finance.portfolioReconciliation.intelligence.view",
      "finance.portfolioReconciliation.orderToCashAudit.view",
      "guide.view",
    ],
  },
  fleet_admin: {
    label: "Frota — Administrador",
    description: "Operação ampla da frota, incluindo configurações e financeiro.",
    permissions: [
      "fleet.view",
      "fleet.manage",
      "fleet.settings.manage",
      "fleet.financial.view",
    ],
  },
  fleet_operator: {
    label: "Frota — Operador",
    description: "Reservas, retirada/devolução e consulta operacional.",
    permissions: [
      "fleet.view",
      "fleet.reservations.create",
      "fleet.usage.checkout",
      "fleet.usage.checkin",
    ],
  },
  fleet_financial: {
    label: "Frota — Financeiro",
    description: "Visualização geral e valores financeiros da frota.",
    permissions: ["fleet.view", "fleet.financial.view"],
  },
  fleet_maintenance: {
    label: "Frota — Manutenção",
    description: "Consulta do módulo e gestão de manutenções.",
    permissions: ["fleet.view", "fleet.maintenance.manage"],
  },
  fleet_requester: {
    label: "Frota — Solicitante",
    description: "Solicitar reservas sem aprovar ou administrar frota.",
    permissions: ["fleet.view", "fleet.reservations.create"],
  },
  fleet_viewer: {
    label: "Frota — Visualizador",
    description: "Somente leitura operacional (sem valores financeiros).",
    permissions: ["fleet.view"],
  },
};

const catalogByKey = new Map(PERMISSION_CATALOG.map((e) => [e.key, e]));

export function getCatalogEntry(key: string): PermissionCatalogEntry | undefined {
  return catalogByKey.get(key);
}

export function getDirectChildren(parentKey: string): PermissionCatalogEntry[] {
  return PERMISSION_CATALOG.filter((e) => e.parentKey === parentKey);
}

export function getAllDescendantKeys(parentKey: string): string[] {
  const out: string[] = [];
  const walk = (pk: string) => {
    for (const child of getDirectChildren(pk)) {
      out.push(child.key);
      walk(child.key);
    }
  };
  walk(parentKey);
  return out;
}

export function resolveRequiredChain(key: string): string[] {
  const entry = catalogByKey.get(key);
  if (!entry) return [];
  const chain = new Set<string>();
  const add = (k: string) => {
    if (chain.has(k)) return;
    chain.add(k);
    const e = catalogByKey.get(k);
    if (e?.requires) e.requires.forEach(add);
    if (e?.parentKey) add(e.parentKey);
  };
  add(key);
  chain.delete(key);
  return Array.from(chain);
}

export function enablePermission(selected: string[], key: string): string[] {
  const next = new Set(selected);
  const toAdd = [key, ...resolveRequiredChain(key)];
  for (const k of toAdd) next.add(k);
  return Array.from(next).filter((k) => catalogByKey.has(k)).sort();
}

export function disablePermission(selected: string[], key: string): string[] {
  const remove = new Set([key, ...getAllDescendantKeys(key)]);
  return selected.filter((k) => !remove.has(k)).sort();
}

export function togglePermissionSelected(selected: string[], key: string, enabled: boolean): string[] {
  return enabled ? enablePermission(selected, key) : disablePermission(selected, key);
}

export function applyTemplatePermissions(templateId: PermissionTemplateId): string[] {
  const tpl = PERMISSION_TEMPLATES[templateId];
  let acc: string[] = [];
  for (const key of tpl.permissions) {
    acc = enablePermission(acc, key);
  }
  return acc;
}

/** Marca apenas permissões de visualização (menu, section, tab) do grupo. */
export function selectViewOnlyForGroup(group: string, current: string[]): string[] {
  const viewKeys = PERMISSION_CATALOG.filter(
    (e) => e.group === group && (e.type === "menu" || e.type === "section" || e.type === "tab")
  ).map((e) => e.key);
  let acc = [...current];
  for (const key of viewKeys) {
    acc = enablePermission(acc, key);
  }
  return acc;
}

export function selectAllInGroup(group: string, current: string[]): string[] {
  const keys = PERMISSION_CATALOG.filter((e) => e.group === group).map((e) => e.key);
  let acc = [...current];
  for (const key of keys) {
    acc = enablePermission(acc, key);
  }
  return acc;
}

export function clearGroup(group: string, current: string[]): string[] {
  const keys = new Set(PERMISSION_CATALOG.filter((e) => e.group === group).map((e) => e.key));
  return current.filter((k) => !keys.has(k));
}

export type PermissionTreeNode = PermissionCatalogEntry & { children: PermissionTreeNode[] };

export function buildGroupTree(group: string, searchQuery: string): PermissionTreeNode[] {
  const q = searchQuery.trim().toLowerCase();
  const inGroup = PERMISSION_CATALOG.filter((e) => e.group === group);
  const matchedKeys = new Set<string>();

  if (q) {
    for (const e of inGroup) {
      const hay = `${e.key} ${e.label} ${e.description}`.toLowerCase();
      if (hay.includes(q)) {
        matchedKeys.add(e.key);
        let pk = e.parentKey;
        while (pk) {
          matchedKeys.add(pk);
          pk = catalogByKey.get(pk)?.parentKey;
        }
      }
    }
  }

  const entries = q ? inGroup.filter((e) => matchedKeys.has(e.key)) : inGroup;
  const byKey = new Map(entries.map((e) => [e.key, { ...e, children: [] as PermissionTreeNode[] }]));

  const roots: PermissionTreeNode[] = [];
  for (const node of byKey.values()) {
    if (node.parentKey && byKey.has(node.parentKey)) {
      byKey.get(node.parentKey)!.children.push(node);
    } else if (!node.parentKey || !byKey.has(node.parentKey)) {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: PermissionTreeNode[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

export function groupCatalogEntries(): { group: string; entries: PermissionCatalogEntry[] }[] {
  const map = new Map<string, PermissionCatalogEntry[]>();
  for (const e of PERMISSION_CATALOG) {
    const list = map.get(e.group) ?? [];
    list.push(e);
    map.set(e.group, list);
  }
  const ordered: { group: string; entries: PermissionCatalogEntry[] }[] = [];
  for (const g of PERMISSION_GROUP_ORDER) {
    if (map.has(g)) ordered.push({ group: g, entries: map.get(g)! });
  }
  const knownGroups = new Set<string>(PERMISSION_GROUP_ORDER);
  for (const [g, entries] of map) {
    if (!knownGroups.has(g)) {
      ordered.push({ group: g, entries });
    }
  }
  return ordered;
}

export function summarizePermissionSelection(
  selected: string[],
  check: { hasPermission: (p: string) => boolean; hasAnyPermission: (ps: string[]) => boolean }
): {
  total: number;
  groups: string[];
  critical: PermissionCatalogEntry[];
  modules: AppModuleId[];
} {
  const groups = new Set<string>();
  const critical: PermissionCatalogEntry[] = [];
  for (const key of selected) {
    const e = catalogByKey.get(key);
    if (!e) continue;
    groups.add(e.group);
    if (e.risk === "critical" || e.risk === "sensitive") critical.push(e);
  }

  const modules: AppModuleId[] = [];
  const moduleIds: AppModuleId[] = [
    "dashboard",
    "employees",
    "machines",
    "materials",
    "purchases",
    "maintenance",
    "fleet",
    "products",
    "opex",
    "taxes",
    "pricing",
    "proposals",
    "sales-orders",
    "customers",
    "crm-commercial",
    "simulations",
    "reports",
    "guide",
    "settings",
  ];
  const checker = {
    hasPermission: (p: string) => selected.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => selected.includes(p)),
  };
  for (const id of moduleIds) {
    if (canAccessModule(id, checker)) modules.push(id);
  }

  return {
    total: selected.length,
    groups: Array.from(groups).sort((a, b) => a.localeCompare(b, "pt-BR")),
    critical: critical.sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    modules,
  };
}

export function riskBadgeLabel(risk?: PermissionRisk): string | null {
  if (risk === "critical") return "Crítica";
  if (risk === "sensitive") return "Sensível";
  return null;
}
