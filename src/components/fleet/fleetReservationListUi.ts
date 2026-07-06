import type { FleetReservationRow, FleetReservationStatus } from "@/src/types/fleet";

const ACTIVE_PICKUP_STATUSES: FleetReservationStatus[] = [
  "IN_USE",
  "APPROVED",
  "PENDING_APPROVAL",
  "REQUESTED",
];

function isActivePickupStatus(status: FleetReservationStatus): boolean {
  return ACTIVE_PICKUP_STATUSES.includes(status);
}

function startMs(r: FleetReservationRow): number {
  return new Date(r.startDateTime).getTime();
}

/** Ordem de exibição: retiradas futuras/atuais por startDateTime asc; histórico ao final. */
export function sortReservationsByPickupOrder(
  rows: FleetReservationRow[]
): FleetReservationRow[] {
  return [...rows].sort((a, b) => {
    const aActive = isActivePickupStatus(a.status);
    const bActive = isActivePickupStatus(b.status);
    if (aActive !== bActive) return aActive ? -1 : 1;
    const aT = startMs(a);
    const bT = startMs(b);
    if (!aActive) return bT - aT;
    if (a.status === "IN_USE" && b.status !== "IN_USE") return -1;
    if (b.status === "IN_USE" && a.status !== "IN_USE") return 1;
    return aT - bT;
  });
}

export function vehicleHasActiveUsage(
  vehicleId: string,
  rows: FleetReservationRow[]
): boolean {
  return rows.some((r) => r.vehicleId === vehicleId && r.status === "IN_USE");
}

/** Retirada bloqueada quando o veículo já está em uso por outra reserva. */
export function isCheckoutBlocked(
  r: FleetReservationRow,
  rows: FleetReservationRow[]
): boolean {
  if (r.status !== "APPROVED") return false;
  if (r.vehicle?.status === "IN_USE") return true;
  return vehicleHasActiveUsage(r.vehicleId, rows);
}

/** Próxima retirada por veículo (destaque no grid). */
export function computeNextPickupIds(rows: FleetReservationRow[]): Set<string> {
  const byVehicle = new Map<string, FleetReservationRow[]>();
  for (const r of rows) {
    if (!r.vehicleId) continue;
    const list = byVehicle.get(r.vehicleId) ?? [];
    list.push(r);
    byVehicle.set(r.vehicleId, list);
  }

  const ids = new Set<string>();
  const now = Date.now();

  for (const list of byVehicle.values()) {
    const inUse = list.find((r) => r.status === "IN_USE");
    const approved = list
      .filter((r) => r.status === "APPROVED")
      .sort((a, b) => startMs(a) - startMs(b));

    if (approved.length === 0) continue;

    if (inUse) {
      const afterInUse =
        approved.find((r) => startMs(r) >= startMs(inUse)) ?? approved[0];
      ids.add(afterInUse.id);
      continue;
    }

    const upcoming = approved.find((r) => startMs(r) >= now) ?? approved[0];
    ids.add(upcoming.id);
  }

  return ids;
}
