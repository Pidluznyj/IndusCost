/**
 * P12 — Abas / seções / superfícies internas ↔ contrato + DTO efetivo.
 *
 * - resourceKey FE ou contrato → view no DTO
 * - heranças explícitas documentadas (drawers sem rota própria)
 * - sem ROLE_MATRIX / mega-key paralelo
 */

import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import type { FinanceSectionId } from "@/src/lib/financeNavigation.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";
import {
  PERMISSION_CONTRACT_RESOURCES,
} from "@/src/lib/security/permissionContract/index.js";
import { projectLegacyBagToBaseline } from "@/src/lib/security/effectiveAccess/legacyCompat.js";

/** Seções do FinanceModule → chave de contrato (view). */
export const FINANCE_SECTION_CONTRACT_KEYS: Record<FinanceSectionId, string> = {
  "one-page": "finance.one_page",
  "cash-flow": "finance.cash_flow",
  "accounts-receivable": "finance.accounts_receivable",
  "accounts-payable": "finance.accounts_payable",
  billing: "finance.billing",
  "sales-orders": "finance.sales_orders",
  "cost-centers": "finance.cost_centers",
  "executive-report": "finance.executive_report",
  dre: "finance.dre",
};

/** Seções do FinanceModule → resourceKey FE (catálogo). */
export const FINANCE_SECTION_FE_RESOURCE_KEYS: Record<FinanceSectionId, string> = {
  "one-page": ResourceKeys.FINANCE_ONE_PAGE,
  "cash-flow": "finance.cash_flow",
  "accounts-receivable": ResourceKeys.FINANCEIRO_CONTAS_RECEBER,
  "accounts-payable": ResourceKeys.FINANCEIRO_CONTAS_PAGAR,
  billing: "finance.billing",
  "sales-orders": "finance.sales_orders",
  "cost-centers": "finance.cost_centers",
  "executive-report": "finance.executive_report",
  dre: "finance.dre",
};

export const FINANCE_UI_SECTIONS: ReadonlyArray<{
  id: FinanceSectionId;
  label: string;
  path: string;
  resourceKey: string;
  contractKey: string;
}> = [
  {
    id: "one-page",
    label: "One Page",
    path: "/finance/one-page",
    resourceKey: FINANCE_SECTION_FE_RESOURCE_KEYS["one-page"],
    contractKey: FINANCE_SECTION_CONTRACT_KEYS["one-page"],
  },
  {
    id: "cash-flow",
    label: "Fluxo de Caixa",
    path: "/finance/cash-flow",
    resourceKey: FINANCE_SECTION_FE_RESOURCE_KEYS["cash-flow"],
    contractKey: FINANCE_SECTION_CONTRACT_KEYS["cash-flow"],
  },
  {
    id: "accounts-receivable",
    label: "Contas a Receber",
    path: "/finance/accounts-receivable",
    resourceKey: FINANCE_SECTION_FE_RESOURCE_KEYS["accounts-receivable"],
    contractKey: FINANCE_SECTION_CONTRACT_KEYS["accounts-receivable"],
  },
  {
    id: "accounts-payable",
    label: "Contas a Pagar",
    path: "/finance/accounts-payable",
    resourceKey: FINANCE_SECTION_FE_RESOURCE_KEYS["accounts-payable"],
    contractKey: FINANCE_SECTION_CONTRACT_KEYS["accounts-payable"],
  },
  {
    id: "billing",
    label: "Faturamento",
    path: "/finance/billing",
    resourceKey: FINANCE_SECTION_FE_RESOURCE_KEYS.billing,
    contractKey: FINANCE_SECTION_CONTRACT_KEYS.billing,
  },
  {
    id: "sales-orders",
    label: "Pedidos de Venda",
    path: "/finance/sales-orders",
    resourceKey: FINANCE_SECTION_FE_RESOURCE_KEYS["sales-orders"],
    contractKey: FINANCE_SECTION_CONTRACT_KEYS["sales-orders"],
  },
  {
    id: "cost-centers",
    label: "Centros de Custo",
    path: "/finance/cost-centers",
    resourceKey: FINANCE_SECTION_FE_RESOURCE_KEYS["cost-centers"],
    contractKey: FINANCE_SECTION_CONTRACT_KEYS["cost-centers"],
  },
  {
    id: "executive-report",
    label: "Relatório Presidencial",
    path: "/finance/executive-report",
    resourceKey: FINANCE_SECTION_FE_RESOURCE_KEYS["executive-report"],
    contractKey: FINANCE_SECTION_CONTRACT_KEYS["executive-report"],
  },
  {
    id: "dre",
    label: "DRE Gerencial",
    path: "/finance/dre",
    resourceKey: FINANCE_SECTION_FE_RESOURCE_KEYS.dre,
    contractKey: FINANCE_SECTION_CONTRACT_KEYS.dre,
  },
];

/**
 * Heranças explícitas (P12): superfície filha sem resourceKey próprio.
 * Conteúdo sensível herda o resourceKey do pai; não basta CSS.
 */
