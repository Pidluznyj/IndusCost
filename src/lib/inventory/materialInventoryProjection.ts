/**
 * Agregação canônica do saldo físico de um InventoryItem.
 * Puro — sem Prisma/API. Não soma warehouse-level e location-level juntos.
 */
export type PhysicalBalanceScopeRow = {
  locationId?: string | null;
  physicalQuantity: unknown;
};

export function hasLocationScope(locationId: string | null | undefined): boolean {
  return Boolean(locationId?.trim());
}

/**
 * Granularidade canônica:
 * - item.controlsLocation = true  → prefere linhas com locationId
 * - item.controlsLocation = false → prefere linhas warehouse-only (locationId null)
 * Se o conjunto preferido estiver vazio (anomalia), usa o outro — nunca os dois.
 */
export function selectCanonicalPhysicalBalanceRows<T extends PhysicalBalanceScopeRow>(
  rows: readonly T[],
  controlsLocation: boolean
): T[] {
  const withLocation: T[] = [];
  const warehouseOnly: T[] = [];
  for (const row of rows) {
    if (hasLocationScope(row.locationId)) withLocation.push(row);
    else warehouseOnly.push(row);
  }
  if (controlsLocation) {
    return withLocation.length > 0 ? withLocation : warehouseOnly;
  }
  return warehouseOnly.length > 0 ? warehouseOnly : withLocation;
}
