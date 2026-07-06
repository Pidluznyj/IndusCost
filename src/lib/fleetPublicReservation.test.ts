import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildFleetPublicReservationSlots,
  buildFleetReservationLocalDateTime,
  buildPublicDateRange,
  combineDateAndTimeLocal,
  dateOnlyToYmd,
  FLEET_PUBLIC_DEFAULT_SLOTS,
  filterPastSlotsForToday,
  formatFleetLocalDate,
  formatWeekdayDateLabel,
  parseFleetPublicSlotConfig,
  parseLocalDateOnly,
} from "./fleetPublicReservationSlots.js";
import {
  areSlotsContiguous,
  consolidateSelectedSlots,
  formatConsolidatedPeriodLabel,
  FLEET_PUBLIC_SLOT_SELECTION_GAP_MESSAGE,
  resolveSlotsForConsolidatedPeriod,
  selectSlotsByKeys,
} from "./fleetPublicSlotSelection.js";
import {
  findReservationConflict,
  reservationPeriodsOverlap,
} from "./fleetValidation.js";
import {
  formatPublicVehicleLabel,
  generatePublicReservationToken,
  isPublicReservationVehicleEligible,
  serializePublicRequestItem,
  serializePublicVehicle,
} from "./fleetPublicReservationService.js";
import { FLEET_NON_RESERVABLE_VEHICLE_STATUSES } from "./fleetValidation.js";
import {
  buildPublicReservationLinkApiUrl,
  buildPublicReservationShareLinks,
  buildPublicReservationShortUrl,
  buildPublicReservationUrl,
  FLEET_PUBLIC_RESERVATION_INITIAL_STEP,
  FLEET_PUBLIC_RESERVATION_PATH,
  FLEET_PUBLIC_RESERVATION_RESERVED_SLUGS,
  isLocalhostOrigin,
  normalizePublicReservationBaseUrl,
  publicReservationPathMatchesSlug,
  resolvePublicReservationBaseUrl,
  validatePublicReservationSlug,
} from "./fleetPublicReservationLink.js";
import {
  formatCpfMask,
  isValidCpf,
  maskCpfForDisplay,
  normalizeCpfDigits,
} from "./fleetCpfUtils.js";
import {
  driverHasCnhRegistered,
  driverNeedsCnhData,
  driverNeedsPublicApproval,
  driverPublicApprovalStatus,
  publicCnhStatusLabel,
  publicRequestAwaitingDriverApproval,
  publicRequestAwaitingReservationApproval,
  resolveInitialPublicRequestStatus,
} from "./fleetPublicReservationDriverOps.js";
import {
  FLEET_PUBLIC_ACTIVE_REQUEST_STATUSES,
  FLEET_PUBLIC_PENDING_REVIEW_STATUSES,
  serializePublicRequestDriver,
} from "./fleetPublicReservationService.js";
import {
  APPROVAL_ACTION_LABELS,
  APPROVAL_STAGE_LABELS,
  buildApprovalHistorySummary,
  buildPublicReservationHistoryDetails,
  recordFleetPublicReservationApprovalHistory,
  serializeApprovalHistoryEntry,
} from "./fleetPublicReservationApprovalHistory.js";
import { assertReasonRequired } from "./fleetValidation.js";

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

describe("fleetPublicReservation local date handling", () => {
  it("parseLocalDateOnly + dateOnlyToYmd preserves 2026-06-08 (no day shift)", () => {
    const stored = parseLocalDateOnly("2026-06-08")!;
    assert.equal(dateOnlyToYmd(stored), "2026-06-08");
    assert.equal(formatFleetLocalDate(stored), "08/06/2026");
    assert.equal(formatFleetLocalDate("2026-06-08"), "08/06/2026");
  });

  it("simulates Brazil offset: UTC midnight DATE must not display as 07/06", () => {
    const fromDb = new Date("2026-06-08T00:00:00.000Z");
    const wrongLocal = fromDb.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    assert.equal(wrongLocal, "07/06/2026");
    assert.equal(formatFleetLocalDate(fromDb), "08/06/2026");
    assert.equal(dateOnlyToYmd(fromDb), "2026-06-08");
  });

  it("buildFleetReservationLocalDateTime keeps local wall clock for slot", () => {
    const start = buildFleetReservationLocalDateTime("2026-06-08", "09:00");
    const end = buildFleetReservationLocalDateTime("2026-06-08", "12:00");
    assert.equal(start.getFullYear(), 2026);
    assert.equal(start.getMonth(), 5);
    assert.equal(start.getDate(), 8);
    assert.equal(start.getHours(), 9);
    assert.equal(end.getHours(), 12);
  });

  it("buildPublicDateRange preserves calendar days without UTC drift", () => {
    const dates = buildPublicDateRange("2026-06-08", 3);
    assert.deepEqual(dates, ["2026-06-08", "2026-06-09", "2026-06-10"]);
    assert.match(formatWeekdayDateLabel("2026-06-08"), /08\/06/);
  });

  it("serializePublicRequestItem exposes YMD string and label for internal API", () => {
    const item = serializePublicRequestItem({
      id: "r1",
      requestedDate: parseLocalDateOnly("2026-06-08")!,
      startTime: "09:00",
      endTime: "12:00",
    } as Parameters<typeof serializePublicRequestItem>[0]);
    assert.equal(item.requestedDate, "2026-06-08");
    assert.equal(item.requestedDateLabel, "08/06/2026");
  });
});

