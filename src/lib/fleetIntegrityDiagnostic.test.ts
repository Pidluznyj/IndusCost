import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectCanceledCostsInDashboardSum,
  detectDocumentStatusMismatch,
  detectReservationOverlaps,
  detectUsageKmDrivenMismatch,
  detectVehicleInUseWithoutOpenUsage,
  filterCostsForDashboard,
  runFleetIntegrityChecks,
  summarizeFleetIntegrityReport,
  type FleetIntegrityDataset,
} from "./fleetIntegrityDiagnostic.js";

describe("fleetIntegrityDiagnostic", () => {
  it("detects overlapping reservations for same vehicle", () => {
    const t0 = new Date("2026-06-01T10:00:00Z");
    const t1 = new Date("2026-06-01T14:00:00Z");
    const t2 = new Date("2026-06-01T12:00:00Z");
    const t3 = new Date("2026-06-01T18:00:00Z");
    const issues = detectReservationOverlaps([
      {
        id: "r1",
        vehicleId: "v1",
        startDateTime: t0,
        endDateTime: t1,
        status: "APPROVED",
      },
      {
        id: "r2",
        vehicleId: "v1",
        startDateTime: t2,
        endDateTime: t3,
        status: "APPROVED",
      },
    ]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "RESERVATION_OVERLAP");
    assert.equal(issues[0].severity, "critical");
  });

  it("detects kmDriven mismatch", () => {
    const issues = detectUsageKmDrivenMismatch([
      {
        id: "u1",
        checkoutKm: 1000,
        checkinKm: 1050,
        kmDriven: 40,
      },
    ]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "USAGE_KM_DRIVEN_MISMATCH");
    assert.equal(issues[0].safeAutoFix, true);
  });

  it("detects expired document stored as VALID", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const issues = detectDocumentStatusMismatch(
      [
        {
          id: "d1",
          vehicleId: "v1",
          expirationDate: new Date("2020-01-15"),
          status: "VALID",
        },
      ],
      30,
      now
    );
    assert.ok(issues.some((i) => i.code === "DOCUMENT_STATUS_STALE_VALID"));
  });

  it("detects vehicle IN_USE without open usage", () => {
    const issues = detectVehicleInUseWithoutOpenUsage(
      [{ id: "v1", status: "IN_USE" }],
      [{ id: "u1", vehicleId: "v2", status: "CHECKED_OUT" }]
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "VEHICLE_IN_USE_WITHOUT_OPEN_USAGE");
  });

  it("dashboard filter excludes CANCELED costs", () => {
    const costs = [
      { id: "c1", status: "ACTIVE", amount: 100 },
      { id: "c2", status: "CANCELED", amount: 500 },
    ];
    const active = filterCostsForDashboard(costs);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, "c1");
    const issues = detectCanceledCostsInDashboardSum(costs);
    assert.equal(issues.length, 0);
  });

  it("runFleetIntegrityChecks flags invalid reservation period", () => {
    const data: FleetIntegrityDataset = {
      now: new Date("2026-06-01T12:00:00Z"),
      docAlertDays: 30,
      vehicles: [],
      reservations: [
        {
          id: "r1",
          vehicleId: "v1",
          driverId: null,
          startDateTime: new Date("2026-06-10T10:00:00Z"),
          endDateTime: new Date("2026-06-10T08:00:00Z"),
          status: "APPROVED",
        },
      ],
      drivers: [],
      usages: [],
      maintenances: [],
      documents: [],
      contracts: [],
      costs: [],
      orphanRows: [],
    };
    const report = summarizeFleetIntegrityReport(runFleetIntegrityChecks(data));
    assert.ok(report.issues.some((i) => i.code === "RESERVATION_INVALID_PERIOD"));
  });
});
