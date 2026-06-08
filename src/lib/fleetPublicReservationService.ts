import { randomBytes } from "node:crypto";
import type { FleetPublicReservationRequestStatus, FleetVehicle } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { loadFleetSettings, writeFleetAuditLog } from "@/src/lib/fleetService.js";
import {
  FleetValidationError,
  assertDateRange,
  assertDriverAuthorizedForReservation,
  assertReasonRequired,
  findReservationConflict,
  isVehicleReservable,
  FLEET_ACTIVE_RESERVATION_STATUSES,
  reservationPeriodsOverlap,
} from "@/src/lib/fleetValidation.js";
import {
  syncVehicleStatusAfterReservationChange,
  validateReservationFull,
} from "@/src/lib/fleetReservationOps.js";
import {
  buildFleetPublicReservationSlots,
  buildPublicDateRange,
  combineDateAndTimeLocal,
  dateToYmdUtc,
  filterPastSlotsForToday,
  formatWeekdayDateLabel,
  parseDateOnly,
  parseFleetPublicSlotConfig,
  type FleetPublicSlot,
} from "@/src/lib/fleetPublicReservationSlots.js";
import {
  assertValidPublicCpf,
  getPublicDriverOrThrow,
  identifyPublicDriverByCpf,
  registerPublicDriver,
  type PublicRegisterInput,
} from "@/src/lib/fleetPublicReservationDriverOps.js";
import { maskCpfForDisplay } from "@/src/lib/fleetCpfUtils.js";

export { identifyPublicDriverByCpf, registerPublicDriver };
export type { PublicRegisterInput };

export const FLEET_PUBLIC_SETTINGS_KEYS = [
  "publicReservationEnabled",
  "publicReservationToken",
  "publicReservationTitle",
  "publicReservationInstructions",
  "publicReservationSlotMinutes",
  "publicReservationStartHour",
  "publicReservationEndHour",
] as const;

export const FLEET_PUBLIC_ACTIVE_REQUEST_STATUSES: FleetPublicReservationRequestStatus[] = ["PENDING"];

export type FleetPublicTokenFailure = { ok: false; reason: "disabled" | "invalid" };
export type FleetPublicTokenSuccess = { ok: true; settings: Record<string, string> };
export type FleetPublicTokenResult = FleetPublicTokenFailure | FleetPublicTokenSuccess;

const TEXT_MAX = 500;
const NAME_MAX = 120;

function sanitizeText(value: unknown, max = TEXT_MAX, required = false, label = "Campo"): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s && required) throw new FleetValidationError(`${label} é obrigatório.`);
  if (s.length > max) throw new FleetValidationError(`${label} excede ${max} caracteres.`);
  return s;
}

function sanitizeOptionalText(value: unknown, max = TEXT_MAX): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  if (s.length > max) throw new FleetValidationError(`Campo excede ${max} caracteres.`);
  return s;
}

export function generatePublicReservationToken(): string {
  return randomBytes(32).toString("hex");
}