describe("fleetPublicReservation public vehicle eligibility", () => {
  it("AVAILABLE IN_USE and RESERVED are eligible in public flow (period-based booking)", () => {
    assert.equal(isPublicReservationVehicleEligible("AVAILABLE"), true);
    assert.equal(isPublicReservationVehicleEligible("IN_USE"), true);
    assert.equal(isPublicReservationVehicleEligible("RESERVED"), true);
  });

  it("BLOCKED INACTIVE MAINTENANCE SOLD RETURNED CLAIMED are not eligible publicly", () => {
    for (const status of [
      "BLOCKED",
      "INACTIVE",
      "MAINTENANCE",
      "SOLD",
      "RETURNED",
      "CLAIMED",
    ] as const) {
      assert.equal(isPublicReservationVehicleEligible(status), false, status);
    }
  });

  it("public vehicles endpoint lists non-hard-blocked vehicles", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes("FLEET_PUBLIC_HARD_BLOCKED_VEHICLE_STATUSES"));
    assert.ok(src.includes("assertPublicReservationVehicleOrThrow"));
    assert.ok(src.includes("FLEET_VEHICLE_NOT_ELIGIBLE"));
  });

  it("serializePublicVehicle still omits plate", () => {
    const serialized = serializePublicVehicle({
      id: "v1",
      brand: "Fiat",
      model: "Uno",
      vehicleType: "Hatch",
      notes: null,
    });
    assert.ok(!("plate" in serialized));
  });
});

describe("fleetPublicReservation two-step driver approval", () => {
  const authorizedDriver = {
    status: "AUTHORIZED" as const,
    cnhNumber: "123456",
    cnhExpirationDate: new Date("2099-06-01"),
    createdFromPublicReservation: false,
    publicRegistrationRejectionReason: null,
  };

  const pendingPublicDriver = {
    status: "PENDING" as const,
    cnhNumber: "123456",
    cnhExpirationDate: new Date("2099-06-01"),
    createdFromPublicReservation: true,
    publicRegistrationRejectionReason: null,
  };

  it("authorized driver with valid CNH goes straight to reservation approval", () => {
    assert.equal(driverNeedsPublicApproval(authorizedDriver), false);
    assert.equal(resolveInitialPublicRequestStatus(authorizedDriver), "PENDING_RESERVATION_APPROVAL");
    assert.equal(driverPublicApprovalStatus(authorizedDriver), "APPROVED");
  });

  it("new public driver starts PENDING_REVIEW and request PENDING_DRIVER_APPROVAL", () => {
    assert.equal(driverNeedsPublicApproval(pendingPublicDriver), true);
    assert.equal(resolveInitialPublicRequestStatus(pendingPublicDriver), "PENDING_DRIVER_APPROVAL");
    assert.equal(driverPublicApprovalStatus(pendingPublicDriver), "PENDING_REVIEW");
  });

  it("existing drivers default (not from public) with AUTHORIZED are not blocked", () => {
    const legacy = { ...authorizedDriver, createdFromPublicReservation: false };
    assert.equal(driverNeedsPublicApproval(legacy), false);
    assert.equal(driverPublicApprovalStatus(legacy), "APPROVED");
  });

  it("driver with expired CNH needs approval", () => {
    const expired = {
      ...authorizedDriver,
      cnhExpirationDate: new Date("2000-01-01"),
    };
    assert.equal(driverNeedsPublicApproval(expired), true);
    assert.equal(resolveInitialPublicRequestStatus(expired), "PENDING_DRIVER_APPROVAL");
  });

  it("public request status helpers distinguish driver vs reservation stages", () => {
    assert.equal(publicRequestAwaitingDriverApproval("PENDING_DRIVER_APPROVAL"), true);
    assert.equal(publicRequestAwaitingDriverApproval("PENDING_RESERVATION_APPROVAL"), false);
    assert.equal(publicRequestAwaitingReservationApproval("PENDING_RESERVATION_APPROVAL"), true);
    assert.equal(publicRequestAwaitingReservationApproval("PENDING"), true);
  });

  it("active request statuses include both approval stages", () => {
    assert.ok(FLEET_PUBLIC_ACTIVE_REQUEST_STATUSES.includes("PENDING_DRIVER_APPROVAL"));
    assert.ok(FLEET_PUBLIC_ACTIVE_REQUEST_STATUSES.includes("PENDING_RESERVATION_APPROVAL"));
    assert.equal(FLEET_PUBLIC_PENDING_REVIEW_STATUSES.length, 3);
  });

  it("serializePublicRequestDriver returns approval fields without NaN/undefined", () => {
    const serialized = serializePublicRequestDriver({
      id: "d1",
      name: "João",
      cpf: "11144477735",
      cnhNumber: "99",
      cnhCategory: "B",
      cnhExpirationDate: new Date("2099-01-01"),
      status: "PENDING",
      createdFromPublicReservation: true,
      publicRegistrationRejectionReason: null,
    });
    assert.equal(serialized?.approvalStatus, "PENDING_REVIEW");
    assert.equal(serialized?.needsPublicApproval, true);
    assert.equal(String(serialized?.name), "João");
    assert.ok(!String(serialized?.approvalStatus).includes("undefined"));
    assert.ok(!String(serialized?.approvalStatus).includes("NaN"));
  });

  it("internal routes expose approve-driver and reject-driver POST endpoints", () => {
    const routesPath = join(process.cwd(), "src", "lib", "fleetPublicReservationInternalRoutes.ts");
    const src = readFileSync(routesPath, "utf8");
    assert.ok(src.includes("/approve-driver"));
    assert.ok(src.includes("/reject-driver"));
    assert.ok(src.includes("g.reservationsApprove"));
  });

  it("approve reservation route blocks driver-pending with business error message", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes("Aprove o cadastro do motorista antes de aprovar a reserva."));
    assert.ok(src.includes("FLEET_DRIVER_APPROVAL_REQUIRED"));
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
  it("default slots cover 06:00–20:00 in 1h blocks ending at 19:00–20:00", () => {
    const slots = buildFleetPublicReservationSlots({
      startHour: 6,
      endHour: 20,
      slotMinutes: 60,
    });
    assert.deepEqual(
      slots.map((s) => s.key),
      FLEET_PUBLIC_DEFAULT_SLOTS.map((s) => s.key)
    );
    assert.equal(slots.length, 14);
    assert.ok(slots.some((s) => s.start === "06:00" && s.end === "07:00"));
    assert.ok(slots.some((s) => s.start === "19:00" && s.end === "20:00"));
    assert.ok(!slots.some((s) => s.end === "21:00"));
  });

  it("does not generate slot after 20:00", () => {
    const slots = buildFleetPublicReservationSlots({
      startHour: 6,
      endHour: 20,
      slotMinutes: 60,
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
    assert.ok(filtered.some((s) => s.start === "15:00"));
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
      publicReservationSlotMinutes: "60",
    });
    assert.equal(cfg.startHour, 6);
    assert.equal(cfg.endHour, 20);
    assert.equal(cfg.slotMinutes, 60);
  });
});

