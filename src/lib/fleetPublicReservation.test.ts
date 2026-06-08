import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFleetPublicReservationSlots,
  buildPublicDateRange,
  combineDateAndTimeLocal,
  FLEET_PUBLIC_DEFAULT_SLOTS,
  filterPastSlotsForToday,
  formatWeekdayDateLabel,
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
  serializePublicVehicle,
} from "./fleetPublicReservationService.js";
import {
  formatCpfMask,
  isValidCpf,
  maskCpfForDisplay,
  normalizeCpfDigits,
} from "./fleetCpfUtils.js";
import {
  driverHasCnhRegistered,
  driverNeedsCnhData,
  publicCnhStatusLabel,
} from "./fleetPublicReservationDriverOps.js";

describe("fleetCpfUtils", () => {
  it("validates valid and invalid CPF", () => {
    assert.equal(isValidCpf("111.444.777-35"), true);
    assert.equal(isValidCpf("000.000.000-00"), false);
    assert.equal(isValidCpf("123"), false);
    assert.equal(isValidCpf("111.111.111-11"), false);
  });

  it("normalizes and masks CPF", () => {
    assert.equal(normalizeCpfDigits("111.444.777-35"), "11144477735");
    assert.equal(formatCpfMask("11144477735"), "111.444.777-35");
    assert.equal(maskCpfForDisplay("11144477735"), "***.***.***-35");
  });
});

describe("fleetPublicReservation driver CNH helpers", () => {
  it("detects CNH registered vs needed", () => {
    assert.equal(driverHasCnhRegistered({ cnhNumber: "123" }), true);
    assert.equal(driverHasCnhRegistered({ cnhNumber: null }), false);
    assert.equal(driverNeedsCnhData({ cnhNumber: null }), true);
    assert.equal(driverNeedsCnhData({ cnhNumber: "999" }), false);
  });

  it("publicCnhStatusLabel returns safe labels", () => {
    assert.equal(publicCnhStatusLabel({ cnhNumber: null, cnhExpirationDate: null }), "pendente");
    assert.equal(
      publicCnhStatusLabel({ cnhNumber: "1", cnhExpirationDate: new Date("2099-01-01") }),
      "cadastrada"
    );
    assert.equal(
      publicCnhStatusLabel({ cnhNumber: "1", cnhExpirationDate: new Date("2000-01-01") }),
      "vencida"
    );
  });
});

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

  it("does not generate slot after 20:00", () => {
    const slots = buildFleetPublicReservationSlots({
      startHour: 6,
      endHour: 20,
      slotMinutes: 180,
    });
    assert.equal(
      slots.find((s) => s.end === "21:00"),
      undefined
    );
  });

  it("filters past slots on current date", () => {
    const dateStr = "2026-06-10";
    const now = combineDateAndTimeLocal(dateStr, "14:30");
    const filtered = filterPastSlotsForToday(FLEET_PUBLIC_DEFAULT_SLOTS, dateStr, now);
    assert.ok(!filtered.some((s) => s.end === "09:00"));
    assert.ok(filtered.some((s) => s.start === "17:00"));
  });

  it("builds date range for week availability", () => {
    const dates = buildPublicDateRange("2026-06-10", 7);
    assert.equal(dates.length, 7);
    assert.equal(dates[0], "2026-06-10");
    assert.equal(dates[6], "2026-06-16");
    assert.match(formatWeekdayDateLabel("2026-06-10"), /10\/06/);
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

  it("findReservationConflict detects overlapping reservation per vehicle period", () => {
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
  });

  it("formatPublicVehicleLabel and serialize omit plate", () => {
    const label = formatPublicVehicleLabel({
      brand: "Toyota",
      model: "Corolla",
      vehicleType: "Sedan",
    });
    assert.equal(label, "Toyota Corolla (Sedan)");
    const serialized = serializePublicVehicle({
      id: "v1",
      brand: "Toyota",
      model: "Corolla",
      vehicleType: "Sedan",
      notes: "Carro SP",
    });
    assert.equal(serialized.label, label);
    assert.equal(serialized.nickname, "Carro SP");
    assert.ok(!("plate" in serialized));
  });
});

describe("fleetPublicReservation permissions catalog", () => {
  it("editable settings include public reservation keys", async () => {
    const { FLEET_EDITABLE_SETTINGS_KEYS } = await import("./fleetManagementOps.js");
    assert.ok(FLEET_EDITABLE_SETTINGS_KEYS.includes("publicReservationEnabled"));
    assert.ok(FLEET_EDITABLE_SETTINGS_KEYS.includes("publicReservationToken"));
  });
});
