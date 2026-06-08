import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMaintenanceBlockLabel,
  resolveMaintenanceVehicleStatus,
  canShowMaintenanceCancelAction,
  formatMaintenanceCancelOutcome,
  assertReasonMinLength,
  buildMaintenanceCancelAuditEntry,
} from "./fleetValidation.js";
import { resolveOperationalStatusFromContext } from "./fleetVehicleStatusOps.js";
import { buildMaintenanceCancelUpdate } from "./fleetMaintenanceOps.js";

describe("fleet vehicle operational status", () => {
  it("cancel/complete last blocking maintenance releases vehicle to AVAILABLE", () => {
    const next = resolveOperationalStatusFromContext({
      currentStatus: "MAINTENANCE",
      blockers: [],
      hasApprovedReservation: false,
      hasManualAdminBlock: false,
    });
    assert.equal(next, "AVAILABLE");
  });

  it("another active blocking maintenance keeps vehicle in MAINTENANCE", () => {
    const next = resolveOperationalStatusFromContext({
      currentStatus: "MAINTENANCE",
      blockers: [
        { type: "maintenance", id: "m2", label: "Manutenção (OPEN): freios" },
      ],
      blockingMaintenancePriority: "MEDIA",
    });
    assert.equal(next, "MAINTENANCE");
  });

  it("active blocking incident keeps vehicle BLOCKED after maintenance complete", () => {
    const next = resolveOperationalStatusFromContext({
      currentStatus: "MAINTENANCE",
      blockers: [{ type: "incident", id: "i1", label: "Ocorrência (OPEN): avaria" }],
    });
    assert.equal(next, "BLOCKED");
  });

  it("open usage keeps vehicle IN_USE after maintenance complete", () => {
    const next = resolveOperationalStatusFromContext({
      currentStatus: "MAINTENANCE",
      blockers: [{ type: "usage", id: "u1", label: "Uso em aberto (sem devolução)" }],
    });
    assert.equal(next, "IN_USE");
  });

  it("high priority blocking maintenance maps to BLOCKED", () => {
    const next = resolveOperationalStatusFromContext({
      currentStatus: "AVAILABLE",
      blockers: [{ type: "maintenance", id: "m1", label: "Manutenção (IN_PROGRESS): motor" }],
      blockingMaintenancePriority: "ALTA",
    });
    assert.equal(next, "BLOCKED");
    assert.equal(resolveMaintenanceVehicleStatus("ALTA", true), "BLOCKED");
  });

  it("formatMaintenanceBlockLabel distinguishes active vs historical block", () => {
    assert.equal(formatMaintenanceBlockLabel(true, "IN_PROGRESS"), "Sim — ativo");
    assert.equal(formatMaintenanceBlockLabel(true, "COMPLETED"), "Era bloqueante");
    assert.equal(formatMaintenanceBlockLabel(true, "CANCELED"), "Era bloqueante");
    assert.equal(formatMaintenanceBlockLabel(false, "OPEN"), "Não");
  });

  it("completed maintenance with blocksVehicle is not an active blocker label", () => {
    const label = formatMaintenanceBlockLabel(true, "COMPLETED");
    assert.notEqual(label, "Sim — ativo");
    assert.equal(label, "Era bloqueante");
  });

  it("manual admin block keeps vehicle BLOCKED when no other blockers", () => {
    const next = resolveOperationalStatusFromContext({
      currentStatus: "MAINTENANCE",
      blockers: [{ type: "admin_block", id: "v1", label: "Bloqueio administrativo manual" }],
      hasManualAdminBlock: true,
    });
    assert.equal(next, "BLOCKED");
  });

  it("blocking maintenance takes precedence over approved reservation (INT-013/038)", () => {
    const next = resolveOperationalStatusFromContext({
      currentStatus: "AVAILABLE",
      blockers: [{ type: "maintenance", id: "m1", label: "Manutenção (OPEN): freios" }],
      blockingMaintenancePriority: "MEDIA",
      hasApprovedReservation: true,
    });
    assert.equal(next, "MAINTENANCE");
    assert.notEqual(next, "RESERVED");
  });

  it("after checkin with active blocking maintenance vehicle must not be AVAILABLE (INT-001)", () => {
    const next = resolveOperationalStatusFromContext({
      currentStatus: "IN_USE",
      blockers: [{ type: "maintenance", id: "m1", label: "Manutenção (IN_PROGRESS): motor" }],
      blockingMaintenancePriority: "ALTA",
    });
    assert.equal(next, "BLOCKED");
    assert.notEqual(next, "AVAILABLE");
  });
});

describe("fleet maintenance cancel validation", async () => {
  const { assertReasonRequired } = await import("./fleetValidation.js");
  const { assertMaintenanceEditable } = await import("./fleetValidation.js");

  it("cancel maintenance without reason throws", () => {
    assert.throws(() => assertReasonRequired("  ", "Motivo do cancelamento"));
  });

  it("cancel maintenance with short reason throws", () => {
    assert.throws(() => assertReasonMinLength("abc", 5, "Motivo do cancelamento"));
  });

  it("cancel button visibility follows maintenance status", () => {
    assert.equal(canShowMaintenanceCancelAction("OPEN"), true);
    assert.equal(canShowMaintenanceCancelAction("IN_PROGRESS"), true);
    assert.equal(canShowMaintenanceCancelAction("COMPLETED"), false);
    assert.equal(canShowMaintenanceCancelAction("CANCELED"), false);
  });

  it("open maintenance cancel update sets status CANCELED", () => {
    const openedAt = new Date("2026-01-01T10:00:00Z");
    const update = buildMaintenanceCancelUpdate(
      { status: "OPEN", notes: null, openedAt },
      { reason: "Serviço desnecessário", closedAt: "2026-06-05T12:00:00" }
    );
    assert.equal(update.status, "CANCELED");
    assert.ok(update.notes.includes("Serviço desnecessário"));
  });

  it("cancel outcome message when vehicle is released", () => {
    const msg = formatMaintenanceCancelOutcome({
      nextStatus: "AVAILABLE",
      changed: true,
      blockers: [],
    });
    assert.equal(msg, "Manutenção cancelada e veículo liberado.");
  });

  it("cancel outcome message when blockers remain", () => {
    const msg = formatMaintenanceCancelOutcome({
      nextStatus: "MAINTENANCE",
      changed: false,
      blockers: [{ label: "Manutenção (OPEN): freios" }],
    });
    assert.match(msg, /permanece bloqueado por: Manutenção \(OPEN\): freios/);
  });

  it("cancel maintenance audit entry uses CANCEL action", () => {
    const entry = buildMaintenanceCancelAuditEntry({
      entityId: "00000000-0000-4000-8000-000000000001",
      oldStatus: "OPEN",
      reason: "Erro de cadastro",
      userId: "user-1",
    });
    assert.equal(entry.action, "CANCEL");
    assert.equal(entry.newValue, "CANCELED");
    assert.equal(entry.entityType, "FleetMaintenance");
  });

  it("completed maintenance cannot be canceled again", () => {
    assert.throws(() => assertMaintenanceEditable("COMPLETED"));
    assert.throws(() => assertMaintenanceEditable("CANCELED"));
  });
});
