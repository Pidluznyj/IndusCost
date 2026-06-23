import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { FleetExecutiveVehicleRow } from "@/src/types/fleet";
import {
  buildFleetAttentionReservations,
  computeUsageKmRecord,
  parseFleetExecutiveDashboardQuery,
  rankTopVehiclesByMetric,
  resolveFleetMonthRange,
  sortFleetExecutiveGridRows,
  sumMonthlyKmFromUsages,
  summarizeReservationsByStatus,
} from "./fleetExecutiveDashboard.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function vehicleRow(
  partial: Partial<FleetExecutiveVehicleRow> & Pick<FleetExecutiveVehicleRow, "id" | "plate">
): FleetExecutiveVehicleRow {
  return {
    brand: "Marca",
    model: "Modelo",
    modelYear: 2024,
    status: "AVAILABLE",
    vehicleType: null,
    unit: null,
    currentKm: 1000,
    monthlyKm: 0,
    monthlyReservations: 0,
    lastReservation: null,
    nextReservation: null,
    idleDays: null,
    alerts: [],
    alertCount: 0,
    ...partial,
  };
}

describe("fleetExecutiveDashboard", () => {
  it("endpoint/dashboard retorna summary mesmo sem veículos", () => {
    assert.match(read("src/lib/fleetManagementRoutes.ts"), /buildFleetExecutiveDashboard/);
    assert.match(read("src/lib/fleetRoutes.ts"), /getFleetDashboardPayload/);
    const vehicles: FleetExecutiveVehicleRow[] = [];
    assert.equal(vehicles.length, 0);
    assert.deepEqual(rankTopVehiclesByMetric(vehicles, "monthlyReservations"), []);
    assert.deepEqual(rankTopVehiclesByMetric(vehicles, "monthlyKm"), []);
    assert.deepEqual(summarizeReservationsByStatus([]), []);
  });

  it("total de veículos cadastrado bate com base", () => {
    const vehicles = [
      vehicleRow({ id: "v1", plate: "ABC1D23", monthlyReservations: 2 }),
      vehicleRow({ id: "v2", plate: "DEF4G56", monthlyReservations: 1 }),
      vehicleRow({ id: "v3", plate: "GHI7J89", monthlyReservations: 0 }),
    ];
    assert.equal(vehicles.length, 3);
    assert.equal(
      vehicles.filter((v) => v.status !== "INACTIVE" && v.status !== "SOLD").length,
      3
    );
  });

  it("reservas por status são calculadas corretamente", () => {
    const rows = [
      { status: "APPROVED" },
      { status: "APPROVED" },
      { status: "IN_USE" },
      { status: "FINISHED" },
      { status: "CANCELED" },
    ];
    const summary = summarizeReservationsByStatus(rows);
    assert.equal(summary.find((s) => s.status === "APPROVED")?.count, 2);
    assert.equal(summary.find((s) => s.status === "IN_USE")?.count, 1);
    assert.equal(summary.find((s) => s.status === "FINISHED")?.count, 1);
    assert.equal(summary.find((s) => s.status === "CANCELED")?.count, 1);
  });

  it("KM mensal soma corretamente quando há km inicial/final", () => {
    assert.equal(computeUsageKmRecord({ kmDriven: null, checkoutKm: 100, checkinKm: 250 }), 150);
    assert.equal(computeUsageKmRecord({ kmDriven: 80, checkoutKm: 100, checkinKm: 250 }), 80);
    const total = sumMonthlyKmFromUsages([
      { kmDriven: null, checkoutKm: 1000, checkinKm: 1200 },
      { kmDriven: 50, checkoutKm: null, checkinKm: null },
      { kmDriven: null, checkoutKm: 500, checkinKm: 450 },
    ]);
    assert.equal(total, 250);
  });

  it("veículo mais reservado é identificado", () => {
    const vehicles = [
      vehicleRow({ id: "v1", plate: "AAA1A11", monthlyReservations: 1 }),
      vehicleRow({ id: "v2", plate: "BBB2B22", monthlyReservations: 5 }),
      vehicleRow({ id: "v3", plate: "CCC3C33", monthlyReservations: 3 }),
    ];
    const top = rankTopVehiclesByMetric(vehicles, "monthlyReservations");
    assert.equal(top[0]?.vehicleId, "v2");
    assert.equal(top[0]?.value, 5);
  });

  it("veículo com mais KM é identificado", () => {
    const vehicles = [
      vehicleRow({ id: "v1", plate: "AAA1A11", monthlyKm: 120 }),
      vehicleRow({ id: "v2", plate: "BBB2B22", monthlyKm: 450 }),
      vehicleRow({ id: "v3", plate: "CCC3C33", monthlyKm: 300 }),
    ];
    const top = rankTopVehiclesByMetric(vehicles, "monthlyKm");
    assert.equal(top[0]?.vehicleId, "v2");
    assert.equal(top[0]?.value, 450);
  });

  it("alertas de reserva vencida são gerados", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const items = buildFleetAttentionReservations({
      now,
      reservations: [
        {
          id: "r1",
          status: "APPROVED",
          startDateTime: new Date("2026-06-10T08:00:00Z"),
          endDateTime: new Date("2026-06-14T18:00:00Z"),
          driverId: "d1",
          vehicle: { plate: "ABC1D23", status: "RESERVED" },
          usage: null,
        },
      ],
    });
    assert.ok(items.some((i) => i.reason === "Devolução vencida sem fechamento"));
    assert.equal(items[0]?.severity, "critical");
  });

  it("alertas de km inconsistente são gerados", () => {
    const items = buildFleetAttentionReservations({
      now: new Date("2026-06-15T12:00:00Z"),
      reservations: [
        {
          id: "r2",
          status: "FINISHED",
          startDateTime: new Date("2026-06-01T08:00:00Z"),
          endDateTime: new Date("2026-06-01T18:00:00Z"),
          driverId: "d1",
          vehicle: { plate: "DEF4G56", status: "AVAILABLE" },
          usage: { checkoutKm: 500, checkinKm: 480, kmDriven: null, status: "CHECKED_IN" },
        },
      ],
    });
    assert.ok(items.some((i) => i.reason === "Km final menor que km inicial"));
  });

  it("filtros de mês/ano alteram métricas mensais", () => {
    const june = resolveFleetMonthRange(2026, 6);
    const july = resolveFleetMonthRange(2026, 7);
    assert.equal(june.start.getMonth(), 5);
    assert.equal(june.end.getMonth(), 6);
    assert.equal(july.start.getMonth(), 6);
    assert.equal(july.end.getMonth(), 7);
    const parsed = parseFleetExecutiveDashboardQuery({ year: "2025", month: "3" });
    assert.equal(parsed.year, 2025);
    assert.equal(parsed.month, 3);
  });

  it("grid ordena por placa, reservas e KM", () => {
    const vehicles = [
      vehicleRow({ id: "v1", plate: "ZZZ9Z99", monthlyReservations: 2, monthlyKm: 100 }),
      vehicleRow({ id: "v2", plate: "AAA1A11", monthlyReservations: 5, monthlyKm: 300 }),
      vehicleRow({ id: "v3", plate: "MMM5M55", monthlyReservations: 1, monthlyKm: 500 }),
    ];
    const byPlate = sortFleetExecutiveGridRows(vehicles, "plate", "asc");
    assert.deepEqual(byPlate.map((v) => v.plate), ["AAA1A11", "MMM5M55", "ZZZ9Z99"]);
    const byRes = sortFleetExecutiveGridRows(vehicles, "monthlyReservations", "desc");
    assert.equal(byRes[0]?.id, "v2");
    const byKm = sortFleetExecutiveGridRows(vehicles, "monthlyKm", "desc");
    assert.equal(byKm[0]?.id, "v3");
  });

  it("UI da visão geral usa painel executivo", () => {
    assert.match(read("src/components/FleetModule.tsx"), /FleetOverviewTab/);
    assert.match(read("src/components/fleet/FleetOverviewTab.tsx"), /fleet-overview-tab/);
    assert.match(read("src/components/fleet/FleetOverviewTab.tsx"), /data-testid="fleet-overview-tab"/);
  });
});
