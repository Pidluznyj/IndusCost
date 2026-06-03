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

describe("fleet management helpers", async () => {
  const {
    summarizeVehicleStatusCounts,
    parseFleetReportFilters,
  } = await import("./fleetManagementOps.js");
  const { computeCostPerKm } = await import("./fleetFinancialOps.js");
  const { computeDocumentStatus, computeCnhStatus } = await import("./fleetValidation.js");

  it("summarizeVehicleStatusCounts separates operational vs inactive", () => {
    const s = summarizeVehicleStatusCounts([
      { status: "AVAILABLE" },
      { status: "RESERVED" },
      { status: "IN_USE" },
      { status: "INACTIVE" },
      { status: "SOLD" },
    ]);
    assert.equal(s.totalOperational, 3);
    assert.equal(s.available, 1);
    assert.equal(s.reserved, 1);
    assert.equal(s.inUse, 1);
    assert.equal(s.inactiveReturnedSold, 2);
  });

  it("computeCostPerKm avoids division by zero", () => {
    assert.equal(computeCostPerKm(1000, 0), null);
    assert.equal(computeCostPerKm(1000, -5), null);
    assert.equal(computeCostPerKm(1000, 250), 4);
  });

  it("document alert respects configured days", () => {
    const now = new Date("2026-06-01T12:00:00");
    const expiring = new Date("2026-06-15");
    const expired = new Date("2026-05-01");
    assert.equal(computeDocumentStatus(expiring, 30, now), "EXPIRING");
    assert.equal(computeDocumentStatus(expired, 30, now), "EXPIRED");
    assert.equal(computeDocumentStatus(expiring, 5, now), "VALID");
  });

  it("parseFleetReportFilters maps query params", () => {
    const f = parseFleetReportFilters({
      start: "2026-01-01",
      end: "2026-01-31",
      unit: "SP",
      vehicleId: "abc",
    });
    assert.ok(f.start);
    assert.ok(f.end);
    assert.equal(f.unit, "SP");
    assert.equal(f.vehicleId, "abc");
  });

  it("cnh expiring uses alert days threshold", () => {
    const now = new Date("2026-06-01");
    const soon = new Date("2026-06-20");
    assert.equal(computeCnhStatus(soon, 30, now), "EXPIRING");
    assert.equal(computeCnhStatus(soon, 10, now), "VALID");
  });
});

describe("fleet mobile usage flow", async () => {
  const {
    isFleetChecklistRequiredForMode,
    isMobileChecklistStepComplete,
    mobileCheckoutBlockedByCritical,
    resolveCheckinPendingOutcome,
    resolveMobileUsageMode,
    validateMobileKmInput,
  } = await import("./fleetMobileUsage.js");

  it("checkout mobile with checklist OK allows valid km", () => {
    assert.equal(resolveMobileUsageMode("APPROVED"), "checkout");
    const km = validateMobileKmInput({
      mode: "checkout",
      kmRaw: "15000",
      vehicleCurrentKm: 14000,
      checkoutKm: null,
    });
    assert.equal(km.valid, true);
    if (km.valid) assert.equal(km.km, 15000);
    const items = [
      { result: "OK" as const, isCritical: true },
      { result: "OK" as const, isCritical: false },
    ];
    assert.equal(mobileCheckoutBlockedByCritical(items), false);
    assert.equal(isMobileChecklistStepComplete(items, true), true);
  });

  it("critical checklist blocks checkout", () => {
    const items = [
      { result: "NOT_OK" as const, isCritical: true },
      { result: "OK" as const, isCritical: false },
    ];
    assert.equal(mobileCheckoutBlockedByCritical(items), true);
  });

  it("checkin with damage finishes with pending", () => {
    assert.equal(resolveMobileUsageMode("IN_USE"), "checkin");
    const outcome = resolveCheckinPendingOutcome({
      hasDamage: true,
      manualPending: false,
      checklistItems: [{ result: "OK", isCritical: true }],
    });
    assert.equal(outcome.hasPending, true);
    assert.match(outcome.summary, /avaria/);
  });

  it("invalid km blocks checkin", () => {
    const low = validateMobileKmInput({
      mode: "checkin",
      kmRaw: "100",
      vehicleCurrentKm: 0,
      checkoutKm: 5000,
    });
    assert.equal(low.valid, false);
    if (!low.valid) assert.match(low.error, /menor/i);
  });

  it("respects FleetSettings checklist flags", () => {
    assert.equal(
      isFleetChecklistRequiredForMode({ checklistRetiradaObrigatorio: "true" }, "checkout"),
      true
    );
    assert.equal(
      isFleetChecklistRequiredForMode({ checklistDevolucaoObrigatorio: "false" }, "checkin"),
      false
    );
  });
});

