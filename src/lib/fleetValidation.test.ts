import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertBlockReason,
  assertChecklistItemsComplete,
  assertCnhCategoryForVehicle,
  assertContractDateRange,
  assertDateRange,
  assertDriverAuthorizedForReservation,
  assertKmRange,
  assertReasonRequired,
  assertVehicleCanCheckout,
  assertMaintenanceCompletionDate,
  assertMaintenanceEditable,
  assertMaintenanceTransition,
  assertNonNegativeAmount,
  computeKmDriven,
  hasCriticalNotOk,
  isVehicleReservable,
  maintenanceNeedsApproval,
  resolveMaintenanceVehicleStatus,
  assertVehicleCanDispose,
  assertVehicleReservable,
  computeCnhStatus,
  computeDocumentStatus,
  findReservationConflict,
  isCnhValid,
  reservationPeriodsOverlap,
  FleetValidationError,
} from "./fleetValidation.js";
import { canUserCancelReservation } from "./fleetReservationOps.js";

describe("fleetValidation", () => {
  it("reservationPeriodsOverlap detects overlap", () => {
    const aStart = new Date("2026-06-01T10:00:00Z");
    const aEnd = new Date("2026-06-01T12:00:00Z");
    const bStart = new Date("2026-06-01T11:00:00Z");
    const bEnd = new Date("2026-06-01T13:00:00Z");
    assert.equal(reservationPeriodsOverlap(aStart, aEnd, bStart, bEnd), true);
    const afterStart = new Date("2026-06-01T12:00:00Z");
    const afterEnd = new Date("2026-06-01T14:00:00Z");
    assert.equal(reservationPeriodsOverlap(aStart, aEnd, afterStart, afterEnd), false);
  });

  it("findReservationConflict returns conflicting row", () => {
    const start = new Date("2026-06-02T08:00:00Z");
    const end = new Date("2026-06-02T18:00:00Z");
    const existing = [
      {
        id: "r1",
        startDateTime: new Date("2026-06-02T09:00:00Z"),
        endDateTime: new Date("2026-06-02T10:00:00Z"),
      },
    ];
    const hit = findReservationConflict(existing, start, end);
    assert.equal(hit?.id, "r1");
    const miss = findReservationConflict(existing, start, end, "r1");
    assert.equal(miss, undefined);
  });

  it("isVehicleReservable blocks maintenance and sold", () => {
    assert.equal(isVehicleReservable("AVAILABLE"), true);
    assert.equal(isVehicleReservable("MAINTENANCE"), false);
    assert.equal(isVehicleReservable("SOLD"), false);
  });

  it("assertVehicleReservable throws for blocked vehicle", () => {
    assert.throws(
      () => assertVehicleReservable({ status: "BLOCKED", plate: "ABC1D23" }),
      (e: unknown) => e instanceof FleetValidationError
    );
  });

  it("isCnhValid rejects expired CNH", () => {
    const driver = {
      status: "AUTHORIZED" as const,
      cnhExpirationDate: new Date("2020-01-01"),
    };
    assert.equal(isCnhValid(driver, new Date("2026-06-01")), false);
    assert.equal(
      isCnhValid(
        { ...driver, cnhExpirationDate: new Date("2027-01-01") },
        new Date("2026-06-01")
      ),
      true
    );
  });

  it("assertKmRange rejects checkin below checkout", () => {
    assert.throws(() => assertKmRange(100, 90), (e: unknown) => e instanceof FleetValidationError);
    assert.doesNotThrow(() => assertKmRange(100, 150));
  });

  it("isVehicleReservable blocks sold returned inactive and reserved", () => {
    assert.equal(isVehicleReservable("SOLD"), false);
    assert.equal(isVehicleReservable("RETURNED"), false);
    assert.equal(isVehicleReservable("INACTIVE"), false);
    assert.equal(isVehicleReservable("RESERVED"), false);
  });

  it("assertVehicleCanDispose blocks in use", () => {
    assert.throws(
      () => assertVehicleCanDispose("IN_USE"),
      (e: unknown) => e instanceof FleetValidationError
    );
  });

  it("assertBlockReason requires non-empty reason", () => {
    assert.throws(() => assertBlockReason(""), (e: unknown) => e instanceof FleetValidationError);
    assert.equal(assertBlockReason("  falha no freio  "), "falha no freio");
  });

  it("assertContractDateRange rejects end before start", () => {
    const start = new Date("2026-01-01");
    const end = new Date("2025-12-01");
    assert.throws(
      () => assertContractDateRange(start, end),
      (e: unknown) => e instanceof FleetValidationError
    );
  });

  it("computeDocumentStatus marks expired and expiring", () => {
    const now = new Date("2026-06-01");
    assert.equal(
      computeDocumentStatus("2020-01-01", 30, now),
      "EXPIRED"
    );
    assert.equal(
      computeDocumentStatus("2026-06-15", 30, now),
      "EXPIRING"
    );
    assert.equal(
      computeDocumentStatus("2027-01-01", 30, now),
      "VALID"
    );
  });

  it("computeCnhStatus detects expired and expiring", () => {
    const now = new Date("2026-06-01");
    assert.equal(computeCnhStatus("2020-01-01", 30, now), "EXPIRED");
    assert.equal(computeCnhStatus("2026-06-20", 30, now), "EXPIRING");
    assert.equal(computeCnhStatus("2027-01-01", 30, now), "VALID");
    assert.equal(computeCnhStatus(null, 30, now), "MISSING");
  });

  it("assertReasonRequired blocks empty reject/cancel reason", () => {
    assert.throws(() => assertReasonRequired("", "Motivo da rejeição"));
    assert.equal(assertReasonRequired("  conflito de agenda  "), "conflito de agenda");
  });

  it("assertDateRange rejects end before start", () => {
    const start = new Date("2026-06-02T10:00:00Z");
    const end = new Date("2026-06-02T08:00:00Z");
    assert.throws(
      () => assertDateRange(start, end, "Reserva"),
      (e: unknown) => e instanceof FleetValidationError
    );
  });

  it("assertDriverAuthorizedForReservation blocks blocked driver and expired CNH", () => {
    assert.throws(() =>
      assertDriverAuthorizedForReservation(
        { name: "A", status: "BLOCKED", cnhExpirationDate: new Date("2027-01-01"), cnhCategory: "B" },
        { blockExpiredCnh: true }
      )
    );
    assert.throws(() =>
      assertDriverAuthorizedForReservation(
        { name: "B", status: "AUTHORIZED", cnhExpirationDate: new Date("2020-01-01"), cnhCategory: "B" },
        { blockExpiredCnh: true, at: new Date("2026-06-01") }
      )
    );
  });

  it("assertCnhCategoryForVehicle enforces minimum category", () => {
    assert.throws(() => assertCnhCategoryForVehicle("A", "CAMINHAO"));
    assert.doesNotThrow(() => assertCnhCategoryForVehicle("C", "CAMINHAO"));
  });

  it("computeKmDriven subtracts checkout from checkin", () => {
    assert.equal(computeKmDriven(1000, 1250), 250);
    assert.throws(() => computeKmDriven(1000, 900));
  });

  it("assertChecklistItemsComplete requires all results", () => {
    assert.throws(() => assertChecklistItemsComplete([]));
    assert.throws(() =>
      assertChecklistItemsComplete([{ result: "OK" }, { result: null }])
    );
    assert.doesNotThrow(() =>
      assertChecklistItemsComplete([
        { result: "OK" },
        { result: "NOT_APPLICABLE" },
      ])
    );
  });

  it("hasCriticalNotOk detects critical failures", () => {
    assert.equal(
      hasCriticalNotOk([
        { isCritical: true, result: "NOT_OK" },
        { isCritical: false, result: "NOT_OK" },
      ]),
      true
    );
    assert.equal(hasCriticalNotOk([{ isCritical: true, result: "OK" }]), false);
  });

  it("assertVehicleCanCheckout blocks maintenance and blocked", () => {
    assert.throws(() => assertVehicleCanCheckout("MAINTENANCE"));
    assert.throws(() => assertVehicleCanCheckout("BLOCKED"));
    assert.doesNotThrow(() => assertVehicleCanCheckout("AVAILABLE"));
  });

  it("resolveMaintenanceVehicleStatus blocks critical priority as BLOCKED", () => {
    assert.equal(resolveMaintenanceVehicleStatus("CRITICA", true), "BLOCKED");
    assert.equal(resolveMaintenanceVehicleStatus("MEDIA", true), "MAINTENANCE");
    assert.equal(resolveMaintenanceVehicleStatus("MEDIA", false), null);
  });

  it("isVehicleReservable blocks vehicle in maintenance", () => {
    assert.equal(isVehicleReservable("MAINTENANCE"), false);
  });

  it("assertMaintenanceEditable blocks changes on completed", () => {
    assert.throws(() => assertMaintenanceEditable("COMPLETED"));
    assert.throws(() => assertMaintenanceEditable("CANCELED"));
  });

  it("assertMaintenanceCompletionDate rejects end before open", () => {
    const opened = new Date("2026-06-01");
    const completed = new Date("2026-05-01");
    assert.throws(() => assertMaintenanceCompletionDate(opened, completed));
  });

  it("maintenanceNeedsApproval uses threshold", () => {
    assert.equal(maintenanceNeedsApproval(6000, 5000), true);
    assert.equal(maintenanceNeedsApproval(100, 5000), false);
  });

  it("assertMaintenanceTransition validates workflow", () => {
    assert.doesNotThrow(() => assertMaintenanceTransition("OPEN", "PENDING_APPROVAL"));
    assert.throws(() => assertMaintenanceTransition("COMPLETED", "OPEN"));
  });

  it("canUserCancelReservation respects manage vs own reservation", () => {
    const pending = { requesterUserId: "u1", status: "PENDING_APPROVAL" as const };
    assert.equal(canUserCancelReservation(pending, "u1", false), true);
    assert.equal(canUserCancelReservation(pending, "u2", false), false);
    assert.equal(canUserCancelReservation(pending, "u2", true), true);
    assert.equal(canUserCancelReservation({ ...pending, status: "IN_USE" }, "u1", true), false);
  });
});

