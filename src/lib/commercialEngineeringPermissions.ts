/**
 * Permissões Comercial + Engenharia (Prompt 13) — padrão Comissões:
 * resourceKey (view/nav) + legado (mutações / ações justificadas).
 * Sem inventar CRUD onde o domínio não permite (pedidos Nomus, NF, etc.).
 */

import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import {
  getVisibleProductTabs,
  type ProductTabId,
} from "@/src/lib/modulePermissions.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";

export type ResourceAwareChecker = PermissionChecker & {
  canViewResource?: (resourceKey: string) => boolean;
};

function legacyOrResource(
  check: ResourceAwareChecker,
  resourceKey: string | null | undefined,
  legacy: () => boolean
): boolean {
  if (resourceKey && typeof check.canViewResource === "function") {
    if (check.canViewResource(resourceKey)) return true;
  }
  return legacy();
}

// ─── Comercial: Clientes ─────────────────────────────────────

export function canViewCustomers(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.COMERCIAL_CLIENTES, () =>
    check.hasPermission("customers.view")
  );
}

export function canCreateCustomers(check: PermissionChecker): boolean {
  return check.hasPermission("customers.create");
}

/** Edição e exclusão no legado usam customers.edit (sem customers.delete). */
export function canEditCustomers(check: PermissionChecker): boolean {
  return check.hasPermission("customers.edit");
}

export function canImportCustomers(check: PermissionChecker): boolean {
  return check.hasPermission("customers.edit") || check.hasPermission("customers.create");
}

// ─── Comercial: Propostas (helpers já em modulePermissions; espelho resource) ─

export function canViewProposals(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.COMERCIAL_PROPOSTAS, () =>
    check.hasPermission("proposals.view")
  );
}

// ─── Comercial: Pedidos Nomus ─────────────────────────────────

export function canViewSalesOrders(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.COMERCIAL_PEDIDOS_VENDA, () =>
    check.hasPermission("sales_orders.view")
  );
}

/** Export: contrato mapeia export←sales_orders.view até chave .export dedicada (P14). */
export function canExportSalesOrders(check: PermissionChecker): boolean {
  return check.hasPermission("sales_orders.view");
}

export function canViewSalesOrderDetail(check: PermissionChecker): boolean {
  return (
    check.hasPermission("sales_orders.detail.view") ||
    check.hasPermission("sales_orders.view")
  );
}

export function canViewSalesOrderInvoice(check: PermissionChecker): boolean {
  return check.hasPermission("sales_orders.invoice.view");
}

// ─── Comercial: Formação de Preço ────────────────────────────

export function canViewPricing(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.COMERCIAL_FORMACAO_PRECO, () =>
    check.hasPermission("pricing.view")
  );
}

export function canSimulatePricing(check: PermissionChecker): boolean {
  return check.hasPermission("pricing.simulate");
}

export function canManagePricingTables(check: PermissionChecker): boolean {
  return (
    check.hasPermission("pricing.generate_tables") ||
    check.hasPermission("pricing.publish_tables")
  );
}

/** Excluir premissa: manage de tabelas — não pricing.view (gap fechado Prompt 13). */
export function canDeletePricingPremises(check: PermissionChecker): boolean {
  return canManagePricingTables(check);
}

export const PRICING_DELETE_PERMISSIONS = [
  "pricing.generate_tables",
  "pricing.publish_tables",
] as const;

// ─── Engenharia: Produtos + abas ─────────────────────────────

export function canViewProducts(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.ENGENHARIA_PRODUTOS, () =>
    check.hasPermission("products.view")
  );
}

export function listVisibleProductTabIds(
  check: ResourceAwareChecker
): ProductTabId[] {
  return getVisibleProductTabs(check);
}

// ─── Engenharia: Simulador / Simulações / Projetos / Materiais ─

export function canViewTransformationSimulator(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.ENGENHARIA_SIMULADOR_INJECAO, () =>
    check.hasPermission("products.view") || check.hasPermission("simulations.view")
  );
}

export function canViewSimulations(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.ENGENHARIA_SIMULACOES, () =>
    check.hasPermission("simulations.view")
  );
}

export function canCreateSimulations(check: PermissionChecker): boolean {
  return check.hasPermission("simulations.create");
}

export function canViewProjectsModule(check: ResourceAwareChecker): boolean {
  return legacyOrResource(check, ResourceKeys.ENGENHARIA_PROJETOS, () =>
    check.hasPermission("projects.view")
  );
}

export function canEditMaterials(check: PermissionChecker): boolean {
  return check.hasPermission("materials.edit");
}

export function canApproveMarketQuote(check: PermissionChecker): boolean {
  return check.hasPermission("materials.market_quote.approve");
}