describe("fleetPublicSlotSelection multi-slot", () => {
  const allSlots = FLEET_PUBLIC_DEFAULT_SLOTS;

  it("single slot selection keeps start/end unchanged", () => {
    const consolidated = consolidateSelectedSlots([allSlots[0]!]);
    assert.ok(consolidated);
    assert.equal(consolidated.startTime, "06:00");
    assert.equal(consolidated.endTime, "07:00");
    assert.equal(
      resolveSlotsForConsolidatedPeriod(allSlots, consolidated.startTime, consolidated.endTime)?.length,
      1
    );
  });

  it("contiguous slots consolidate to first start and last end", () => {
    const selected = selectSlotsByKeys(allSlots, ["06:00-07:00", "07:00-08:00", "08:00-09:00"]);
    const consolidated = consolidateSelectedSlots(selected);
    assert.ok(consolidated);
    assert.equal(consolidated.startTime, "06:00");
    assert.equal(consolidated.endTime, "09:00");
    assert.deepEqual(
      resolveSlotsForConsolidatedPeriod(allSlots, "06:00", "09:00")?.map((s) => s.key),
      ["06:00-07:00", "07:00-08:00", "08:00-09:00"]
    );
  });

  it("adjacent 1h slots consolidate correctly (15:00–16:00 + 16:00–17:00)", () => {
    const selected = selectSlotsByKeys(allSlots, ["15:00-16:00", "16:00-17:00"]);
    const consolidated = consolidateSelectedSlots(selected);
    assert.ok(consolidated);
    assert.equal(consolidated.startTime, "15:00");
    assert.equal(consolidated.endTime, "17:00");
  });

  it("all day slots consolidate to 06:00–20:00 with full-day label", () => {
    const consolidated = consolidateSelectedSlots(allSlots);
    assert.ok(consolidated);
    assert.equal(consolidated.startTime, "06:00");
    assert.equal(consolidated.endTime, "20:00");
    assert.equal(
      formatConsolidatedPeriodLabel(consolidated, allSlots),
      "Dia todo — 06:00 às 20:00"
    );
    assert.deepEqual(
      resolveSlotsForConsolidatedPeriod(allSlots, "06:00", "20:00")?.map((s) => s.key),
      allSlots.map((s) => s.key)
    );
  });

  it("non-contiguous slots are rejected", () => {
    const selected = selectSlotsByKeys(allSlots, ["06:00-07:00", "15:00-16:00"]);
    assert.equal(consolidateSelectedSlots(selected), null);
    assert.equal(areSlotsContiguous(selected), false);
    assert.equal(FLEET_PUBLIC_SLOT_SELECTION_GAP_MESSAGE.length > 10, true);
  });

  it("consolidated interval conflicts when any part overlaps existing booking", () => {
    const consolidatedStart = combineDateAndTimeLocal("2026-06-10", "06:00");
    const consolidatedEnd = combineDateAndTimeLocal("2026-06-10", "20:00");
    const morningBlockedStart = combineDateAndTimeLocal("2026-06-10", "09:00");
    const morningBlockedEnd = combineDateAndTimeLocal("2026-06-10", "12:00");
    assert.equal(
      reservationPeriodsOverlap(
        consolidatedStart,
        consolidatedEnd,
        morningBlockedStart,
        morningBlockedEnd
      ),
      true
    );
    const afternoonBlockedStart = combineDateAndTimeLocal("2026-06-10", "12:00");
    const afternoonBlockedEnd = combineDateAndTimeLocal("2026-06-10", "15:00");
    assert.equal(
      reservationPeriodsOverlap(
        consolidatedStart,
        consolidatedEnd,
        afternoonBlockedStart,
        afternoonBlockedEnd
      ),
      true
    );
    const outsideStart = combineDateAndTimeLocal("2026-06-10", "20:00");
    const outsideEnd = combineDateAndTimeLocal("2026-06-10", "23:00");
    assert.equal(
      reservationPeriodsOverlap(consolidatedStart, consolidatedEnd, outsideStart, outsideEnd),
      false
    );
  });

  it("consolidated period preserves local date on save (no day shift)", () => {
    const dateStr = "2026-06-08";
    const startDt = buildFleetReservationLocalDateTime(dateStr, "06:00");
    const endDt = buildFleetReservationLocalDateTime(dateStr, "20:00");
    assert.equal(startDt.getFullYear(), 2026);
    assert.equal(startDt.getMonth(), 5);
    assert.equal(startDt.getDate(), 8);
    assert.equal(endDt.getHours(), 20);
    const stored = parseLocalDateOnly(dateStr)!;
    assert.equal(dateOnlyToYmd(stored), dateStr);
  });

  it("createPublicReservationRequest validates consolidated period via resolveSlotsForConsolidatedPeriod", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes("resolveSlotsForConsolidatedPeriod"));
    assert.ok(src.includes("Um ou mais períodos selecionados não estão mais disponíveis"));
  });

  it("public page supports multi-slot selection state", () => {
    const pagePath = join(
      process.cwd(),
      "src",
      "components",
      "fleet",
      "FleetPublicReservationPage.tsx"
    );
    const src = readFileSync(pagePath, "utf8");
    assert.ok(src.includes("selectedSlotKeys"));
    assert.ok(src.includes("FLEET_PUBLIC_SLOT_SELECTION_GAP_MESSAGE"));
    assert.ok(src.includes("Intervalo"));
  });

  it("internal approval tab shows consolidated startTime–endTime interval", () => {
    const tabPath = join(
      process.cwd(),
      "src",
      "components",
      "fleet",
      "FleetPublicReservationRequestsTab.tsx"
    );
    const src = readFileSync(tabPath, "utf8");
    assert.ok(src.includes("{row.startTime}–{row.endTime}"));
    assert.ok(src.includes("{detail.startTime}–"));
  });
});

