import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMaintenanceBlockLabel,
  resolveMaintenanceVehicleStatus,
} from "./fleetValidation.js";
import { resolveOperationalStatusFromContext } from "./fleetVehicleStatusOps.js";

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
});

describe("fleet maintenance cancel validation", async () => {
  const { assertReasonRequired } = await import("./fleetValidation.js");
  const { assertMaintenanceEditable } = await import("./fleetValidation.js");

  it("cancel maintenance without reason throws", () => {
    assert.throws(() => assertReasonRequired("  ", "Motivo do cancelamento"));
  });

  it("completed maintenance cannot be canceled again", () => {
    assert.throws(() => assertMaintenanceEditable("COMPLETED"));
    assert.throws(() => assertMaintenanceEditable("CANCELED"));
  });
});
