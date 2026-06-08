import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFleetPublicReservationSlots,
  combineDateAndTimeLocal,
  FLEET_PUBLIC_DEFAULT_SLOTS,
  filterPastSlotsForToday,
  parseFleetPublicSlotConfig,
} from "./fleetPublicReservationSlots.js";
import {
  findReservationConflict,
  reservationPeriodsOverlap,
} from "./fleetValidation.js";
import {
  buildPublicReservationUrl,
  formatPublicVehicleLabel,
  generatePublicReservationToken,
} from "./fleetPublicReservationService.js";

describe("fleetPublicReservationSlots", () => {
  it("default slots cover 06:00–20:00 in 3h blocks including 17:00–20:00", () => {
    const slots = buildFleetPublicReservationSlots({
      startHour: 6,
      endHour: 20,
      slotMinutes: 180,
    });
    assert.deepEqual(
      slots.map((s) => s.key),
      FLEET_PUBLIC_DEFAULT_SLOTS.map((s) => s.key)
    );
    assert.ok(slots.some((s) => s.start === "17:00" && s.end === "20:00"));
    assert.ok(!slots.some((s) => s.start === "18:00" && s.end === "21:00"));
  });

  it("does not generate 18:00–21:00 slot", () => {
    const slots = buildFleetPublicReservationSlots({
      startHour: 6,
      endHour: 20,
      slotMinutes: 180,
    });
    const bad = slots.find((s) => s.end === "21:00");
    assert.equal(bad, undefined);
  });

  it("filters past slots on current date", () => {
    const dateStr = "2026-06-10";
    const now = combineDateAndTimeLocal(dateStr, "14:30");
    const filtered = filterPastSlotsForToday(FLEET_PUBLIC_DEFAULT_SLOTS, dateStr, now);
    assert.ok(!filtered.some((s) => s.end === "09:00"));
    assert.ok(!filtered.some((s) => s.end === "12:00"));
    assert.ok(filtered.some((s) => s.start === "15:00"));
    assert.ok(filtered.some((s) => s.start === "17:00"));
  });

  it("keeps all slots for future dates", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
    const filtered = filterPastSlotsForToday(FLEET_PUBLIC_DEFAULT_SLOTS, dateStr, new Date());
    assert.equal(filtered.length, FLEET_PUBLIC_DEFAULT_SLOTS.length);
  });

  it("parses slot config from settings", () => {
    const cfg = parseFleetPublicSlotConfig({
      publicReservationStartHour: "6",
      publicReservationEndHour: "20",
      publicReservationSlotMinutes: "180",
    });
    assert.equal(cfg.startHour, 6);
    assert.equal(cfg.endHour, 20);
    assert.equal(cfg.slotMinutes, 180);
  });
});

describe("fleetPublicReservation conflict", () => {
  it("reservationPeriodsOverlap matches active booking rule", () => {
    const existingStart = new Date(2026, 5, 10, 9, 0);
    const existingEnd = new Date(2026, 5, 10, 12, 0);
    const reqStart = new Date(2026, 5, 10, 11, 0);
    const reqEnd = new Date(2026, 5, 10, 14, 0);
    assert.equal(
      reservationPeriodsOverlap(existingStart, existingEnd, reqStart, reqEnd),
      true
    );
    const afterStart = new Date(2026, 5, 10, 12, 0);
    const afterEnd = new Date(2026, 5, 10, 15, 0);
    assert.equal(
      reservationPeriodsOverlap(existingStart, existingEnd, afterStart, afterEnd),
      false
    );
  });

  it("findReservationConflict detects overlapping reservation", () => {
    const start = combineDateAndTimeLocal("2026-06-10", "08:00");
    const end = combineDateAndTimeLocal("2026-06-10", "11:00");
    const existing = [
      {
        id: "r1",
        startDateTime: combineDateAndTimeLocal("2026-06-10", "09:00"),
        endDateTime: combineDateAndTimeLocal("2026-06-10", "12:00"),
      },
    ];
    assert.equal(findReservationConflict(existing, start, end)?.id, "r1");
  });
});

describe("fleetPublicReservation security helpers", () => {
  it("generatePublicReservationToken is long hex", () => {
    const t = generatePublicReservationToken();
    assert.equal(t.length, 64);
    assert.match(t, /^[0-9a-f]+$/);
  });

  it("buildPublicReservationUrl hides sequential ids", () => {
    const url = buildPublicReservationUrl("abc123token", "https://erp.example.com");
    assert.equal(url, "https://erp.example.com/public/fleet/reservation/abc123token");
    assert.ok(!url.includes("/1"));
  });

  it("formatPublicVehicleLabel omits plate", () => {
    const label = formatPublicVehicleLabel({
      brand: "Toyota",
      model: "Corolla",
      vehicleType: "Sedan",
    });
    assert.equal(label, "Toyota Corolla (Sedan)");
    assert.ok(!label.includes("ABC"));
  });
});

describe("fleetPublicReservation permissions catalog", () => {
  it("editable settings include public reservation keys", async () => {
    const { FLEET_EDITABLE_SETTINGS_KEYS } = await import("./fleetManagementOps.js");
    assert.ok(FLEET_EDITABLE_SETTINGS_KEYS.includes("publicReservationEnabled"));
    assert.ok(FLEET_EDITABLE_SETTINGS_KEYS.includes("publicReservationToken"));
  });
});