describe("fleetPublicReservation requests list filter", () => {
  it("list supports pending filter for all review statuses", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes('statusFilter === "pending"'));
    assert.ok(src.includes("FLEET_PUBLIC_PENDING_REVIEW_STATUSES"));

    const tabPath = join(
      process.cwd(),
      "src",
      "components",
      "fleet",
      "FleetPublicReservationRequestsTab.tsx"
    );
    const tabSrc = readFileSync(tabPath, "utf8");
    assert.ok(tabSrc.includes('useState("pending")'));
    assert.ok(tabSrc.includes('value="pending"'));
  });
});

describe("fleetPublicReservation period-based availability", () => {
  it("public approval uses validatePublicReservationPeriod not vehicle current status", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes("validatePublicReservationPeriod"));
    assert.ok(src.includes("assertPublicReservationVehicleAllowed"));
    assert.equal(src.includes("validateReservationFull"), false);
  });

  it("assertNoReservationOverlap queries by period intersection", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes("startDateTime: { lt: end }"));
    assert.ok(src.includes("endDateTime: { gt: start }"));
  });
});

describe("fleetPublicReservation expired reservation release", () => {
  it("recalculate ignores APPROVED reservations past endDateTime", () => {
    const opsPath = join(process.cwd(), "src", "lib", "fleetVehicleStatusOps.ts");
    const src = readFileSync(opsPath, "utf8");
    assert.ok(src.includes('status: "APPROVED", endDateTime: { gt: now }'));
  });

  it("buildActiveReservationWhere excludes ended APPROVED from conflicts", async () => {
    const { buildActiveReservationWhere } = await import("./fleetValidation.js");
    const where = buildActiveReservationWhere("vehicle-1");
    assert.ok(where.OR);
    const orList = where.OR as Array<Record<string, unknown>>;
    const approvedBranch = orList.find((b) => b.status && typeof b.status === "object");
    assert.ok(approvedBranch);
    assert.ok((approvedBranch as { endDateTime?: { gt: Date } }).endDateTime?.gt instanceof Date);
  });

  it("public approval validates requested period not current vehicle status", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes("validatePublicReservationPeriod"));
  });
});

describe("fleetPublicReservation schedule overlap", () => {
  it("adjacent slots 12:00-15:00 and 15:00-18:00 do not overlap (half-open interval)", () => {
    const aStart = combineDateAndTimeLocal("2026-06-08", "12:00");
    const aEnd = combineDateAndTimeLocal("2026-06-08", "15:00");
    const bStart = combineDateAndTimeLocal("2026-06-08", "15:00");
    const bEnd = combineDateAndTimeLocal("2026-06-08", "18:00");
    assert.equal(reservationPeriodsOverlap(aStart, aEnd, bStart, bEnd), false);
  });

  it("overlapping slots 12:00-15:00 and 14:00-17:00 conflict", () => {
    const aStart = combineDateAndTimeLocal("2026-06-08", "12:00");
    const aEnd = combineDateAndTimeLocal("2026-06-08", "15:00");
    const bStart = combineDateAndTimeLocal("2026-06-08", "14:00");
    const bEnd = combineDateAndTimeLocal("2026-06-08", "17:00");
    assert.equal(reservationPeriodsOverlap(aStart, aEnd, bStart, bEnd), true);
  });

  it("approve excludes current request from pending conflict check", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes("excludeRequestId: existing.id"));
    assert.ok(src.includes("options?: { excludeRequestId?: string"));
  });

  it("approve locks vehicle to the one requested in public flow", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes("Aprove somente o veículo solicitado na reserva pública."));
    assert.ok(src.includes("const vehicleId = requestedVehicleId"));

    const tabPath = join(
      process.cwd(),
      "src",
      "components",
      "fleet",
      "FleetPublicReservationRequestsTab.tsx"
    );
    const tabSrc = readFileSync(tabPath, "utf8");
    assert.ok(tabSrc.includes("Veículo solicitado"));
    assert.equal(tabSrc.includes("/api/fleet/vehicles?limit=200"), false);
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

