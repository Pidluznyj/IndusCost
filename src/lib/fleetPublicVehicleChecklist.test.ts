import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildVehicleChecklistPublicPath,
  buildVehicleChecklistPublicUrl,
  FLEET_VEHICLE_CHECKLIST_PATH,
} from "./fleetVehicleChecklistLink.js";
import {
  FLEET_VEHICLE_CHECKLIST_TEMPLATE,
  FLEET_VEHICLE_CHECKLIST_RESPONSIBILITY_TEXT,
  validateVehicleChecklistItems,
} from "./fleetVehicleChecklistTemplate.js";
import {
  CHECK_IN_WINDOW_BEFORE_MS,
  CHECK_OUT_WINDOW_AFTER_MS,
  deriveReservationChecklistState,
  generateVehicleChecklistToken,
  getReservationChecklistStatusLabel,
  resolveReservationChecklistMode,
} from "./fleetVehicleChecklistOps.js";
import { isValidCpf } from "./fleetCpfUtils.js";

describe("fleetVehicleChecklistLink", () => {
  it("builds public path and URL with configured base", () => {
    assert.equal(
      buildVehicleChecklistPublicPath("abc123"),
      `${FLEET_VEHICLE_CHECKLIST_PATH}/abc123`
    );
    assert.equal(
      buildVehicleChecklistPublicUrl("tok", "http://192.168.100.5:3000"),
      "http://192.168.100.5:3000/public/fleet/vehicle-checklist/tok"
    );
  });
});

describe("fleetVehicleChecklistTemplate", () => {
  it("has 17 fixed items", () => {
    assert.equal(FLEET_VEHICLE_CHECKLIST_TEMPLATE.length, 17);
  });

  it("ATENCAO and AVARIA require notes", () => {
    const items = FLEET_VEHICLE_CHECKLIST_TEMPLATE.map((t) => ({
      code: t.code,
      status: "ATENCAO" as const,
      notes: "",
    }));
    const r = validateVehicleChecklistItems(items);
    assert.equal(r.ok, false);
  });

  it("OK items pass without notes", () => {
    const items = FLEET_VEHICLE_CHECKLIST_TEMPLATE.map((t) => ({
      code: t.code,
      status: "OK" as const,
    }));
    assert.equal(validateVehicleChecklistItems(items).ok, true);
  });

  it("responsibility text is defined", () => {
    assert.ok(FLEET_VEHICLE_CHECKLIST_RESPONSIBILITY_TEXT.includes("Confirmo"));
  });
});

describe("fleetVehicleChecklist reservation mode", () => {
  const start = new Date(2026, 5, 10, 8, 0, 0);
  const end = new Date(2026, 5, 10, 12, 0, 0);

  it("APPROVED without check-in returns CHECK_IN inside window", () => {
    const now = new Date(2026, 5, 10, 7, 30, 0);
    const mode = resolveReservationChecklistMode(
      { status: "APPROVED", startDateTime: start, endDateTime: end },
      { hasCheckIn: false, hasCheckOut: false, checkInAt: null },
      now
    );
    assert.equal(mode, "CHECK_IN");
  });

  it("APPROVED too early is blocked", () => {
    const now = new Date(2026, 5, 10, 5, 0, 0);
    const mode = resolveReservationChecklistMode(
      { status: "APPROVED", startDateTime: start, endDateTime: end },
      { hasCheckIn: false, hasCheckOut: false, checkInAt: null },
      now
    );
    assert.equal(mode, null);
  });

  it("IN_USE with check-in returns CHECK_OUT within grace", () => {
    const now = new Date(2026, 5, 10, 13, 0, 0);
    const mode = resolveReservationChecklistMode(
      { status: "IN_USE", startDateTime: start, endDateTime: end },
      { hasCheckIn: true, hasCheckOut: false, checkInAt: start },
      now
    );
    assert.equal(mode, "CHECK_OUT");
  });

  it("duplicate check-in blocked when already has check-in", () => {
    const now = new Date(2026, 5, 10, 9, 0, 0);
    const mode = resolveReservationChecklistMode(
      { status: "IN_USE", startDateTime: start, endDateTime: end },
      { hasCheckIn: true, hasCheckOut: false, checkInAt: start },
      now
    );
    assert.equal(mode, "CHECK_OUT");
    assert.notEqual(mode, "CHECK_IN");
  });

  it("REJECTED reservation returns null mode", () => {
    const mode = resolveReservationChecklistMode(
      { status: "REJECTED", startDateTime: start, endDateTime: end },
      { hasCheckIn: false, hasCheckOut: false, checkInAt: null },
      start
    );
    assert.equal(mode, null);
  });

  it("window constants match business rules", () => {
    assert.equal(CHECK_IN_WINDOW_BEFORE_MS, 2 * 60 * 60 * 1000);
    assert.equal(CHECK_OUT_WINDOW_AFTER_MS, 24 * 60 * 60 * 1000);
  });
});