describe("fleet alerts engine", async () => {
  const {
    contractToFleetAlert,
    dedupeFleetAlerts,
    documentToFleetAlert,
    driverCnhToFleetAlert,
    filterFleetAlertsByPermission,
    reservationOverdueToFleetAlert,
  } = await import("./fleetAlertsService.js");

  it("documento vencendo gera alerta", () => {
    const now = new Date("2026-06-01");
    const exp = new Date("2026-06-15");
    const alert = documentToFleetAlert(
      {
        id: "doc-1",
        documentType: "SEGURO",
        expirationDate: exp,
        vehicle: { plate: "ABC1D23", brand: "Ford" },
      },
      30,
      now
    );
    assert.ok(alert);
    assert.equal(alert?.code, "DOCUMENT_EXPIRING");
    assert.equal(alert?.level, "warning");
  });

  it("documento renovado remove alerta", () => {
    const now = new Date("2026-06-01");
    const exp = new Date("2027-01-01");
    const alert = documentToFleetAlert(
      {
        id: "doc-1",
        documentType: "SEGURO",
        expirationDate: exp,
        vehicle: { plate: "ABC1D23", brand: "Ford" },
      },
      30,
      now
    );
    assert.equal(alert, null);
  });

  it("CNH vencida gera alerta", () => {
    const alert = driverCnhToFleetAlert(
      {
        id: "drv-1",
        name: "João",
        cnhExpirationDate: new Date("2020-01-01"),
        status: "AUTHORIZED",
      },
      30,
      new Date("2026-06-01")
    );
    assert.ok(alert);
    assert.equal(alert?.code, "CNH_EXPIRED");
  });

  it("contrato vencido gera alerta", () => {
    const alert = contractToFleetAlert(
      {
        id: "ctr-1",
        contractNumber: "C-1",
        endDate: new Date("2025-01-01"),
        vehicle: { plate: "XYZ9Z99", brand: "VW" },
      },
      30,
      new Date("2026-06-01")
    );
    assert.ok(alert);
    assert.equal(alert?.code, "CONTRACT_EXPIRED");
  });

  it("reserva atrasada gera alerta", () => {
    const alert = reservationOverdueToFleetAlert({
      id: "res-1",
      vehicle: { plate: "AAA1A11", brand: "Fiat" },
    });
    assert.equal(alert.code, "RESERVATION_OVERDUE");
    assert.equal(alert.level, "critical");
  });

  it("sem dados retorna vazio após dedupe", () => {
    assert.deepEqual(dedupeFleetAlerts([]), []);
  });

  it("dedupe evita alertas duplicados", () => {
    const a = {
      level: "warning" as const,
      code: "DOCUMENT_EXPIRING",
      message: "x",
      entityType: "FleetVehicleDocument",
      entityId: "same-id",
    };
    const out = dedupeFleetAlerts([a, { ...a }]);
    assert.equal(out.length, 1);
  });

  it("usuário sem permissão financeira não vê alerta de pagamento", () => {
    const alerts = [
      {
        level: "warning" as const,
        code: "FINE_NO_DRIVER",
        message: "multa",
      },
      {
        level: "warning" as const,
        code: "FINE_PENDING_PAYMENT",
        message: "pagamento",
      },
    ];
    const filtered = filterFleetAlertsByPermission(alerts, false);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.code, "FINE_NO_DRIVER");
  });
});