describe("fleetPublicReservation short link public access", () => {
  it("/public/fleet/reservation/:token is registered before RequireAuth in App.tsx", () => {
    const appPath = join(process.cwd(), "src", "App.tsx");
    const src = readFileSync(appPath, "utf8");
    const idxPublic = src.indexOf('path="/public/fleet/reservation/:token"');
    const idxShort = src.indexOf('path="/reservar-carro"');
    const idxAuth = src.indexOf("<Route element={<RequireAuth />}>");
    assert.ok(idxPublic >= 0);
    assert.ok(idxShort >= 0);
    assert.ok(idxAuth >= 0);
    assert.ok(idxPublic < idxAuth);
    assert.ok(idxShort < idxAuth);
  });

  it("/reservar-carro uses FleetPublicReservationShortLinkPage without RequireAuth", () => {
    const appPath = join(process.cwd(), "src", "App.tsx");
    const src = readFileSync(appPath, "utf8");
    assert.ok(src.includes("FleetPublicReservationShortLinkPage"));
    const shortBlock = src.slice(
      src.indexOf('path="/reservar-carro"'),
      src.indexOf("<Route element={<RequireAuth />}>", src.indexOf('path="/reservar-carro"'))
    );
    assert.ok(!shortBlock.includes("RequireAuth"));
  });

  it("short link page resolves slug via public API and navigates to technical route", () => {
    const pagePath = join(
      process.cwd(),
      "src",
      "components",
      "fleet",
      "FleetPublicReservationShortLinkPage.tsx"
    );
    const src = readFileSync(pagePath, "utf8");
    assert.ok(src.includes("buildPublicReservationLinkApiUrl"));
    assert.ok(src.includes("navigate(body.targetUrl"));
    assert.ok(!src.includes('to="/login"'));
    assert.ok(!src.includes("RequireAuth"));
  });

  it("buildPublicReservationLinkApiUrl maps slug to public reservation-link endpoint", () => {
    assert.equal(
      buildPublicReservationLinkApiUrl("reservar-carro"),
      "/api/public/fleet/reservation-link/reservar-carro"
    );
    assert.equal(
      buildPublicReservationLinkApiUrl("r/frota"),
      "/api/public/fleet/reservation-link/r/frota"
    );
  });

  it("short link page shows controlled errors for 403/404 without login redirect", () => {
    const pagePath = join(
      process.cwd(),
      "src",
      "components",
      "fleet",
      "FleetPublicReservationShortLinkPage.tsx"
    );
    const src = readFileSync(pagePath, "utf8");
    assert.ok(src.includes("res.status === 403"));
    assert.ok(src.includes("res.status === 404"));
    assert.ok(src.includes("Solicitação pública desativada"));
    assert.ok(src.includes("Link não encontrado"));
  });

  it("QR panel and share links prefer short URL", () => {
    const panelPath = join(process.cwd(), "src", "components", "fleet", "FleetPublicReservationQrPanel.tsx");
    const panelSrc = readFileSync(panelPath, "utf8");
    assert.ok(panelSrc.includes("qrUrl = links?.shortUrl"));
    assert.ok(panelSrc.includes("Copiar link curto"));
    const links = buildPublicReservationShareLinks({
      token: "abc123token",
      baseUrl: "http://192.168.100.5:3000",
      slug: "reservar-carro",
    });
    assert.equal(links.shortUrl, "http://192.168.100.5:3000/reservar-carro");
    assert.equal(links.shareUrl, links.shortUrl);
  });

  it("technical public reservation route remains valid alongside short link", () => {
    const links = buildPublicReservationShareLinks({
      token: "tok12345678901234567890123456789012",
      baseUrl: "http://192.168.100.5:3000",
      slug: "reservar-carro",
    });
    assert.match(links.technicalUrl ?? "", /\/public\/fleet\/reservation\/tok/);
  });

  it("reservation-link API returns targetUrl path for slug resolution", () => {
    const routesPath = join(process.cwd(), "src", "lib", "fleetPublicReservationRoutes.ts");
    const src = readFileSync(routesPath, "utf8");
    assert.ok(src.includes("targetUrl: result.targetPath"));
    assert.ok(!src.includes("requireAppAuth"));
  });

  it("short link middleware still redirects before SPA fallback", () => {
    const serverPath = join(process.cwd(), "server.ts");
    const src = readFileSync(serverPath, "utf8");
    const idxMiddleware = src.indexOf("registerFleetPublicReservationShortLinkMiddleware");
    const idxVite = src.indexOf("vite.middlewares");
    const idxStatic = src.indexOf("express.static(distPath)");
    assert.ok(idxMiddleware >= 0);
    assert.ok(idxVite >= 0 || idxStatic >= 0);
    if (idxVite >= 0) assert.ok(idxMiddleware < idxVite);
    if (idxStatic >= 0) assert.ok(idxMiddleware < idxStatic);
  });

  it("first wizard step remains CPF after short link resolution", () => {
    assert.equal(FLEET_PUBLIC_RESERVATION_INITIAL_STEP, "cpf");
    const pagePath = join(process.cwd(), "src", "components", "fleet", "FleetPublicReservationPage.tsx");
    const src = readFileSync(pagePath, "utf8");
    assert.ok(src.includes("FLEET_PUBLIC_RESERVATION_INITIAL_STEP"));
  });

  it("fleet QR settings panel unchanged for internal authenticated use", () => {
    const panelPath = join(process.cwd(), "src", "components", "fleet", "FleetPublicReservationQrPanel.tsx");
    const src = readFileSync(panelPath, "utf8");
    assert.ok(src.includes("/api/fleet/public-reservation/link"));
    assert.ok(src.includes("canManage"));
  });
});

