/**
 * Helpers PUROS de apresentação do painel executivo de Frotas.
 *
 * Sem Prisma, sem acesso a banco — seguro para ser importado por componentes
 * React. O carregamento dos dados (Prisma) fica em `fleetExecutiveDashboard.ts`
 * (server-only) e é exposto ao frontend via endpoint HTTP.
 */
import type { FleetExecutiveVehicleRow } from "@/src/types/fleet.js";

export function sortFleetExecutiveGridRows(
  rows: FleetExecutiveVehicleRow[],
  sortKey: "plate" | "monthlyReservations" | "monthlyKm" | "status",
  sortDir: "asc" | "desc"
): FleetExecutiveVehicleRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "plate") return a.plate.localeCompare(b.plate) * dir;
    if (sortKey === "status") return a.status.localeCompare(b.status) * dir;
    return (a[sortKey] - b[sortKey]) * dir;
  });
}
