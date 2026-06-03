import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertBlockReason,
  assertContractDateRange,
  assertKmRange,
  assertVehicleCanDispose,
  assertVehicleReservable,
  computeDocumentStatus,
  findReservationConflict,
  isCnhValid,
  isVehicleReservable,
  reservationPeriodsOverlap,
  FleetValidationError,
} from "./fleetValidation.js";

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
});