describe("fleetPublicReservation short link and slug", () => {
  it("buildPublicReservationShortUrl uses configured base URL", () => {
    const url = buildPublicReservationShortUrl(
      "reservar-carro",
      "http://192.168.100.5:3000"
    );
    assert.equal(url, "http://192.168.100.5:3000/reservar-carro");
  });

  it("buildPublicReservationShortUrl removes duplicate slashes", () => {
    const url = buildPublicReservationShortUrl("reservar-carro", "http://192.168.100.5:3000/");
    assert.equal(url, "http://192.168.100.5:3000/reservar-carro");
    assert.ok(!url.includes("//reservar"));
  });

  it("validatePublicReservationSlug rejects invalid and reserved slugs", () => {
    assert.equal(validatePublicReservationSlug("reservar-carro").ok, true);
    assert.equal(validatePublicReservationSlug("r/frota").ok, true);
    assert.equal(validatePublicReservationSlug("Com Acento").ok, false);
    assert.equal(validatePublicReservationSlug("api").ok, false);
    for (const reserved of FLEET_PUBLIC_RESERVATION_RESERVED_SLUGS) {
      assert.equal(validatePublicReservationSlug(reserved).ok, false, reserved);
    }
  });

  it("buildPublicReservationShareLinks prefers short URL for share/QR", () => {
    const links = buildPublicReservationShareLinks({
      token: "abc123token",
      baseUrl: "http://192.168.100.5:3000",
      slug: "reservar-carro",
    });
    assert.equal(links.shortUrl, "http://192.168.100.5:3000/reservar-carro");
    assert.equal(links.shareUrl, links.shortUrl);
    assert.equal(
      links.technicalUrl,
      "http://192.168.100.5:3000/public/fleet/reservation/abc123token"
    );
  });

  it("buildPublicReservationShareLinks falls back to technical URL without slug", () => {
    const links = buildPublicReservationShareLinks({
      token: "tok",
      baseUrl: "http://192.168.100.5:3000",
      slug: "",
    });
    assert.equal(links.shortUrl, null);
    assert.equal(links.shareUrl, "http://192.168.100.5:3000/public/fleet/reservation/tok");
  });

  it("publicReservationPathMatchesSlug matches configured path only", () => {
    assert.equal(publicReservationPathMatchesSlug("/reservar-carro", "reservar-carro"), true);
    assert.equal(publicReservationPathMatchesSlug("/r/frota", "r/frota"), true);
    assert.equal(publicReservationPathMatchesSlug("/login", "reservar-carro"), false);
  });

  it("QR panel and routes use short link resolution endpoint", () => {
    const routesPath = join(process.cwd(), "src", "lib", "fleetPublicReservationRoutes.ts");
    const panelPath = join(process.cwd(), "src", "components", "fleet", "FleetPublicReservationQrPanel.tsx");
    const routesSrc = readFileSync(routesPath, "utf8");
    const panelSrc = readFileSync(panelPath, "utf8");
    assert.ok(routesSrc.includes("/api/public/fleet/reservation-link/"));
    assert.ok(routesSrc.includes("registerFleetPublicReservationShortLinkMiddleware"));
    assert.ok(panelSrc.includes("Copiar link curto"));
    assert.ok(panelSrc.includes("copyTextToClipboard"));
  });

  it("reservation-link route maps disabled to 403 and missing slug to 404", () => {
    const routesPath = join(process.cwd(), "src", "lib", "fleetPublicReservationRoutes.ts");
    const src = readFileSync(routesPath, "utf8");
    assert.ok(src.includes('reason === "disabled"'));
    assert.ok(src.includes("res.status(403)"));
    assert.ok(src.includes("res.status(404)"));
  });

  it("technical public reservation route remains outside RequireAuth", () => {
    const appPath = join(process.cwd(), "src", "App.tsx");
    const src = readFileSync(appPath, "utf8");
    const idxPublic = src.indexOf(`path="${FLEET_PUBLIC_RESERVATION_PATH}/:token"`);
    const idxAuth = src.indexOf("<Route element={<RequireAuth />}>");
    assert.ok(idxPublic >= 0);
    assert.ok(idxPublic < idxAuth);
  });
});

describe("fleetPublicReservationLink", () => {
  it("buildPublicReservationUrl uses configured base URL", () => {
    const url = buildPublicReservationUrl(
      "abc123token",
      "http://192.168.100.5:3000"
    );
    assert.equal(url, "http://192.168.100.5:3000/public/fleet/reservation/abc123token");
  });

  it("buildPublicReservationUrl removes trailing slash from base", () => {
    const url = buildPublicReservationUrl(
      "tok",
      "http://192.168.100.5:3000/"
    );
    assert.equal(url, "http://192.168.100.5:3000/public/fleet/reservation/tok");
    assert.ok(!url.includes("//public"));
  });

  it("resolvePublicReservationBaseUrl prefers setting over localhost origin", () => {
    const base = resolvePublicReservationBaseUrl(
      { publicReservationBaseUrl: "http://192.168.100.5:3000" },
      "http://127.0.0.1:3000"
    );
    assert.equal(base, "http://192.168.100.5:3000");
    const url = buildPublicReservationUrl("tok", base);
    assert.ok(!url.includes("127.0.0.1"));
  });

  it("resolvePublicReservationBaseUrl uses non-localhost origin when setting empty", () => {
    const base = resolvePublicReservationBaseUrl({}, "http://192.168.100.5:3000");
    assert.equal(base, "http://192.168.100.5:3000");
  });

  it("resolvePublicReservationBaseUrl returns null for localhost-only origin", () => {
    const base = resolvePublicReservationBaseUrl({}, "http://127.0.0.1:3000");
    assert.equal(base, null);
    assert.equal(isLocalhostOrigin("http://127.0.0.1:3000"), true);
  });

  it("normalizePublicReservationBaseUrl strips trailing slashes", () => {
    assert.equal(normalizePublicReservationBaseUrl("http://a/b/"), "http://a/b");
  });

  it("initial wizard step is CPF", () => {
    assert.equal(FLEET_PUBLIC_RESERVATION_INITIAL_STEP, "cpf");
  });
});

describe("fleetPublicReservation public route auth", () => {
  it("public reservation route is outside RequireAuth in App.tsx", () => {
    const appPath = join(process.cwd(), "src", "App.tsx");
    const src = readFileSync(appPath, "utf8");
    const publicRoute = `path="${FLEET_PUBLIC_RESERVATION_PATH}/:token"`;
    const idxPublic = src.indexOf(publicRoute);
    const idxAuth = src.indexOf("<Route element={<RequireAuth />}>");
    assert.ok(idxPublic >= 0, "rota pública deve existir");
    assert.ok(idxAuth >= 0, "RequireAuth deve existir");
    assert.ok(idxPublic < idxAuth, "rota pública deve vir antes do guard de auth");
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
    assert.ok(FLEET_EDITABLE_SETTINGS_KEYS.includes("publicReservationBaseUrl"));
    assert.ok(FLEET_EDITABLE_SETTINGS_KEYS.includes("publicReservationToken"));
    assert.ok(FLEET_EDITABLE_SETTINGS_KEYS.includes("publicReservationSlug"));
  });
});