export const INTERNAL_SURFACE_INHERITANCE = [
  {
    surface: "OrderFullAuditDialog (Auditoria 360º)",
    inheritsFrom: "finance.portfolio_reconciliation.order_to_cash_audit",
    notes: "Abas internas do diálogo herdam a aba Auditoria Pedido→Caixa; sem grant → dialog não abre.",
  },
  {
    surface: "OrderStatus* drawers / Portfolio order drawers",
    inheritsFrom: "finance.portfolio_reconciliation.order_status",
    notes: "Drawers do Status Pedidos herdam a aba status_pedidos.",
  },
  {
    surface: "CustomerIntelligencePage tabs",
    inheritsFrom: "commercial.crm.customer_360",
    notes: "Abas CI herdam Cliente 360; page-level gate obrigatório.",
  },
  {
    surface: "Project detail tabs (home/items/costs/…)",
    inheritsFrom: "engineering.projects",
    notes: "Sem TAB keys finas; view do módulo projetos.",
  },
  {
    surface: "Employee ficha tabs",
    inheritsFrom: "admin.employees (+ facetas HR)",
    notes: "Capabilities HR (PII) além de view do módulo; não é CSS-only.",
  },
  {
    surface: "Fleet overview / operational tabs",
    inheritsFrom: "operations.fleet",
    notes: "Abas financeiras da frota exigem canFinancial (legado documentado).",
  },
  {
    surface: "Settings hub sections",
    inheritsFrom: "admin.settings (+ users/profiles)",
    notes: "canAccessSettingsSection; segurança sensível exige grants extras.",
  },
  {
    surface: "Inventory overview/balances/reservations/audit",
    inheritsFrom: "operations.inventory",
    notes: "Tabs finas items/warehouses/movements/counts têm resourceKey próprio.",
  },
] as const;

function buildFeToContractIndex(): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    map.set(r.resourceKey, r.resourceKey);
    for (const rel of r.relationalResourceKeys ?? []) {
      if (!map.has(rel)) map.set(rel, r.resourceKey);
    }
  }
  // Seções financeiras FE PT → contrato
  for (const [id, contractKey] of Object.entries(FINANCE_SECTION_CONTRACT_KEYS)) {
    const fe = FINANCE_SECTION_FE_RESOURCE_KEYS[id as FinanceSectionId];
    map.set(fe, contractKey);
  }
  return map;
}

const FE_TO_CONTRACT = buildFeToContractIndex();

/** Resolve chave de contrato a partir de FE ou contrato. */
export function resolveContractKeyForInternalSurface(
  resourceKey: string
): string | null {
  const key = resourceKey.trim();
  if (!key) return null;
  return FE_TO_CONTRACT.get(key) ?? null;
}

/**
 * Chaves de contrato usadas por abas/seções internas (além do mapa sidebar).
 * Incluídas na projeção bag→DTO para P12.
 */
export function listInternalSurfaceContractKeys(): string[] {
  const keys = new Set<string>();
  for (const k of Object.values(FINANCE_SECTION_CONTRACT_KEYS)) keys.add(k);
  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    if (r.isTab || r.isDetailScreen) keys.add(r.resourceKey);
  }
  return [...keys].sort();
}

/**
 * Projeta bag → views de contrato para superfícies internas (tabs/seções).
 * Mesma política primary + unique-owner da sidebar, no universo interno.
 */
export function projectInternalContractKeysFromLegacyBag(
  legacyPermissions: readonly string[]
): string[] {
  const bag = new Set(
    legacyPermissions.map((k) => k.trim()).filter((k) => k.length > 0)
  );
  const granted = new Set<string>();
  const internalKeys = new Set(listInternalSurfaceContractKeys());
  const byKey = new Map(
    PERMISSION_CONTRACT_RESOURCES.map((r) => [r.resourceKey, r])
  );

  const { grants } = projectLegacyBagToBaseline({
    legacyPermissions: [...bag],
  });
  for (const [resourceKey, actions] of Object.entries(grants)) {
    if (actions?.view && internalKeys.has(resourceKey)) granted.add(resourceKey);
  }

  const legacyOwners = new Map<string, Set<string>>();
  for (const contractKey of internalKeys) {
    const resource = byKey.get(contractKey);
    if (!resource) continue;
    const view = resource.actions.find((a) => a.action === "view");
    const primary = view?.legacyPermissionKeys[0];
    if (primary && bag.has(primary)) {
      granted.add(contractKey);
    }
    for (const legacy of view?.legacyPermissionKeys ?? []) {
      const set = legacyOwners.get(legacy) ?? new Set<string>();
      set.add(contractKey);
      legacyOwners.set(legacy, set);
    }
  }
  for (const legacy of bag) {
    const owners = legacyOwners.get(legacy);
    if (owners?.size === 1) {
      const only = [...owners][0]!;
      if (internalKeys.has(only)) granted.add(only);
    }
  }

  return [...granted].sort();
}

/** View efetivo no DTO para resourceKey FE ou contrato. */
export function canViewInternalSurfaceFromDto(
  dto: EffectiveAccessMeDto | null | undefined,
  resourceKey: string
): boolean {
  if (!dto) return false;
  if (dto.isSuperAdmin) return true;
  const contractKey = resolveContractKeyForInternalSurface(resourceKey);
  if (!contractKey) {
    // Sem mapeamento → negar (obrigar resourceKey ou herança documentada)
    return false;
  }
  if (dto.capabilities[contractKey]?.canView) return true;
  if (dto.actionsByResource[contractKey]?.includes("view")) return true;
  if (dto.navigationReveal.includes(contractKey)) return true;
  if (dto.allowedResources.includes(contractKey)) return true;
  return false;
}
