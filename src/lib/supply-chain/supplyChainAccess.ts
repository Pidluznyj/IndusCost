/**
 * OP-05 — Recursos/permissões e helpers de acesso dos módulos SC controlados.
 * Sem aliases amplos / mega-keys.
 */

export const SUPPLY_CHAIN_CONTRACT_KEYS = {
  purchases: "operations.supply_chain.purchases",
  inventory: "operations.supply_chain.inventory",
  receiving: "operations.supply_chain.receiving",
} as const;

/** Chaves de ação view — apenas estas (sem purchases.view / inventory.view). */
export const SUPPLY_CHAIN_VIEW_PERMISSIONS = {
  purchases: "operations.supply_chain.purchases.view",
  inventory: "operations.supply_chain.inventory.view",
  receiving: "operations.supply_chain.receiving.view",
} as const;

export const SUPPLY_CHAIN_MODULE_TO_CONTRACT: Record<
  "sc-purchases" | "sc-inventory" | "sc-receiving",
  string
> = {
  "sc-purchases": SUPPLY_CHAIN_CONTRACT_KEYS.purchases,
  "sc-inventory": SUPPLY_CHAIN_CONTRACT_KEYS.inventory,
  "sc-receiving": SUPPLY_CHAIN_CONTRACT_KEYS.receiving,
};

export const SUPPLY_CHAIN_MODULE_TO_VIEW_PERMISSION: Record<
  "sc-purchases" | "sc-inventory" | "sc-receiving",
  string
> = {
  "sc-purchases": SUPPLY_CHAIN_VIEW_PERMISSIONS.purchases,
  "sc-inventory": SUPPLY_CHAIN_VIEW_PERMISSIONS.inventory,
  "sc-receiving": SUPPLY_CHAIN_VIEW_PERMISSIONS.receiving,
};

export function canViewSupplyChainPurchasesModule(check: {
  hasPermission: (permission: string) => boolean;
}): boolean {
  return check.hasPermission(SUPPLY_CHAIN_VIEW_PERMISSIONS.purchases);
}

export function canViewSupplyChainInventoryModule(check: {
  hasPermission: (permission: string) => boolean;
}): boolean {
  return check.hasPermission(SUPPLY_CHAIN_VIEW_PERMISSIONS.inventory);
}

export function canViewSupplyChainReceivingModule(check: {
  hasPermission: (permission: string) => boolean;
}): boolean {
  return check.hasPermission(SUPPLY_CHAIN_VIEW_PERMISSIONS.receiving);
}

export function canViewSupplyChainModule(
  moduleId: "sc-purchases" | "sc-inventory" | "sc-receiving",
  check: { hasPermission: (permission: string) => boolean }
): boolean {
  return check.hasPermission(SUPPLY_CHAIN_MODULE_TO_VIEW_PERMISSION[moduleId]);
}