describe("fleetPublicReservation public token responses", () => {
  it("routes map disabled token to 403 and invalid to 404", () => {
    const routesPath = join(process.cwd(), "src", "lib", "fleetPublicReservationRoutes.ts");
    const src = readFileSync(routesPath, "utf8");
    assert.ok(src.includes('resolved.reason === "disabled"'));
    assert.ok(src.includes("res.status(403)"));
    assert.ok(src.includes("res.status(404)"));
  });
});

describe("fleetPublicReservation driver approval migrations", () => {
  it("structural migration does not use new enum values in UPDATE (PostgreSQL P3018)", () => {
    const structuralPath = join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260612120000_fleet_public_driver_approval",
      "migration.sql"
    );
    const src = readFileSync(structuralPath, "utf8");
    assert.ok(src.includes("PENDING_DRIVER_APPROVAL"));
    assert.ok(src.includes("createdFromPublicReservation"));
    assert.equal(src.includes("UPDATE \"FleetPublicReservationRequest\""), false);
    assert.equal(src.includes("PENDING_RESERVATION_APPROVAL"), true);
    assert.equal(src.includes("SET \"status\" = 'PENDING_RESERVATION_APPROVAL'"), false);
  });

  it("backfill migration applies status update in separate step", () => {
    const backfillPath = join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260612121000_fleet_public_driver_approval_backfill",
      "migration.sql"
    );
    const src = readFileSync(backfillPath, "utf8");
    assert.ok(src.includes("UPDATE \"FleetPublicReservationRequest\""));
    assert.ok(src.includes("PENDING_RESERVATION_APPROVAL"));
    assert.ok(src.includes("SET DEFAULT"));
  });
});

