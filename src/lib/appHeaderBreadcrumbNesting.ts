/**
 * Níveis extras do breadcrumb do header (aba / subrota sob o módulo da sidebar).
 * Grupo › Módulo continuam em sidebarLabels; aqui só o restante da trilha.
 */

import {
  COMMISSIONS_BASE_PATH,
  COMMISSIONS_SECTIONS,
  parseCommissionsSectionFromPath,
} from "@/src/lib/commissionsNavigation.js";
import {
  FINANCE_BASE_PATH,
  FINANCE_SECTIONS,
  parseFinanceSectionFromPath,
} from "@/src/lib/financeNavigation.js";
import {
  MATERIALS_BASE_PATH,
  MATERIALS_SECTION_PATHS,
  MATERIALS_SECTIONS,
  parseMaterialsSectionFromPath,
} from "@/src/lib/materialsNavigation.js";
import {
  getProjectTabPath,
  PROJECT_TABS,
  parseProjectTabFromPath,
} from "@/src/lib/projectsNavigation.js";

const INVENTORY_BASE_PATH = "/inventory";
const INVENTORY_TAB_LABELS: Record<string, string> = {
  items: "Itens",
  warehouses: "Almoxarifados",
  balances: "Saldos",
  movements: "Movimentações",
  counts: "Conferência Física",
  reservations: "Reservas",
  audit: "Auditoria",
};

export type NestedBreadcrumbSegment = {
  label: string;
  /** Path clicável para voltar a este nível (omitido no leaf atual). */
  path?: string;
};

const SALES_ORDERS_STATIC_LEAVES: Record<string, string> = {
  result: "Resultado",
  "monthly-receivables": "Recebíveis mensais",
  "commercial-discounts": "Descontos comerciais",
  management: "Gestão de Pedidos",
  "sold-products": "Produtos Vendidos",
  "material-demand": "Inteligência de Matéria-Prima",
  "material-usage": "Inteligência de Matéria-Prima",
};

const PRODUCT_STATIC_LEAVES: Record<string, string> = {
  indicators: "Indicadores",
  "material-demand": "Inteligência de Matéria-Prima",
  "where-used": "Onde é usado",
};

const SIMPLE_INDICATORS_MODULES = new Set([
  "purchases",
  "pricing",
  "proposals",
  "customers",
  "simulations",
]);

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function segmentsOf(pathname: string): string[] {
  return normalizePath(pathname).split("/").filter(Boolean);
}

function resolveSalesOrdersNesting(parts: string[]): NestedBreadcrumbSegment[] {
  // /sales-orders
  if (parts.length < 2) return [];
  const leaf = parts[1]!;
  const staticLabel = SALES_ORDERS_STATIC_LEAVES[leaf];
  if (staticLabel) {
    if (leaf === "sold-products" && parts[2] && parts[3] === "customers") {
      return [
        { label: "Produtos Vendidos", path: "/sales-orders/sold-products" },
        { label: "Clientes compradores" },
      ];
    }
    return [{ label: staticLabel }];
  }
  // /sales-orders/:id (qualquer segmento não mapeado)
  return [{ label: "Pedido" }];
}

function resolveFinanceNesting(pathname: string): NestedBreadcrumbSegment[] {
  const section = parseFinanceSectionFromPath(pathname);
  if (!section) return [];
  const def = FINANCE_SECTIONS.find((s) => s.id === section);
  if (!def) return [];
  // cost-centers/:id — mantém rótulo da seção (detalhe sem nome estável na URL)
  return [{ label: def.label }];
}

function resolveCommissionsNesting(pathname: string): NestedBreadcrumbSegment[] {
  const normalized = normalizePath(pathname);
  if (normalized === COMMISSIONS_BASE_PATH) return [];
  const section = parseCommissionsSectionFromPath(pathname);
  if (!section || section === "monthlyClosing") return [];
  const def = COMMISSIONS_SECTIONS.find((s) => s.id === section);
  return def ? [{ label: def.label }] : [];
}

function resolveInventoryNesting(pathname: string): NestedBreadcrumbSegment[] {
  const normalized = normalizePath(pathname);
  if (normalized === INVENTORY_BASE_PATH) return [];
  for (const [segment, label] of Object.entries(INVENTORY_TAB_LABELS)) {
    if (normalized.includes(`/inventory/${segment}`)) {
      return [{ label }];
    }
  }
  return [];
}

