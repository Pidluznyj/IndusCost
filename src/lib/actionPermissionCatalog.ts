/**
 * PERM-38 — catálogo de ações CRUD/especiais do inventário oficial (§7).
 * FE usa `canPerformAction` / `PermissionGate`; BE usa `requireResource`.
 * Não cobre todo botão do app — só superfícies inventariadas.
 */

import type { UiPermissionAction } from "@/src/lib/actionPermissionAccess.js";
import { ACTION_GATE_RESOURCES } from "@/src/lib/actionPermissionAccess.js";
import { COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { ENGINEERING_RESOURCE_KEYS } from "@/src/lib/engineeringAccess.js";
import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";
import { OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess.js";
import { EMPLOYEES_RESOURCE_KEYS } from "@/src/lib/employeesAccess.js";
import { ADMIN_SETTINGS_RESOURCE_KEYS } from "@/src/lib/adminSettingsAccess.js";

export type ActionPermissionSurface = {
  id: string;
  label: string;
  resourceKey: string;
  /** Ações mutáveis inventariadas (view fica no recurso de página). */
  actions: readonly UiPermissionAction[];
  /** Endpoints de escrita representativos (assert BE). */
  writeEndpoints: ReadonlyArray<{
    method: string;
    path: string;
    action: UiPermissionAction;
  }>;
};

export const ACTION_PERMISSION_SURFACES: readonly ActionPermissionSurface[] = [
  {
    id: "products",
    label: "Produtos",
    resourceKey: ENGINEERING_RESOURCE_KEYS.products,
    actions: ["create", "edit", "delete", "export"],
    writeEndpoints: [
      { method: "POST", path: "/api/products", action: "create" },
      { method: "PUT", path: "/api/products/:id", action: "update" },
      { method: "DELETE", path: "/api/products/:id", action: "delete" },
    ],
  },
  {
    id: "materials",
    label: "Matérias-primas",
    resourceKey: ENGINEERING_RESOURCE_KEYS.materials,
    actions: ["edit", "export"],
    writeEndpoints: [
      { method: "POST", path: "/api/materials", action: "update" },
      { method: "PUT", path: "/api/materials/:id", action: "update" },
      { method: "DELETE", path: "/api/materials/:id", action: "update" },
    ],
  },
  {
    id: "materials-mi-quotes",
    label: "Inteligência de Mercado — cotações",
    resourceKey: ENGINEERING_RESOURCE_KEYS.marketIntelligenceQuotes,
    actions: ["edit", "approve", "export", "execute"],
    writeEndpoints: [
      {
        method: "POST",
        path: "/api/materials/market-intelligence/:materialId/quotes",
        action: "update",
      },
      {
        method: "POST",
        path: "/api/materials/market-intelligence/:materialId/quotes/:quoteId/approve",
        action: "approve",
      },
    ],
  },
  {
    id: "simulations",
    label: "Simulações",
    resourceKey: ENGINEERING_RESOURCE_KEYS.simulations,
    actions: ["create"],
    writeEndpoints: [
      { method: "POST", path: "/api/simulations", action: "create" },
      { method: "POST", path: "/api/new-product-simulations", action: "create" },
    ],
  },
  {
    id: "customers",
    label: "Clientes",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.customers,
    actions: ["create", "edit"],
    writeEndpoints: [
      { method: "POST", path: "/api/customers", action: "create" },
      { method: "PUT", path: "/api/customers/:id", action: "update" },
      { method: "DELETE", path: "/api/customers/:id", action: "update" },
    ],
  },
  {
    id: "proposals",
    label: "Propostas",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.proposals,
    actions: ["create", "edit", "delete", "print"],
    writeEndpoints: [
      { method: "POST", path: "/api/proposals", action: "create" },
      { method: "PUT", path: "/api/proposals/:id", action: "update" },
      { method: "DELETE", path: "/api/proposals/:id", action: "delete" },
      { method: "GET", path: "/api/proposals/:id/pdf*", action: "export" },
    ],
  },
  {
    id: "sales-orders",
    label: "Pedidos de Venda",
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrders,
    actions: ["export", "print"],
    writeEndpoints: [
      { method: "GET", path: "/api/sales-orders/export*", action: "export" },
    ],
  },
  {
    id: "commissions-close",
    label: "Comissões — fechamento",
    resourceKey: ACTION_GATE_RESOURCES.commissionsMonthlyClosing,
    actions: ["close", "reprocess", "export"],
    writeEndpoints: [
      {
        method: "POST",
        path: "/api/commissions/receipt-closing/apply",
        action: "close",
      },
    ],
  },
  {
    id: "finance-ap",
    label: "Contas a Pagar",
    resourceKey: ACTION_GATE_RESOURCES.financeAccountsPayable,
    actions: ["export", "configure", "execute"],
    writeEndpoints: [
      {
        method: "POST",
        path: "/api/finance/accounts-payable/export",
        action: "export",
      },
    ],
  },
  {
    id: "finance-ar",
    label: "Contas a Receber",
    resourceKey: ACTION_GATE_RESOURCES.financeAccountsReceivable,
    actions: ["export", "execute"],
    writeEndpoints: [
      {
        method: "POST",
        path: "/api/finance/accounts-receivable/export",
        action: "export",
      },
    ],
  },
  {
    id: "finance-suppliers",
    label: "Fornecedores",
    resourceKey: FINANCE_MODULE_RESOURCE_KEYS.suppliers,
    actions: ["create", "edit", "configure", "delete"],
    writeEndpoints: [
      {
        method: "POST",
        path: "/api/finance/suppliers/apply",
        action: "manage",
      },
      {
        method: "POST",
        path: "/api/finance/suppliers/rebuild-from-ap-apply",
        action: "manage",
      },
    ],
  },
  {
    id: "inventory",
    label: "Estoque",
    resourceKey: OPERATIONS_RESOURCE_KEYS.inventory,
    actions: ["create", "edit", "approve", "configure"],
    writeEndpoints: [
      { method: "POST", path: "/api/inventory/movements", action: "create" },
    ],
  },
  {
    id: "purchases",
    label: "Compras",
    resourceKey: OPERATIONS_RESOURCE_KEYS.purchases,
    actions: ["create", "edit", "delete"],
    writeEndpoints: [
      { method: "POST", path: "/api/purchase-requests", action: "create" },
      { method: "POST", path: "/api/purchase-requests/:id/submit", action: "create" },
      { method: "POST", path: "/api/purchase-requests/:id/approve", action: "edit" },
      { method: "POST", path: "/api/purchase-requests/:id/reject", action: "edit" },
      { method: "POST", path: "/api/purchase-requests/:id/cancel", action: "edit" },
      { method: "POST", path: "/api/purchase-requests/:id/reopen-draft", action: "edit" },
      { method: "POST", path: "/api/purchase-requests/:id/forward-to-quotation", action: "edit" },
      { method: "POST", path: "/api/purchase-requests/:id/evidences", action: "edit" },
      { method: "POST", path: "/api/purchase-quotations/:id/invite-supplier", action: "edit" },
      { method: "PUT", path: "/api/purchase-quotations/:id/suppliers/:quotationSupplierId/offer", action: "edit" },
      { method: "POST", path: "/api/purchase-quotations/:id/offers/:offerId/mark-received", action: "edit" },
      { method: "POST", path: "/api/purchase-quotations/:id/rounds", action: "edit" },
      { method: "POST", path: "/api/purchase-quotations/:id/rounds/:roundId/lines", action: "edit" },
      { method: "POST", path: "/api/purchase-quotations/:id/rounds/:roundId/close", action: "edit" },
      { method: "POST", path: "/api/purchase-quotations/:id/offers/:offerId/mark-winner", action: "edit" },
      { method: "POST", path: "/api/purchase-evidences", action: "edit" },
      { method: "POST", path: "/api/purchase-evidences/:evidenceId/soft-delete", action: "edit" },
    ],
  },
  {
    id: "machines",
    label: "Máquinas",
    resourceKey: OPERATIONS_RESOURCE_KEYS.machines,
    actions: ["edit"],
    writeEndpoints: [
      { method: "PUT", path: "/api/machines/:id", action: "update" },
    ],
  },
  {
    id: "operations-performance",
    label: "Performance",
    resourceKey: OPERATIONS_RESOURCE_KEYS.performance,
    actions: ["edit"],
    writeEndpoints: [
      {
        method: "PUT",
        path: "/api/operations/component-performance/:id",
        action: "update",
      },
    ],
  },
  {
    id: "production-orders",
    label: "Ordens de Produção",
    resourceKey: OPERATIONS_RESOURCE_KEYS.productionOrders,
    actions: [],
    writeEndpoints: [],
  },
  {
    id: "maintenance",
    label: "Manutenção Predial",
    resourceKey: OPERATIONS_RESOURCE_KEYS.maintenance,
    actions: ["configure"],
    writeEndpoints: [
      { method: "POST", path: "/api/maintenance-requests", action: "configure" },
    ],
  },
  {
    id: "fleet",
    label: "Gestão de Frota",
    resourceKey: OPERATIONS_RESOURCE_KEYS.fleet,
    actions: ["configure"],
    writeEndpoints: [
      { method: "POST", path: "/api/fleet/vehicles", action: "configure" },
    ],
  },
  {
    id: "employees",
    label: "Pessoas / RH",
    resourceKey: EMPLOYEES_RESOURCE_KEYS.module,
    actions: ["create", "edit", "configure"],
    writeEndpoints: [
      { method: "POST", path: "/api/employees", action: "create" },
      { method: "PUT", path: "/api/employees/:id", action: "update" },
    ],
  },
  {
    id: "settings",
    label: "Configurações",
    resourceKey: ADMIN_SETTINGS_RESOURCE_KEYS.globalParams,
    actions: ["configure", "edit"],
    writeEndpoints: [
      { method: "PUT", path: "/api/settings/globals", action: "update" },
    ],
  },
] as const;

/** Mensagem quando permissões mudam durante a sessão (poll / 403 stale). */
export const PERMISSIONS_CHANGED_SESSION_MESSAGE =
  "Suas permissões foram atualizadas. Botões e menus agora refletem o novo acesso.";

export function listActionPermissionSurfaces(): readonly ActionPermissionSurface[] {
  return ACTION_PERMISSION_SURFACES;
}

export function resolveSurfaceAction(
  surfaceId: string,
  uiAction: UiPermissionAction
): { resourceKey: string; action: UiPermissionAction } | null {
  const surface = ACTION_PERMISSION_SURFACES.find((s) => s.id === surfaceId);
  if (!surface) return null;
  if (!surface.actions.includes(uiAction)) return null;
  // Fornecedores / manutenção / frota: contrato usa manage (não create/update finos).
  if (
    surface.id === "finance-suppliers" ||
    surface.id === "maintenance" ||
    surface.id === "fleet"
  ) {
    if (
      uiAction === "create" ||
      uiAction === "edit" ||
      uiAction === "configure" ||
      uiAction === "delete"
    ) {
      return { resourceKey: surface.resourceKey, action: "manage" };
    }
  }
  // Máquinas / Performance: UI edit → contrato update
  if (
    (surface.id === "machines" || surface.id === "operations-performance") &&
    uiAction === "edit"
  ) {
    return { resourceKey: surface.resourceKey, action: "update" };
  }
  return { resourceKey: surface.resourceKey, action: uiAction };
}