describe("fleetVehicleChecklist state labels", () => {
  it("labels cover QR checklist lifecycle", () => {
    assert.equal(
      getReservationChecklistStatusLabel({
        reservationStatus: "APPROVED",
        hasCheckIn: false,
        hasCheckOut: false,
        hasAutoCheckOut: false,
      }),
      "Aguardando check-in"
    );
    assert.equal(
      getReservationChecklistStatusLabel({
        reservationStatus: "IN_USE",
        hasCheckIn: true,
        hasCheckOut: false,
        hasAutoCheckOut: false,
      }),
      "Aguardando check-out"
    );
    assert.equal(
      getReservationChecklistStatusLabel({
        reservationStatus: "FINISHED",
        hasCheckIn: true,
        hasCheckOut: true,
        hasAutoCheckOut: true,
      }),
      "Check-out automático por novo check-in"
    );
  });

  it("deriveReservationChecklistState detects auto check-out", () => {
    const state = deriveReservationChecklistState([
      { type: "CHECK_IN" },
      { type: "AUTO_CHECK_OUT" },
    ]);
    assert.equal(state.hasCheckIn, true);
    assert.equal(state.hasCheckOut, true);
  });
});

describe("fleetVehicleChecklist token", () => {
  it("generates token with sufficient entropy", () => {
    const t = generateVehicleChecklistToken();
    assert.equal(t.length, 64);
  });
});

describe("fleetVehicleChecklist CPF validation", () => {
  it("valid CPF passes", () => {
    assert.equal(isValidCpf("111.444.777-35"), true);
  });
  it("invalid CPF fails", () => {
    assert.equal(isValidCpf("000.000.000-00"), false);
  });
});

describe("fleetVehicleChecklist wiring", () => {
  it("registers public routes and page", () => {
    const serverSrc = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const appSrc = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    assert.ok(serverSrc.includes("registerFleetPublicVehicleChecklistRoutes"));
    assert.ok(appSrc.includes("/public/fleet/vehicle-checklist/:vehicleToken"));
    assert.ok(appSrc.includes("FleetPublicVehicleChecklistPage"));
  });

  it("registers internal checklist-token routes", () => {
    const fleetRoutes = readFileSync(join(process.cwd(), "src", "lib", "fleetRoutes.ts"), "utf8");
    const internalRoutes = readFileSync(
      join(process.cwd(), "src", "lib", "fleetVehicleChecklistInternalRoutes.ts"),
      "utf8"
    );
    assert.ok(fleetRoutes.includes("registerFleetVehicleChecklistInternalRoutes"));
    assert.ok(internalRoutes.includes("checklist-token"));
  });

  it("service implements AUTO_CHECK_OUT and PUBLIC_QR source", () => {
    const svc = readFileSync(
      join(process.cwd(), "src", "lib", "fleetPublicVehicleChecklistService.ts"),
      "utf8"
    );
    assert.ok(svc.includes("AUTO_CHECK_OUT"));
    assert.ok(svc.includes("AUTO_FROM_NEXT_CHECKIN"));
    assert.ok(svc.includes("PUBLIC_QR"));
    assert.ok(svc.includes("PRESUMED_CHECK_OUT"));
    assert.ok(svc.includes("Devolução presumida"));
  });

  it("schema has FleetReservationChecklist models", () => {
    const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    assert.ok(schema.includes("model FleetVehicleChecklistToken"));
    assert.ok(schema.includes("model FleetReservationChecklist"));
    assert.ok(schema.includes("model FleetReservationChecklistItem"));
    assert.ok(schema.includes("AUTO_CHECK_OUT"));
  });

  it("UI has vehicle QR panel", () => {
    const panel = readFileSync(
      join(process.cwd(), "src", "components", "fleet", "FleetVehicleChecklistQrPanel.tsx"),
      "utf8"
    );
    assert.ok(panel.includes("qrcode.react"));
    assert.ok(panel.includes("checklist-token/regenerate"));
  });

  it("reservation tab loads checklist summaries", () => {
    const tab = readFileSync(
      join(process.cwd(), "src", "components", "fleet", "FleetReservationsTab.tsx"),
      "utf8"
    );
    assert.ok(tab.includes("/checklists"));
    assert.ok(tab.includes("checklistSummaries"));
  });
});