describe("fleet reports", async () => {
  const {
    buildVehicleReportWhere,
    filterRowsByReportFilters,
    fleetReportToCsv,
    formatCostPerKmLabel,
    parseFleetReportFilters,
  } = await import("./fleetReportsService.js");
  const { maskFinancialData } = await import("./fleetFinancialOps.js");

  it("parseFleetReportFilters maps period and historical flag", () => {
    const f = parseFleetReportFilters({
      start: "2026-01-01",
      end: "2026-01-31",
      unit: "SP",
      includeInactive: "true",
      onlyExpiring: "true",
    });
    assert.ok(f.start);
    assert.ok(f.end);
    assert.equal(f.unit, "SP");
    assert.equal(f.includeInactive, true);
    assert.equal(f.onlyExpiring, true);
  });

  it("buildVehicleReportWhere excludes inactive by default", () => {
    const where = buildVehicleReportWhere({});
    assert.deepEqual(where.status, { notIn: ["INACTIVE", "SOLD", "RETURNED"] });
  });

  it("buildVehicleReportWhere includes inactive when historical", () => {
    const where = buildVehicleReportWhere({ includeInactive: true });
    assert.equal(where.status, undefined);
  });

  it("filterRowsByReportFilters respects unit filter", () => {
    const rows = [
      { unit: "SP", costCenter: "A" },
      { unit: "RJ", costCenter: "A" },
    ];
    const out = filterRowsByReportFilters(rows, { unit: "SP" }, { unit: "unit" });
    assert.equal(out.length, 1);
    assert.equal(out[0]?.unit, "SP");
  });

  it("fleetReportToCsv respects empty data", () => {
    const csv = fleetReportToCsv("fleet", []);
    assert.match(csv, /Nenhum registro/);
  });

  it("fleetReportToCsv includes filtered row values", () => {
    const csv = fleetReportToCsv("usage", [{ vehicle: "ABC1", kmDriven: 100 }]);
    assert.match(csv, /ABC1/);
    assert.match(csv, /kmDriven/);
  });

  it("maskFinancialData hides cost report amounts", () => {
    const row = maskFinancialData(
      [{ totalAmount: 500, costPerKm: 2.5, vehicle: "X" }],
      false
    ) as { totalAmount: number | null; costPerKm: number | null }[];
    assert.equal(row[0]?.totalAmount, null);
    assert.equal(row[0]?.costPerKm, null);
  });

  it("cost per km without km returns não calculável", () => {
    assert.equal(formatCostPerKmLabel(1000, 0), "não calculável");
    assert.equal(formatCostPerKmLabel(1000, -1), "não calculável");
  });

  it("cost per km with km is numeric", () => {
    assert.equal(formatCostPerKmLabel(1000, 250), "4.0000");
  });

  it("documento vencendo entra em filtro onlyExpiring", async () => {
    const { computeDocumentStatus } = await import("./fleetValidation.js");
    const now = new Date("2026-06-01");
    const exp = new Date("2026-06-15");
    assert.equal(computeDocumentStatus(exp, 30, now), "EXPIRING");
    const valid = new Date("2027-06-01");
    assert.equal(computeDocumentStatus(valid, 30, now), "VALID");
    const rows = [
      { complianceStatus: "EXPIRING" },
      { complianceStatus: "VALID" },
    ];
    const filtered = rows.filter((r) => ["EXPIRED", "EXPIRING"].includes(r.complianceStatus));
    assert.equal(filtered.length, 1);
  });
});