describe("fleetPublicReservation approval history", () => {
  const baseRequest = {
    publicCode: "QR-ABC",
    requesterCpf: "11144477735",
    requesterName: "Maria Silva",
    requesterEmail: "maria@example.com",
    requesterPhone: "11999990000",
    requesterDepartment: "TI",
    requestedDate: parseLocalDateOnly("2026-06-08")!,
    startTime: "09:00",
    endTime: "12:00",
    reason: "Visita cliente",
    destination: "Campinas",
    notes: null,
    driver: {
      id: "d1",
      name: "Maria Silva",
      status: "PENDING",
      cnhNumber: "123456",
      cnhExpirationDate: new Date("2099-06-01"),
    },
    vehicle: {
      id: "v1",
      brand: "Fiat",
      model: "Uno",
      vehicleType: "Hatch",
      status: "AVAILABLE",
    },
  };

  it("approve driver flow records DRIVER_APPROVED in service transaction", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes('action: "DRIVER_APPROVED"'));
    assert.ok(src.includes('stage: "DRIVER_REGISTRATION"'));
    assert.ok(src.includes("recordFleetPublicReservationApprovalHistory"));
  });

  it("reject driver flow records DRIVER_REJECTED with rejectionReason", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes('action: "DRIVER_REJECTED"'));
    assert.ok(src.includes("rejectionReason: reason"));
  });

  it("reject driver without reason fails via assertReasonRequired", () => {
    assert.throws(
      () => assertReasonRequired("", "Motivo da rejeição do motorista"),
      /obrigatório/
    );
  });

  it("approve reservation flow records RESERVATION_APPROVED with fleetReservationId", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes('action: "RESERVATION_APPROVED"'));
    assert.ok(src.includes("fleetReservationId: reservation.id"));
  });

  it("reject reservation flow records RESERVATION_REJECTED with rejectionReason", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    assert.ok(src.includes('action: "RESERVATION_REJECTED"'));
    assert.ok(src.includes('stage: "VEHICLE_RESERVATION"'));
  });

  it("reject reservation without reason fails via assertReasonRequired", () => {
    assert.throws(() => assertReasonRequired("   ", "Motivo da rejeição"), /obrigatório/);
  });

  it("history preserves actorUserId and name/email snapshot fields", () => {
    const serialized = serializeApprovalHistoryEntry({
      id: "h1",
      action: "DRIVER_APPROVED",
      stage: "DRIVER_REGISTRATION",
      statusBefore: "PENDING_DRIVER_APPROVAL",
      statusAfter: "PENDING_RESERVATION_APPROVAL",
      actorUserId: "u1",
      actorNameSnapshot: "João",
      actorEmailSnapshot: "joao@corp.com",
      driverId: "d1",
      vehicleId: null,
      fleetReservationId: null,
      comment: null,
      rejectionReason: null,
      detailsJson: { requesterName: "Maria" },
      createdAt: new Date("2026-06-08T14:30:00"),
    });
    assert.equal(serialized.actorUserId, "u1");
    assert.equal(serialized.actorName, "João");
    assert.equal(serialized.actorEmail, "joao@corp.com");
  });

  it("history records statusBefore and statusAfter", () => {
    const serialized = serializeApprovalHistoryEntry({
      id: "h2",
      action: "RESERVATION_REJECTED",
      stage: "VEHICLE_RESERVATION",
      statusBefore: "PENDING_RESERVATION_APPROVAL",
      statusAfter: "REJECTED",
      actorUserId: "u2",
      actorNameSnapshot: "Maria",
      actorEmailSnapshot: null,
      driverId: "d1",
      vehicleId: "v1",
      fleetReservationId: null,
      comment: "Indisponível",
      rejectionReason: "veículo indisponível",
      detailsJson: null,
      createdAt: new Date("2026-06-08T15:20:00"),
    });
    assert.equal(serialized.statusBefore, "PENDING_RESERVATION_APPROVAL");
    assert.equal(serialized.statusAfter, "REJECTED");
  });

  it("history list orders createdAt ascending in listPublicReservationApprovalHistory", () => {
    const historyPath = join(process.cwd(), "src", "lib", "fleetPublicReservationApprovalHistory.ts");
    const src = readFileSync(historyPath, "utf8");
    assert.ok(src.includes('orderBy: { createdAt: "asc" }'));
  });

  it("history endpoint requires fleet.reservations.view guard", async () => {
    const routesPath = join(process.cwd(), "src", "lib", "fleetPublicReservationInternalRoutes.ts");
    const src = readFileSync(routesPath, "utf8");
    assert.ok(src.includes("/history"));
    assert.ok(src.includes("...g.view"));
    const { evaluateFleetRouteAccess } = await import("./fleetPermissionResolve.js");
    assert.equal(evaluateFleetRouteAccess(["fleet.reservations.view"], "view"), true);
    assert.equal(evaluateFleetRouteAccess([], "view"), false);
  });

  it("detailsJson masks CPF and does not include public token", () => {
    const details = buildPublicReservationHistoryDetails(baseRequest) as Record<string, unknown>;
    assert.equal(details.requesterCpf, "***.***.***-35");
    assert.equal("publicReservationToken" in details, false);
    assert.equal("token" in details, false);
    assert.equal(details.requesterName, "Maria Silva");
  });

  it("serialized history omits undefined NaN and null strings in labels", () => {
    const serialized = serializeApprovalHistoryEntry({
      id: "h3",
      action: "DRIVER_APPROVED",
      stage: "DRIVER_REGISTRATION",
      statusBefore: "PENDING_DRIVER_APPROVAL",
      statusAfter: "PENDING_RESERVATION_APPROVAL",
      actorUserId: "u1",
      actorNameSnapshot: "João",
      actorEmailSnapshot: null,
      driverId: "d1",
      vehicleId: null,
      fleetReservationId: null,
      comment: null,
      rejectionReason: null,
      detailsJson: { foo: undefined as unknown as null },
      createdAt: new Date("2026-06-08T14:30:00"),
    });
    const json = JSON.stringify(serialized);
    assert.ok(!json.includes("undefined"));
    assert.ok(!json.includes("NaN"));
    assert.equal(serialized.actorEmail, null);
    assert.match(serialized.createdAtLabel, /08\/06\/2026/);
  });

  it("buildApprovalHistorySummary formats Portuguese messages", () => {
    const approved = buildApprovalHistorySummary({
      action: "DRIVER_APPROVED",
      actorName: "João",
      actorEmail: null,
      createdAtLabel: "08/06/2026, 14:30",
      rejectionReason: null,
    });
    assert.match(approved, /Motorista aprovado por João/);
    assert.match(approved, /08\/06\/2026/);

    const rejected = buildApprovalHistorySummary({
      action: "RESERVATION_REJECTED",
      actorName: "Maria",
      actorEmail: null,
      createdAtLabel: "08/06/2026, 15:20",
      rejectionReason: "veículo indisponível",
    });
    assert.match(rejected, /Reserva rejeitada por Maria/);
    assert.match(rejected, /Motivo: veículo indisponível/);
  });

  it("recordFleetPublicReservationApprovalHistory rejects reject action without reason", async () => {
    await assert.rejects(
      () =>
        recordFleetPublicReservationApprovalHistory({
          publicReservationRequestId: "00000000-0000-4000-8000-000000000001",
          action: "DRIVER_REJECTED",
          stage: "DRIVER_REGISTRATION",
          statusBefore: "PENDING_DRIVER_APPROVAL",
          statusAfter: "REJECTED",
          actor: { userId: "u1", name: "Test", email: null },
          rejectionReason: "",
        }),
      /Motivo da rejeição/
    );
  });

  it("history remains after FleetReservation — cascade only on request delete", () => {
    const schemaPath = join(process.cwd(), "prisma", "schema.prisma");
    const src = readFileSync(schemaPath, "utf8");
    assert.ok(src.includes("model FleetPublicReservationApprovalHistory"));
    assert.ok(src.includes("onDelete: Cascade"));
    assert.ok(src.includes("fleetReservationId"));
  });

  it("approval history UI section exists in Solicitações QR tab", () => {
    const tabPath = join(
      process.cwd(),
      "src",
      "components",
      "fleet",
      "FleetPublicReservationRequestsTab.tsx"
    );
    const src = readFileSync(tabPath, "utf8");
    assert.ok(src.includes("Histórico de aprovações"));
    assert.ok(src.includes("Nenhuma decisão registrada ainda."));
    assert.ok(src.includes("/history"));
  });

  it("action and stage labels are defined for all enum values", () => {
    assert.equal(APPROVAL_ACTION_LABELS.DRIVER_APPROVED, "Motorista aprovado");
    assert.equal(APPROVAL_STAGE_LABELS.DRIVER_REGISTRATION, "Cadastro do motorista");
    assert.equal(APPROVAL_ACTION_LABELS.RESERVATION_REJECTED, "Reserva rejeitada");
  });

  it("failed approval by conflict does not record RESERVATION_BLOCKED", () => {
    const servicePath = join(process.cwd(), "src", "lib", "fleetPublicReservationService.ts");
    const src = readFileSync(servicePath, "utf8");
    const conflictIdx = src.indexOf("Conflito de agenda");
    const blockedIdx = src.indexOf('action: "RESERVATION_BLOCKED"');
    assert.ok(conflictIdx >= 0);
    assert.equal(blockedIdx, -1);
  });
});