describe("fleet financial helpers", async () => {
  const {
    assertCompetence,
    maskFinancialData,
    sumActiveCostAmounts,
    resolveFineInitialStatus,
    incidentBlocksVehicle,
    shouldCreateFuelingCost,
    computeAvgConsumption,
  } = await import("./fleetFinancialOps.js");

  it("assertCompetence requires YYYY-MM", () => {
    assert.equal(assertCompetence("2026-05"), "2026-05");
    assert.throws(() => assertCompetence("05/2026"));
  });

  it("negative cost amount is blocked", () => {
    assert.throws(() => assertNonNegativeAmount(-1));
  });

  it("canceled costs excluded from dashboard sum", () => {
    assert.equal(
      sumActiveCostAmounts([
        { status: "ACTIVE", amount: 100 },
        { status: "CANCELED", amount: 50 },
      ]),
      100
    );
  });

  it("maskFinancialData hides amounts without permission", () => {
    const masked = maskFinancialData({ amount: 99, label: "x" }, false) as {
      amount: number | null;
      amountMasked?: boolean;
      label: string;
    };
    assert.equal(masked.amount, null);
    assert.equal(masked.amountMasked, true);
    assert.equal(masked.label, "x");
  });

  it("fueling creates cost by default", () => {
    assert.equal(shouldCreateFuelingCost(undefined), true);
    assert.equal(shouldCreateFuelingCost(false), false);
  });

  it("fine without driver stays identifying", () => {
    assert.equal(resolveFineInitialStatus(null), "IDENTIFYING_DRIVER");
    assert.equal(resolveFineInitialStatus("driver-1"), "RECEIVED");
  });

  it("grave incident blocks vehicle", () => {
    assert.equal(incidentBlocksVehicle("GRAVE", false), true);
    assert.equal(incidentBlocksVehicle("BAIXA", false), false);
  });

  it("computeAvgConsumption returns L/100km when km > 0", () => {
    assert.equal(computeAvgConsumption(10, 100), 10);
  });
});