export function generatePublicReservationCode(): string {
  return `FRQ-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export function buildPublicReservationUrl(token: string, origin?: string): string {
  const base = (origin ?? "").replace(/\/$/, "");
  if (base) return `${base}/public/fleet/reservation/${token}`;
  return `/public/fleet/reservation/${token}`;
}

export async function ensurePublicReservationToken(userId: string | null): Promise<string> {
  const settings = await loadFleetSettings();
  const existing = settings.publicReservationToken?.trim();
  if (existing && existing.length >= 32) return existing;

  const token = generatePublicReservationToken();
  await prisma.fleetSettings.upsert({
    where: { key: "publicReservationToken" },
    create: {
      key: "publicReservationToken",
      value: token,
      description: "Token público (64 caracteres hex) para URL de solicitação",
      updatedBy: userId,
    },
    update: { value: token, updatedBy: userId },
  });
  await writeFleetAuditLog({
    entityType: "FleetSettings",
    entityId: "publicReservationToken",
    action: "GENERATE_TOKEN",
    newValue: "[redacted]",
    userId,
  });
  return token;
}

export async function resolvePublicToken(token: string): Promise<FleetPublicTokenResult> {
  const settings = await loadFleetSettings();
  if (settings.publicReservationEnabled !== "true") {
    return { ok: false, reason: "disabled" };
  }
  const stored = settings.publicReservationToken?.trim();
  if (!stored || stored !== token.trim()) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, settings };
}

export function formatPublicVehicleLabel(vehicle: Pick<FleetVehicle, "brand" | "model" | "vehicleType">): string {
  const type = vehicle.vehicleType?.trim();
  const base = `${vehicle.brand} ${vehicle.model}`.trim();
  return type ? `${base} (${type})` : base;
}

export function serializePublicVehicle(
  vehicle: Pick<FleetVehicle, "id" | "brand" | "model" | "vehicleType" | "notes">
) {
  return {
    id: vehicle.id,
    label: formatPublicVehicleLabel(vehicle),
    brand: vehicle.brand,
    model: vehicle.model,
    vehicleType: vehicle.vehicleType,
    category: vehicle.vehicleType,
    nickname: vehicle.notes?.trim() || null,
  };
}

async function listReservableVehicles(vehicleId?: string | null) {
  const vehicles = await prisma.fleetVehicle.findMany({
    where: vehicleId ? { id: vehicleId } : { status: { notIn: ["INACTIVE", "SOLD", "RETURNED"] } },
    select: {
      id: true,
      brand: true,
      model: true,
      vehicleType: true,
      status: true,
      plate: true,
      notes: true,
    },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
  });
  return vehicles.filter((v) => isVehicleReservable(v.status));
}

type PeriodLike = { startDateTime: Date; endDateTime: Date; id?: string };

function findPublicRequestConflict<
  T extends { id: string; requestedDate: Date; startTime: string; endTime: string; vehicleId: string | null }
>(
  existing: T[],
  dateStr: string,
  startTime: string,
  endTime: string,
  vehicleId: string | null,
  excludeId?: string
): T | undefined {
  const start = combineDateAndTimeLocal(dateStr, startTime);
  const end = combineDateAndTimeLocal(dateStr, endTime);
  return existing.find((r) => {
    if (excludeId && r.id === excludeId) return false;
    if (vehicleId && r.vehicleId && r.vehicleId !== vehicleId) return false;
    const rDate = dateToYmdUtc(r.requestedDate);
    const rStart = combineDateAndTimeLocal(rDate, r.startTime);
    const rEnd = combineDateAndTimeLocal(rDate, r.endTime);
    return reservationPeriodsOverlap(start, end, rStart, rEnd);
  });
}

async function loadDayConflicts(dateStr: string, vehicleId: string) {
  const dayStart = combineDateAndTimeLocal(dateStr, "00:00");
  const dayEnd = combineDateAndTimeLocal(dateStr, "23:59");
  const requestedDate = parseDateOnly(dateStr);

  const [reservations, pendingRequests] = await Promise.all([
    prisma.fleetReservation.findMany({
      where: {
        vehicleId,
        status: { in: FLEET_ACTIVE_RESERVATION_STATUSES },
        startDateTime: { lt: dayEnd },
        endDateTime: { gt: dayStart },
      },
      select: { id: true, vehicleId: true, startDateTime: true, endDateTime: true },
    }),
    prisma.fleetPublicReservationRequest.findMany({
      where: {
        status: { in: FLEET_PUBLIC_ACTIVE_REQUEST_STATUSES },
        vehicleId,
        requestedDate: requestedDate ?? undefined,
      },
      select: {
        id: true,
        vehicleId: true,
        requestedDate: true,
        startTime: true,
        endTime: true,
      },
    }),
  ]);

  return { reservations, pendingRequests };
}

async function loadRangeConflicts(from: string, days: number, vehicleId: string) {
  const dates = buildPublicDateRange(from, days);
  if (dates.length === 0) return { dates: [], reservations: [], pendingRequests: [] };

  const rangeStart = combineDateAndTimeLocal(dates[0]!, "00:00");
  const rangeEnd = combineDateAndTimeLocal(dates[dates.length - 1]!, "23:59");
  const dateObjs = dates.map((d) => parseDateOnly(d)!).filter(Boolean);

  const [reservations, pendingRequests] = await Promise.all([
    prisma.fleetReservation.findMany({
      where: {
        vehicleId,
        status: { in: FLEET_ACTIVE_RESERVATION_STATUSES },
        startDateTime: { lt: rangeEnd },
        endDateTime: { gt: rangeStart },
      },
      select: { id: true, vehicleId: true, startDateTime: true, endDateTime: true },
    }),
    prisma.fleetPublicReservationRequest.findMany({
      where: {
        status: { in: FLEET_PUBLIC_ACTIVE_REQUEST_STATUSES },
        vehicleId,
        requestedDate: { in: dateObjs },
      },
      select: {
        id: true,
        vehicleId: true,
        requestedDate: true,
        startTime: true,
        endTime: true,
      },
    }),
  ]);

  return { dates, reservations, pendingRequests };
}

function vehicleHasSlotConflict(
  vehicleId: string,
  slot: FleetPublicSlot,
  dateStr: string,
  reservations: {
    id: string;
    vehicleId: string;
    startDateTime: Date;
    endDateTime: Date;
  }[],
  pendingRequests: {
    id: string;
    vehicleId: string | null;
    requestedDate: Date;
    startTime: string;
    endTime: string;
  }[]
): boolean {
  const start = combineDateAndTimeLocal(dateStr, slot.start);
  const end = combineDateAndTimeLocal(dateStr, slot.end);

  const resHit = findReservationConflict(
    reservations.filter((r) => r.vehicleId === vehicleId),
    start,
    end
  );
  if (resHit) return true;

  const reqHit = findPublicRequestConflict(pendingRequests, dateStr, slot.start, slot.end, vehicleId);
  return Boolean(reqHit);
}

export async function getPublicReservationConfig(
  token: string
): Promise<FleetPublicTokenFailure | { ok: true; config: Awaited<ReturnType<typeof buildConfigPayload>> }> {
  const resolved = await resolvePublicToken(token);
  if (resolved.ok === false) return resolved;
  return { ok: true, config: await buildConfigPayload(resolved.settings) };
}

async function buildConfigPayload(settings: Record<string, string>) {
  const slotConfig = parseFleetPublicSlotConfig(settings);

  return {
    title: settings.publicReservationTitle?.trim() || "Solicitar reserva de veículo",
    instructions:
      settings.publicReservationInstructions?.trim() ||
      "Informe seu CPF para identificação e escolha um horário disponível.",
    slotMinutes: slotConfig.slotMinutes,
    startHour: slotConfig.startHour,
    endHour: slotConfig.endHour,
  };
}

export async function listPublicReservationVehicles(token: string) {
  const resolved = await resolvePublicToken(token);
  if (resolved.ok === false) return resolved;

  const vehicles = await listReservableVehicles();
  return {
    ok: true as const,
    vehicles: vehicles.map((v) => serializePublicVehicle(v)),
  };
}

function buildDaySlotsForVehicle(
  dateStr: string,
  vehicleId: string,
  slotConfig: ReturnType<typeof parseFleetPublicSlotConfig>,
  reservations: Awaited<ReturnType<typeof loadRangeConflicts>>["reservations"],
  pendingRequests: Awaited<ReturnType<typeof loadRangeConflicts>>["pendingRequests"]
) {
  let slots = buildFleetPublicReservationSlots(slotConfig);
  slots = filterPastSlotsForToday(slots, dateStr);
  const dayReservations = reservations.filter((r) => r.vehicleId === vehicleId);
  const dayPending = pendingRequests.filter(
    (r) => dateToYmdUtc(r.requestedDate) === dateStr
  );

  return slots.map((slot) => {
    const available = !vehicleHasSlotConflict(
      vehicleId,
      slot,
      dateStr,
      dayReservations,
      dayPending
    );
    return { ...slot, available, status: available ? ("available" as const) : ("unavailable" as const) };
  });
}

export async function getPublicReservationAvailability(
  token: string,
  vehicleId: string,
  from: string,
  days = 7
): Promise<
  FleetPublicTokenFailure | {
    ok: true;
    vehicleId: string;
    from: string;
    days: number;
    dates: Array<{
      date: string;
      weekdayLabel: string;
      slots: Array<FleetPublicSlot & { available: boolean; status: "available" | "unavailable" }>;
    }>;
  }
> {
  const resolved = await resolvePublicToken(token);
  if (resolved.ok === false) return resolved;

  const vid = vehicleId?.trim();
  if (!vid) throw new FleetValidationError("Selecione um veículo.");

  const vehicles = await listReservableVehicles(vid);
  if (vehicles.length === 0) throw new FleetValidationError("Veículo indisponível para reserva.");

  const fromDate = parseDateOnly(from);
  if (!fromDate) throw new FleetValidationError("Data inicial inválida. Use YYYY-MM-DD.");

  const slotConfig = parseFleetPublicSlotConfig(resolved.settings);
  const { dates, reservations, pendingRequests } = await loadRangeConflicts(from, days, vid);

  return {
    ok: true,
    vehicleId: vid,
    from,
    days: dates.length,
    dates: dates.map((dateStr) => ({
      date: dateStr,
      weekdayLabel: formatWeekdayDateLabel(dateStr),
      slots: buildDaySlotsForVehicle(dateStr, vid, slotConfig, reservations, pendingRequests),
    })),
  };
}

export type CreatePublicReservationInput = {
  cpf: string;
  driverId: string;
  requesterName: string;
  requesterEmail?: string | null;
  requesterPhone?: string | null;
  requesterDepartment?: string | null;
  responsibilityAccepted?: boolean;
  requestedDate: string;
  startTime: string;
  endTime: string;
  reason: string;
  destination: string;
  notes?: string | null;
  passengersCount?: number | null;
  vehicleId: string;
};

export async function createPublicReservationRequest(
  token: string,
  input: CreatePublicReservationInput
): Promise<
  FleetPublicTokenFailure | {
    ok: true;
    request: {
      id: string;
      publicCode: string;
      status: FleetPublicReservationRequestStatus;
      requestedDate: Date;
      startTime: string;
      endTime: string;
      createdAt: Date;
    };
  }
> {
  const resolved = await resolvePublicToken(token);
  if (resolved.ok === false) return resolved;

  const cpfDigits = assertValidPublicCpf(input.cpf);
  const driverId = input.driverId?.trim();
  if (!driverId) throw new FleetValidationError("Identificação do condutor é obrigatória.");

  const driver = await getPublicDriverOrThrow(driverId, cpfDigits);
  const requesterName = sanitizeText(input.requesterName || driver.name, NAME_MAX, true, "Nome completo");
  const requesterEmail = sanitizeOptionalText(input.requesterEmail ?? driver.email, 120);
  const requesterPhone = sanitizeOptionalText(input.requesterPhone ?? driver.phone, 40);
  const requesterDepartment = sanitizeOptionalText(input.requesterDepartment ?? driver.unit, 80);
  const reason = sanitizeText(input.reason, TEXT_MAX, true, "Motivo");
  const destination = sanitizeText(input.destination, TEXT_MAX, true, "Destino");
  const notes = sanitizeOptionalText(input.notes);

  const dateStr = input.requestedDate?.trim();
  if (!dateStr || !parseDateOnly(dateStr)) {
    throw new FleetValidationError("Data desejada inválida.");
  }

  const slotConfig = parseFleetPublicSlotConfig(resolved.settings);
  const allowedSlots = buildFleetPublicReservationSlots(slotConfig);
  const startTime = input.startTime?.trim();
  const endTime = input.endTime?.trim();
  const slotOk = allowedSlots.some((s) => s.start === startTime && s.end === endTime);
  if (!slotOk) throw new FleetValidationError("Período selecionado inválido.");

  const visibleSlots = filterPastSlotsForToday(allowedSlots, dateStr);
  if (!visibleSlots.some((s) => s.start === startTime && s.end === endTime)) {
    throw new FleetValidationError("Período indisponível — horário já passou.");
  }

  const vehicleId = input.vehicleId?.trim();
  if (!vehicleId) throw new FleetValidationError("Selecione um veículo.");

  const vehicles = await listReservableVehicles(vehicleId);
  if (vehicles.length === 0) throw new FleetValidationError("Veículo indisponível.");

  const slot = allowedSlots.find((s) => s.start === startTime && s.end === endTime)!;
  const { reservations, pendingRequests } = await loadDayConflicts(dateStr, vehicleId);

  if (vehicleHasSlotConflict(vehicleId, slot, dateStr, reservations, pendingRequests)) {
    throw new FleetValidationError("Período indisponível para o veículo selecionado.");
  }

  let passengersCount: number | null = null;
  if (input.passengersCount != null) {
    const n = Number(input.passengersCount);
    if (!Number.isFinite(n) || n < 1 || n > 99) {
      throw new FleetValidationError("Quantidade de passageiros inválida.");
    }
    passengersCount = Math.floor(n);
  }

  const responsibilityAccepted = input.responsibilityAccepted === true;
  if (!responsibilityAccepted) {
    throw new FleetValidationError("É necessário aceitar a responsabilidade de uso do veículo.");
  }

  const publicCode = generatePublicReservationCode();
  const created = await prisma.fleetPublicReservationRequest.create({
    data: {
      publicCode,
      requesterCpf: cpfDigits,
      driverId,
      requesterName,
      requesterEmail,
      requesterPhone,
      requesterDepartment,
      responsibilityAccepted,
      requestedDate: parseDateOnly(dateStr)!,
      startTime,
      endTime,
      reason,
      destination,
      notes,
      passengersCount,
      vehicleId,
      status: "PENDING",
    },
    select: {
      id: true,
      publicCode: true,
      status: true,
      requestedDate: true,
      startTime: true,
      endTime: true,
      createdAt: true,
    },
  });

  return { ok: true as const, request: created };
}

export async function listPublicReservationRequests(query: {
  status?: string;
  page?: number;
  limit?: number;
}) {
  const where: { status?: FleetPublicReservationRequestStatus } = {};
  if (query.status) where.status = query.status as FleetPublicReservationRequestStatus;

  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 25));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.fleetPublicReservationRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            cpf: true,
            cnhNumber: true,
            cnhCategory: true,
            cnhExpirationDate: true,
            status: true,
          },
        },
        vehicle: { select: { id: true, brand: true, model: true, vehicleType: true, plate: true } },
        fleetReservation: { select: { id: true, status: true } },
      },
    }),
    prisma.fleetPublicReservationRequest.count({ where }),
  ]);

  return { items, total, page, limit };
}

export async function getPublicReservationRequestOrThrow(id: string) {
  const row = await prisma.fleetPublicReservationRequest.findUnique({
    where: { id },
    include: {
      driver: {
        select: {
          id: true,
          name: true,
          cpf: true,
          cnhNumber: true,
          cnhCategory: true,
          cnhExpirationDate: true,
          status: true,
        },
      },
      vehicle: { select: { id: true, brand: true, model: true, vehicleType: true, plate: true } },
      fleetReservation: { select: { id: true, status: true } },
    },
  });
  if (!row) throw new FleetValidationError("Solicitação não encontrada.");
  return row;
}

export async function approvePublicReservationRequest(input: {
  id: string;
  vehicleId: string;
  driverId: string;
  reviewedByUserId: string | null;
  reviewedByLabel: string | null;
}) {
  const existing = await getPublicReservationRequestOrThrow(input.id);
  if (existing.status !== "PENDING") {
    throw new FleetValidationError("Somente solicitações pendentes podem ser aprovadas.");
  }

  const vehicleId = input.vehicleId?.trim() || existing.vehicleId?.trim();
  const driverId = input.driverId?.trim() || existing.driverId?.trim();
  if (!vehicleId) throw new FleetValidationError("Selecione o veículo para aprovar.");
  if (!driverId) throw new FleetValidationError("Selecione o motorista para aprovar.");

  const dateStr = dateToYmdUtc(existing.requestedDate);
  const startDateTime = combineDateAndTimeLocal(dateStr, existing.startTime);
  const endDateTime = combineDateAndTimeLocal(dateStr, existing.endTime);
  assertDateRange(startDateTime, endDateTime, "Reserva");

  await validateReservationFull({
    vehicleId,
    driverId,
    startDateTime,
    endDateTime,
    excludeReservationId: undefined,
  });

  const vehicles = await listReservableVehicles(vehicleId);
  if (vehicles.length === 0) throw new FleetValidationError("Veículo indisponível.");

  const { reservations, pendingRequests } = await loadDayConflicts(dateStr, vehicleId);
  const slot = { start: existing.startTime, end: existing.endTime, label: "", key: "" };
  if (vehicleHasSlotConflict(vehicleId, slot, dateStr, reservations, pendingRequests)) {
    throw new FleetValidationError("Conflito de agenda — período já ocupado para este veículo.");
  }

  const conflictPending = findPublicRequestConflict(
    pendingRequests,
    dateStr,
    existing.startTime,
    existing.endTime,
    vehicleId,
    existing.id
  );
  if (conflictPending) {
    throw new FleetValidationError("Conflito com outra solicitação pendente no mesmo período.");
  }

  const requesterNote = [
    `[Solicitação pública ${existing.publicCode}]`,
    `Solicitante: ${existing.requesterName}`,
    existing.requesterCpf ? `CPF: ${maskCpfForDisplay(existing.requesterCpf)}` : null,
    existing.requesterEmail ? `E-mail: ${existing.requesterEmail}` : null,
    existing.requesterPhone ? `Tel: ${existing.requesterPhone}` : null,
    existing.requesterDepartment ? `Setor: ${existing.requesterDepartment}` : null,
    existing.notes,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.fleetReservation.create({
      data: {
        vehicleId,
        driverId,
        startDateTime,
        endDateTime,
        destination: existing.destination,
        reason: existing.reason,
        status: "APPROVED",
        approvalStatus: "APPROVED",
        approvedBy: input.reviewedByLabel,
        approvedAt: new Date(),
        notes: requesterNote,
      },
    });

    const updated = await tx.fleetPublicReservationRequest.update({
      where: { id: existing.id },
      data: {
        status: "APPROVED",
        vehicleId,
        fleetReservationId: reservation.id,
        reviewedByUserId: input.reviewedByUserId,
        reviewedAt: new Date(),
      },
      include: {
        vehicle: { select: { id: true, brand: true, model: true, vehicleType: true, plate: true } },
        fleetReservation: { select: { id: true, status: true } },
      },
    });

    return { reservation, request: updated };
  });

  await syncVehicleStatusAfterReservationChange(vehicleId, {
    userId: input.reviewedByUserId,
    trigger: "PUBLIC_RESERVATION_APPROVE",
  });

  await writeFleetAuditLog({
    entityType: "FleetPublicReservationRequest",
    entityId: existing.id,
    action: "APPROVE",
    oldValue: "PENDING",
    newValue: "APPROVED",
    userId: input.reviewedByUserId,
  });

  return result;
}

export async function rejectPublicReservationRequest(input: {
  id: string;
  reason: string;
  reviewedByUserId: string | null;
}) {
  const existing = await getPublicReservationRequestOrThrow(input.id);
  if (existing.status !== "PENDING") {
    throw new FleetValidationError("Somente solicitações pendentes podem ser rejeitadas.");
  }

  const reason = assertReasonRequired(input.reason, "Motivo da rejeição");

  const updated = await prisma.fleetPublicReservationRequest.update({
    where: { id: existing.id },
    data: {
      status: "REJECTED",
      reviewComment: reason,
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: new Date(),
    },
    include: {
      vehicle: { select: { id: true, brand: true, model: true, vehicleType: true, plate: true } },
      fleetReservation: { select: { id: true, status: true } },
    },
  });

  await writeFleetAuditLog({
    entityType: "FleetPublicReservationRequest",
    entityId: existing.id,
    action: "REJECT",
    oldValue: "PENDING",
    newValue: "REJECTED",
    reason,
    userId: input.reviewedByUserId,
  });

  return updated;
}

export async function getInternalPublicReservationLink(origin?: string) {
  const settings = await loadFleetSettings();
  const token = settings.publicReservationToken?.trim();
  const enabled = settings.publicReservationEnabled === "true";
  return {
    enabled,
    token: token || null,
    url: token ? buildPublicReservationUrl(token, origin) : null,
  };
}