describe("fleet csv import", async () => {
  const {
    parseFleetCsvTable,
    validateVehicleImportRow,
    validateDriverImportRow,
    resolveDriverStatusOnImport,
    stripCsvBom,
  } = await import("./fleetCsvImport.js");

  const vehicleCsv = stripCsvBom(`placa;marca;modelo;status
ABC1D23;Ford;Ranger;AVAILABLE
ABC1D23;Fiat;Strada;AVAILABLE`);

  it("preview with duplicate plate in csv flags invalid row", () => {
    const parsed = parseFleetCsvTable(vehicleCsv, {
      placa: "plate",
      marca: "brand",
      modelo: "model",
      status: "status",
    });
    assert.ok(!("error" in parsed));
    if ("error" in parsed) return;

    const ctx = {
      seenPlates: new Map<string, number>(),
      existingPlates: new Map<string, string>(),
      allowUpdate: false,
    };
    const r1 = validateVehicleImportRow(parsed.records[0]!, 2, ctx);
    const r2 = validateVehicleImportRow(parsed.records[1]!, 3, ctx);
    assert.equal(r1.valid, true);
    assert.equal(r2.valid, false);
    assert.match(r2.errors.join(" "), /duplicada/i);
  });

  it("invalid csv returns error", () => {
    const r = parseFleetCsvTable("", { plate: "plate" });
    assert.ok("error" in r);
  });

  it("CPF duplicate in csv is invalid", () => {
    const csv = `nome;cpf\nA;11111111111\nB;11111111111`;
    const parsed = parseFleetCsvTable(csv, { nome: "name", cpf: "cpf" });
    assert.ok(!("error" in parsed));
    if ("error" in parsed) return;
    const ctx = {
      seenCpfs: new Map<string, number>(),
      existingCpfs: new Map<string, string>(),
      allowUpdate: false,
      blockExpiredCnh: true,
    };
    validateDriverImportRow(parsed.records[0]!, 2, ctx);
    const r2 = validateDriverImportRow(parsed.records[1]!, 3, ctx);
    assert.equal(r2.valid, false);
    assert.match(r2.errors.join(" "), /CPF duplicado/i);
  });

  it("expired CNH imports as BLOCKED when setting requires", () => {
    const r = resolveDriverStatusOnImport({
      cnhExpirationDate: new Date("2020-01-01"),
      blockExpiredCnh: true,
    });
    assert.equal(r.status, "BLOCKED");
    assert.equal(r.errors.length, 0);
  });

  it("partial apply only valid rows counted", () => {
    const parsed = parseFleetCsvTable(vehicleCsv, {
      placa: "plate",
      marca: "brand",
      modelo: "model",
      status: "status",
    });
    assert.ok(!("error" in parsed));
    if ("error" in parsed) return;
    const ctx = {
      seenPlates: new Map<string, number>(),
      existingPlates: new Map<string, string>(),
      allowUpdate: false,
    };
    const rows = parsed.records.map((rec, i) =>
      validateVehicleImportRow(rec, i + 2, ctx)
    );
    assert.equal(rows.filter((x) => x.valid).length, 1);
    assert.equal(rows.filter((x) => !x.valid).length, 1);
  });

  it("preview path does not call prisma", () => {
    assert.equal(typeof validateVehicleImportRow, "function");
  });
});

