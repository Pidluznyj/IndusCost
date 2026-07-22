/**
 * Operações — matriz de acesso piloto (P16).
 * Actions do contrato apenas — sem inventar CRUD; sem costs.view / finance.* .
 *
 * | resourceKey | actions |
 * |-------------|---------|
 * | operations.machines | view, update |
 * | operations.inventory | view, manage |
 * | operations.inventory.items | view, manage |
 * | operations.inventory.warehouses | view, manage |
 * | operations.inventory.movements | view, create |
 * | operations.inventory.counts | view, manage, approve |
 * | operations.purchases | view, create, update, delete |
 * | operations.performance | view, update |
 * | operations.maintenance | view, manage |
 * | operations.fleet | view, manage |
 * | operations.production_orders | view |
 */

export const OPERATIONS_RESOURCE_KEYS = {
  machines: "operations.machines",
  inventory: "operations.inventory",
  inventoryItems: "operations.inventory.items",
  inventoryWarehouses: "operations.inventory.warehouses",
  inventoryMovements: "operations.inventory.movements",
  inventoryCounts: "operations.inventory.counts",
  purchases: "operations.purchases",
  supplyChainPurchases: "operations.supply_chain.purchases",
  supplyChainInventory: "operations.supply_chain.inventory",
  supplyChainReceiving: "operations.supply_chain.receiving",
  performance: "operations.performance",
  productionOrders: "operations.production_orders",
  maintenance: "operations.maintenance",
  fleet: "operations.fleet",
} as const;

export const OPERATIONS_ACTIONS = {
  view: "view",
  create: "create",
  update: "update",
  delete: "delete",
  manage: "manage",
  approve: "approve",
} as const;

export type OperationsContractAction =
  (typeof OPERATIONS_ACTIONS)[keyof typeof OPERATIONS_ACTIONS];