function resolveMaterialsNesting(pathname: string): NestedBreadcrumbSegment[] {
  const normalized = normalizePath(pathname);
  if (normalized === MATERIALS_BASE_PATH) return [];
  const section = parseMaterialsSectionFromPath(pathname);
  if (!section || section === "catalog") return [];
  const def = MATERIALS_SECTIONS.find((s) => s.id === section);
  if (!def) return [];
  if (normalized.startsWith(`${MATERIALS_SECTION_PATHS.marketIntelligence}/reports`)) {
    return [
      {
        label: def.label,
        path: MATERIALS_SECTION_PATHS.marketIntelligence,
      },
      { label: "Relatórios" },
    ];
  }
  if (
    normalized.startsWith(`${MATERIALS_SECTION_PATHS.marketIntelligence}/`) &&
    normalized !== MATERIALS_SECTION_PATHS.marketIntelligence
  ) {
    return [
      {
        label: def.label,
        path: MATERIALS_SECTION_PATHS.marketIntelligence,
      },
      { label: "Detalhe" },
    ];
  }
  return [{ label: def.label }];
}

function resolveProjectsNesting(parts: string[]): NestedBreadcrumbSegment[] {
  // /projects
  if (parts.length < 2) return [];
  const projectId = parts[1]!;
  if (parts[2] === "report") {
    return [
      { label: "Projeto", path: `/projects/${projectId}` },
      { label: "Relatório executivo" },
    ];
  }
  if (parts[2] === "client-report") {
    return [
      { label: "Projeto", path: `/projects/${projectId}` },
      { label: "Relatório do cliente" },
    ];
  }
  const tab = parseProjectTabFromPath(`/${parts.join("/")}`);
  const tabDef = PROJECT_TABS.find((t) => t.id === tab);
  const projectCrumb: NestedBreadcrumbSegment = {
    label: "Projeto",
    path: getProjectTabPath(projectId, "home"),
  };
  if (!tabDef || tab === "home") {
    return [{ label: "Projeto" }];
  }
  return [projectCrumb, { label: tabDef.label }];
}

function resolveProductsNesting(parts: string[]): NestedBreadcrumbSegment[] {
  if (parts.length < 2) return [];
  const label = PRODUCT_STATIC_LEAVES[parts[1]!];
  return label ? [{ label }] : [];
}

function resolveReportsNesting(parts: string[]): NestedBreadcrumbSegment[] {
  if (parts[1] === "cost-to-cash-trace") {
    return [{ label: "Rastreabilidade" }];
  }
  return [];
}

function resolveCustomersNesting(parts: string[]): NestedBreadcrumbSegment[] {
  if (parts[0] === "customers" && parts[1] === "indicators") {
    return [{ label: "Indicadores" }];
  }
  if (
    (parts[0] === "customers" || (parts[0] === "crm" && parts[1] === "customers")) &&
    parts.includes("intelligence")
  ) {
    return [{ label: "Inteligência do Cliente" }];
  }
  return [];
}

function resolveFleetNesting(parts: string[]): NestedBreadcrumbSegment[] {
  if (parts[1] === "field") return [{ label: "Uso em campo" }];
  return [];
}

/**
 * Segmentos aninhados após Grupo › Módulo.
 * O último item é a página atual (sem path); intermediários podem ter path.
 */
export function resolveNestedBreadcrumbSegments(
  pathname: string
): NestedBreadcrumbSegment[] {
  const normalized = normalizePath(pathname);
  const parts = segmentsOf(normalized);
  if (parts.length === 0) return [];

  const root = parts[0]!;

  if (root === "sales-orders") return resolveSalesOrdersNesting(parts);
  if (root === "finance") {
    // Fornecedores / Conciliação são módulos próprios da sidebar — sem nest extra.
    if (parts[1] === "suppliers" || parts[1] === "portfolio-reconciliation") {
      return [];
    }
    if (normalized === FINANCE_BASE_PATH) return [];
    return resolveFinanceNesting(normalized);
  }
  if (root === "commissions") return resolveCommissionsNesting(normalized);
  if (root === "inventory") return resolveInventoryNesting(normalized);
  if (root === "materials") return resolveMaterialsNesting(normalized);
  if (root === "projects") return resolveProjectsNesting(parts);
  if (root === "products") return resolveProductsNesting(parts);
  if (root === "reports") return resolveReportsNesting(parts);
  if (root === "customers" || root === "crm") return resolveCustomersNesting(parts);
  if (root === "fleet") return resolveFleetNesting(parts);

  if (SIMPLE_INDICATORS_MODULES.has(root) && parts[1] === "indicators") {
    return [{ label: "Indicadores" }];
  }

  return [];
}