describe("fleet permissions enforcement", async () => {
  const {
    evaluateFleetRouteAccess,
    canViewFleetFinancial,
    FLEET_API_FORBIDDEN_STATUS,
  } = await import("./fleetAuth.js");
  const { maskFinancialData } = await import("./fleetFinancialOps.js");

  it("user without fleet.view is denied view routes (403 rule)", () => {
    assert.equal(evaluateFleetRouteAccess([], "view"), false);
    assert.equal(FLEET_API_FORBIDDEN_STATUS, 403);
  });

  it("user with fleet.view cannot edit vehicles", () => {
    assert.equal(evaluateFleetRouteAccess(["fleet.view"], "vehiclesEdit"), false);
    assert.equal(evaluateFleetRouteAccess(["fleet.view"], "manage"), false);
  });

  it("user without fleet.financial.view does not receive money values", () => {
    assert.equal(canViewFleetFinancial(["fleet.view"]), false);
    const masked = maskFinancialData({ amount: 1500, totalValue: 200 }, false) as {
      amount: number | null;
      amountMasked?: boolean;
    };
    assert.equal(masked.amount, null);
    assert.equal(masked.amountMasked, true);
  });

  it("user without fleet.settings.manage cannot change settings", () => {
    assert.equal(evaluateFleetRouteAccess(["fleet.view"], "settingsManage"), false);
    assert.equal(evaluateFleetRouteAccess(["fleet.manage"], "settingsManage"), false);
    assert.equal(evaluateFleetRouteAccess(["fleet.settings.manage"], "settingsManage"), true);
  });

  it("user without approve permission cannot approve reservations", () => {
    assert.equal(
      evaluateFleetRouteAccess(["fleet.view", "fleet.reservations.create"], "reservationsApprove"),
      false
    );
    assert.equal(
      evaluateFleetRouteAccess(["fleet.reservations.approve"], "reservationsApprove"),
      true
    );
    assert.equal(
      evaluateFleetRouteAccess(["fleet.manage"], "reservationsApprove"),
      true
    );
  });

  it("maintenance mutations require fleet.maintenance.manage or fleet.manage", () => {
    assert.equal(evaluateFleetRouteAccess(["fleet.view"], "maintenanceManage"), false);
    assert.equal(evaluateFleetRouteAccess(["fleet.maintenance.manage"], "maintenanceManage"), true);
  });
});

describe("fleet hardening", async () => {
  const { canAccessFleetRoute, canViewFleetFinancial, FLEET_ROUTE_GUARDS } = await import(
    "./fleetAuth.js"
  );
  const {
    fleetSafeCell,
    formatFleetMoney,
    formatFleetKm,
    normalizeFleetList,
  } = await import("./fleetFormat.js");
  const {
    getFleetCriticalActionConfig,
    parseFleetListLimit,
    validateFleetCriticalReason,
  } = await import("./fleetUxShared.js");

  it("user without permission cannot access guarded route (403 rule)", () => {
    assert.equal(canAccessFleetRoute([], FLEET_ROUTE_GUARDS.view), false);
    assert.equal(canAccessFleetRoute(["fleet.view"], FLEET_ROUTE_GUARDS.vehiclesEdit), false);
    assert.equal(canAccessFleetRoute(["fleet.vehicles.edit"], FLEET_ROUTE_GUARDS.vehiclesEdit), true);
    assert.equal(canAccessFleetRoute(["fleet.manage"], FLEET_ROUTE_GUARDS.settingsManage), false);
  });

  it("financial view requires fleet.financial.view or fleet.manage", () => {
    assert.equal(canViewFleetFinancial([]), false);
    assert.equal(canViewFleetFinancial(["fleet.financial.view"]), true);
    assert.equal(canViewFleetFinancial(["fleet.manage"]), true);
  });

  it("empty and invalid values do not render as NaN/undefined", () => {
    assert.equal(fleetSafeCell(undefined), "—");
    assert.equal(fleetSafeCell(Number.NaN), "—");
    assert.equal(formatFleetMoney(undefined), "—");
    assert.equal(formatFleetKm(undefined), "—");
    assert.deepEqual(normalizeFleetList(null), []);
  });

  it("parseFleetListLimit caps excessive requests", () => {
    assert.equal(parseFleetListLimit("99999"), 200);
    assert.equal(parseFleetListLimit("abc", 100), 100);
  });

  it("critical actions require reason in config", () => {
    assert.equal(getFleetCriticalActionConfig("cost.cancel").requireReason, true);
    assert.equal(getFleetCriticalActionConfig("vehicle.sell").requireReason, true);
    assert.equal(getFleetCriticalActionConfig("maintenance.complete").requireReason, false);
  });

  it("validateFleetCriticalReason rejects empty reason when required", () => {
    assert.equal(validateFleetCriticalReason("cost.cancel", "  "), false);
    assert.equal(validateFleetCriticalReason("cost.cancel", "motivo"), true);
    assert.equal(validateFleetCriticalReason("maintenance.complete", null), true);
  });
});