/** POST/DELETE machines usam update (contrato sem create/delete). */
export const OPERATIONS_PILOT_ENDPOINTS = [
  { method: "GET", path: "/api/machines", resourceKey: "operations.machines", action: "view" },
  { method: "POST", path: "/api/machines", resourceKey: "operations.machines", action: "update" },
  { method: "PUT", path: "/api/machines/:id", resourceKey: "operations.machines", action: "update" },
  { method: "DELETE", path: "/api/machines/:id", resourceKey: "operations.machines", action: "update" },

  {
    method: "GET",
    path: "/api/inventory/*",
    resourceKey: "operations.inventory",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/inventory/items*",
    resourceKey: "operations.inventory.items",
    action: "manage",
  },
  {
    method: "PUT",
    path: "/api/inventory/items*",
    resourceKey: "operations.inventory.items",
    action: "manage",
  },
  {
    method: "GET",
    path: "/api/inventory/official-materials*",
    resourceKey: "operations.inventory.items",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/inventory/warehouses*",
    resourceKey: "operations.inventory.warehouses",
    action: "manage",
  },
  {
    method: "PUT",
    path: "/api/inventory/warehouses*",
    resourceKey: "operations.inventory.warehouses",
    action: "manage",
  },
  {
    method: "PATCH",
    path: "/api/inventory/warehouses*",
    resourceKey: "operations.inventory.warehouses",
    action: "manage",
  },
  {
    method: "GET",
    path: "/api/inventory/warehouses/*/locations*",
    resourceKey: "operations.inventory.warehouses",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/inventory/movements",
    resourceKey: "operations.inventory.movements",
    action: "create",
  },
  {
    method: "POST",
    path: "/api/inventory/movements/*/reverse",
    resourceKey: "operations.inventory.movements",
    action: "create",
  },
  {
    method: "POST",
    path: "/api/inventory/initial-balances",
    resourceKey: "operations.inventory.movements",
    action: "create",
  },
  {
    method: "GET",
    path: "/api/inventory/initial-balances*",
    resourceKey: "operations.inventory",
    action: "view",
  },
  {
    method: "GET",
    path: "/api/inventory/balances/export",
    resourceKey: "operations.inventory",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/inventory/balances/rebuild",
    resourceKey: "operations.inventory",
    action: "manage",
  },
  {
    method: "POST",
    path: "/api/inventory/reservations*",
    resourceKey: "operations.inventory",
    action: "manage",
  },
  {
    method: "GET",
    path: "/api/inventory/reservations*",
    resourceKey: "operations.inventory",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/inventory/blocks*",
    resourceKey: "operations.inventory",
    action: "manage",
  },
  {
    method: "GET",
    path: "/api/inventory/blocks*",
    resourceKey: "operations.inventory",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/inventory/quarantine*",
    resourceKey: "operations.inventory",
    action: "manage",
  },
  {
    method: "POST",
    path: "/api/inventory/count-sessions*",
    resourceKey: "operations.inventory.counts",
    action: "manage",
  },
  {
    method: "POST",
    path: "/api/inventory/count-sessions/:id/approve",
    resourceKey: "operations.inventory.counts",
    action: "approve",
  },
  {
    method: "POST",
    path: "/api/inventory/reservations*",
    resourceKey: "operations.inventory",
    action: "manage",
  },

  {
    method: "GET",
    path: "/api/purchase-requests",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/purchase-requests",
    resourceKey: "operations.purchases",
    action: "create",
  },
  {
    method: "PUT",
    path: "/api/purchase-requests/:id",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "GET",
    path: "/api/purchase-requests/official-refs/*",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "GET",
    path: "/api/purchase-requests/:id/history",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "GET",
    path: "/api/purchase-requests/:id/evidences*",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/purchase-requests/:id/evidences",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "POST",
    path: "/api/purchase-requests/:id/submit",
    resourceKey: "operations.purchases",
    action: "create",
  },
  {
    method: "POST",
    path: "/api/purchase-requests/:id/approve",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "POST",
    path: "/api/purchase-requests/:id/reject",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "POST",
    path: "/api/purchase-requests/:id/cancel",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "POST",
    path: "/api/purchase-requests/:id/reopen-draft",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "POST",
    path: "/api/purchase-requests/:id/forward-to-quotation",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "GET",
    path: "/api/purchase-requests/:id/detail",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "GET",
    path: "/api/purchase-quotations",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "GET",
    path: "/api/purchase-quotations/official-refs/*",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "GET",
    path: "/api/purchase-quotations/:id",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "PATCH",
    path: "/api/purchase-quotations/:id",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "POST",
    path: "/api/purchase-quotations/:id/invite-supplier",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "PUT",
    path: "/api/purchase-quotations/:id/suppliers/:quotationSupplierId/offer",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "POST",
    path: "/api/purchase-quotations/:id/offers/:offerId/mark-received",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "GET",
    path: "/api/purchase-quotations/:id/rounds",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/purchase-quotations/:id/rounds",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "POST",
    path: "/api/purchase-quotations/:id/rounds/:roundId/lines",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "POST",
    path: "/api/purchase-quotations/:id/rounds/:roundId/close",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "GET",
    path: "/api/purchase-quotations/:id/offers/:offerId/savings",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/purchase-quotations/:id/offers/:offerId/mark-winner",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "GET",
    path: "/api/purchase-evidences",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/purchase-evidences",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "GET",
    path: "/api/purchase-evidences/:evidenceId/download",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/purchase-evidences/:evidenceId/soft-delete",
    resourceKey: "operations.purchases",
    action: "update",
  },
  {
    method: "GET",
    path: "/api/cost-centers",
    resourceKey: "operations.purchases",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/cost-centers",
    resourceKey: "operations.purchases",
    action: "update",
  },

  {
    method: "GET",
    path: "/api/operations/performance/*",
    resourceKey: "operations.performance",
    action: "view",
  },
  {
    method: "PATCH",
    path: "/api/operations/performance/components/:id",
    resourceKey: "operations.performance",
    action: "update",
  },

  {
    method: "GET",
    path: "/api/operations/production-orders",
    resourceKey: "operations.production_orders",
    action: "view",
  },
  {
    method: "GET",
    path: "/api/operations/production-orders/:id",
    resourceKey: "operations.production_orders",
    action: "view",
  },

  {
    method: "GET",
    path: "/api/maintenance-requests",
    resourceKey: "operations.maintenance",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/maintenance-requests",
    resourceKey: "operations.maintenance",
    action: "manage",
  },
  {
    method: "PATCH",
    path: "/api/maintenance-requests/:id*",
    resourceKey: "operations.maintenance",
    action: "manage",
  },

  { method: "GET", path: "/api/fleet/*", resourceKey: "operations.fleet", action: "view" },
  {
    method: "POST|PUT|PATCH|DELETE",
    path: "/api/fleet/*",
    resourceKey: "operations.fleet",
    action: "manage",
  },
] as const;

/** P09/P16: costs.view e chaves financeiras NÃO abrem Operações / Máquinas. */
export const OPERATIONS_FORBIDDEN_FINANCE_KEYS = [
  "costs.view",
  "finance.view",
  "finance.accountsPayable.view",
  "finance.accountsReceivable.view",
] as const;

export const OPERATIONS_MODULE_RESOURCE_KEYS = [
  OPERATIONS_RESOURCE_KEYS.machines,
  OPERATIONS_RESOURCE_KEYS.inventory,
  OPERATIONS_RESOURCE_KEYS.purchases,
  OPERATIONS_RESOURCE_KEYS.performance,
  OPERATIONS_RESOURCE_KEYS.productionOrders,
  OPERATIONS_RESOURCE_KEYS.maintenance,
  OPERATIONS_RESOURCE_KEYS.fleet,
] as const;