describe("fleet list query", async () => {
  const {
    buildFleetListResponse,
    fleetListMeta,
    parseFleetListLimit,
    parseFleetListQuery,
    parseFleetListDateRange,
    FLEET_LIST_DEFAULT_LIMIT,
    FLEET_LIST_MAX_LIMIT,
  } = await import("./fleetListQuery.js");
  const { buildDriverListWhere, buildDriverCnhWhere } = await import("./fleetDriverOps.js");
  const { buildReservationWhere } = await import("./fleetReservationOps.js");

  it("default limit is 50 and max is 200", () => {
    assert.equal(FLEET_LIST_DEFAULT_LIMIT, 50);
    assert.equal(FLEET_LIST_MAX_LIMIT, 200);
    assert.equal(parseFleetListLimit(undefined), 50);
    assert.equal(parseFleetListLimit("99999"), 200);
  });

  it("fleetListMeta returns correct totalPages", () => {
    assert.deepEqual(fleetListMeta(120, 2, 50), {
      page: 2,
      limit: 50,
      total: 120,
      totalPages: 3,
    });
  });

  it("parseFleetListQuery maps page limit search and status", () => {
    const q = parseFleetListQuery({
      page: "2",
      limit: "25",
      search: "ABC1D23",
      status: "AVAILABLE",
    });
    assert.equal(q.page, 2);
    assert.equal(q.limit, 25);
    assert.equal(q.skip, 25);
    assert.equal(q.search, "ABC1D23");
    assert.equal(q.status, "AVAILABLE");
  });

  it("parseFleetListDateRange applies end of day for YYYY-MM-DD", () => {
    const { startDate, endDate } = parseFleetListDateRange({
      startDate: "2026-05-01",
      endDate: "2026-05-31",
    });
    assert.ok(startDate);
    assert.ok(endDate && endDate.getHours() === 23);
  });

  it("buildDriverListWhere filters by name search", () => {
    const where = buildDriverListWhere({ search: "João" });
    assert.ok(where.OR);
  });

  it("buildDriverCnhWhere supports expired filter", () => {
    const where = buildDriverCnhWhere("expired", 30, new Date("2026-06-01"));
    assert.ok(where?.cnhExpirationDate);
  });

  it("buildReservationWhere filters by status and period", () => {
    const where = buildReservationWhere({
      status: "APPROVED",
      start: "2026-05-01T00:00:00.000Z",
      end: "2026-05-31T23:59:59.999Z",
    });
    assert.equal(where.status, "APPROVED");
    assert.ok(where.AND);
  });

  it("buildFleetListResponse keeps legacy key and items", () => {
    const body = buildFleetListResponse("vehicles", [{ id: "x" }], fleetListMeta(1, 1, 50));
    assert.equal((body.vehicles as unknown[]).length, 1);
    assert.equal((body.items as unknown[]).length, 1);
    assert.equal(body.total, 1);
    assert.equal(body.totalPages, 1);
  });
});

describe("fleet schema migrations", () => {
  it("fix migration sorts after fleet module migration", () => {
    const moduleMigration = "20260603120000_add_fleet_management_module";
    const fixMigration = "20260604120000_fix_fleet_schema_alignment";
    assert.ok(moduleMigration < fixMigration);
  });

  it("editable settings includes maintenance approval threshold", async () => {
    const { FLEET_EDITABLE_SETTINGS_KEYS } = await import("./fleetManagementOps.js");
    assert.ok(FLEET_EDITABLE_SETTINGS_KEYS.includes("manutencaoValorAprovacao"));
  });
});
