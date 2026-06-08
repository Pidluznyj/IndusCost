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
  combineDateAndTimeLocal,
  filterPastSlotsForToday,
  parseDateOnly,
  parseFleetPublicSlotConfig,
  type FleetPublicSlot,
} from "@/src/lib/fleetPublicReservationSlots.js";

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

async function listReservableVehicles(vehicleId?: string | null) {
  const vehicles = await prisma.fleetVehicle.findMany({
    where: vehicleId ? { id: vehicleId } : { status: { notIn: ["INACTIVE", "SOLD", "RETURNED"] } },
    select: { id: true, brand: true, model: true, vehicleType: true, status: true, plate: true },
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
    const rStart = combineDateAndTimeLocal(
      r.requestedDate.toISOString().slice(0, 10),
      r.startTime
    );
    const rEnd = combineDateAndTimeLocal(r.requestedDate.toISOString().slice(0, 10), r.endTime);
    return reservationPeriodsOverlap(start, end, rStart, rEnd);
  });
}

async function loadDayConflicts(dateStr: string, vehicleIds: string[]) {
  const dayStart = combineDateAndTimeLocal(dateStr, "00:00");
  const dayEnd = combineDateAndTimeLocal(dateStr, "23:59");

  const [reservations, pendingRequests] = await Promise.all([
    prisma.fleetReservation.findMany({
      where: {
        vehicleId: { in: vehicleIds },
        status: { in: FLEET_ACTIVE_RESERVATION_STATUSES },
        startDateTime: { lt: dayEnd },
        endDateTime: { gt: dayStart },
      },
      select: { id: true, vehicleId: true, startDateTime: true, endDateTime: true },
    }),
    prisma.fleetPublicReservationRequest.findMany({
      where: {
        status: { in: FLEET_PUBLIC_ACTIVE_REQUEST_STATUSES },
        requestedDate: parseDateOnly(dateStr) ?? undefined,
        OR: [{ vehicleId: null }, { vehicleId: { in: vehicleIds } }],
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
  const vehicles = await listReservableVehicles();

  return {
    title: settings.publicReservationTitle?.trim() || "Solicitar reserva de veículo",
    instructions:
      settings.publicReservationInstructions?.trim() ||
      "Informe seus dados e escolha um horário disponível.",
    slotMinutes: slotConfig.slotMinutes,
    startHour: slotConfig.startHour,
    endHour: slotConfig.endHour,
    vehicles: vehicles.map((v) => ({ id: v.id, label: formatPublicVehicleLabel(v) })),
  };
}

export async function getPublicReservationAvailability(
  token: string,
  dateStr: string,
  vehicleId?: string | null
): Promise<
  FleetPublicTokenFailure | {
    ok: true;
    date: string;
    slots: Array<FleetPublicSlot & { available: boolean; vehiclesAvailable: number }>;
    vehicles: { id: string; label: string }[];
  }
> {
  const resolved = await resolvePublicToken(token);
  if (resolved.ok === false) return resolved;

  const date = parseDateOnly(dateStr);
  if (!date) throw new FleetValidationError("Data inválida. Use YYYY-MM-DD.");

  const slotConfig = parseFleetPublicSlotConfig(resolved.settings);
  let slots = buildFleetPublicReservationSlots(slotConfig);
  slots = filterPastSlotsForToday(slots, dateStr);

  const vehicles = await listReservableVehicles(vehicleId ?? undefined);
  if (vehicleId && vehicles.length === 0) {
    throw new FleetValidationError("Veículo indisponível para reserva.");
  }

  const vehicleIds = vehicles.map((v) => v.id);
  const { reservations, pendingRequests } =
    vehicleIds.length > 0
      ? await loadDayConflicts(dateStr, vehicleIds)
      : { reservations: [], pendingRequests: [] };

  const slotAvailability = slots.map((slot) => {
    const availableVehicles = vehicles.filter(
      (v) => !vehicleHasSlotConflict(v.id, slot, dateStr, reservations, pendingRequests)
    );
    return {
      ...slot,
      available: availableVehicles.length > 0,
      vehiclesAvailable: availableVehicles.length,
    };
  });

  return {
    ok: true as const,
    date: dateStr,
    slots: slotAvailability,
    vehicles: vehicles.map((v) => ({
      id: v.id,
      label: formatPublicVehicleLabel(v),
    })),
  };
}

export type CreatePublicReservationInput = {
  requesterName: string;
  requesterEmail?: string | null;
  requesterPhone?: string | null;
  requesterDepartment?: string | null;
  requesterEmployeeId?: string | null;
  responsibilityAccepted?: boolean;
  requestedDate: string;
  startTime: string;
  endTime: string;
  reason: string;
  destination: string;
  notes?: string | null;
  passengersCount?: number | null;
  hasCargo?: boolean | null;
  cargoDescription?: string | null;
  vehicleId?: string | null;
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

  const requesterName = sanitizeText(input.requesterName, NAME_MAX, true, "Nome completo");
  const requesterEmail = sanitizeOptionalText(input.requesterEmail, 120);
  const requesterPhone = sanitizeOptionalText(input.requesterPhone, 40);
  const requesterDepartment = sanitizeOptionalText(input.requesterDepartment, 80);
  const requesterEmployeeId = sanitizeOptionalText(input.requesterEmployeeId, 40);
  const reason = sanitizeText(input.reason, TEXT_MAX, true, "Motivo");
  const destination = sanitizeText(input.destination, TEXT_MAX, true, "Destino");
  const notes = sanitizeOptionalText(input.notes);
  const cargoDescription = sanitizeOptionalText(input.cargoDescription, 200);

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

  const vehicleId = input.vehicleId?.trim() || null;
  if (vehicleId) {
    const vehicles = await listReservableVehicles(vehicleId);
    if (vehicles.length === 0) throw new FleetValidationError("Veículo indisponível.");
  }

  const vehicles = await listReservableVehicles(vehicleId ?? undefined);
  const vehicleIds = vehicles.map((v) => v.id);
  if (vehicleIds.length === 0) {
    throw new FleetValidationError("Nenhum veículo disponível para este período.");
  }

  const slot = allowedSlots.find((s) => s.start === startTime && s.end === endTime)!;
  const { reservations, pendingRequests } = await loadDayConflicts(dateStr, vehicleIds);

  if (vehicleId) {
    if (vehicleHasSlotConflict(vehicleId, slot, dateStr, reservations, pendingRequests)) {
      throw new FleetValidationError("Período indisponível para o veículo selecionado.");
    }
  } else {
    const anyFree = vehicles.some(
      (v) => !vehicleHasSlotConflict(v.id, slot, dateStr, reservations, pendingRequests)
    );
    if (!anyFree) throw new FleetValidationError("Período indisponível — sem veículos livres.");
  }

  let passengersCount: number | null = null;
  if (input.passengersCount != null) {
    const n = Number(input.passengersCount);
    if (!Number.isFinite(n) || n < 1 || n > 99) {
      throw new FleetValidationError("Quantidade de passageiros inválida.");
    }
    passengersCount = Math.floor(n);
  }

  const hasCargo = input.hasCargo == null ? null : Boolean(input.hasCargo);

  const responsibilityAccepted = input.responsibilityAccepted === true;

  const publicCode = generatePublicReservationCode();
  const created = await prisma.fleetPublicReservationRequest.create({
    data: {
      publicCode,
      requesterName,
      requesterEmail,
      requesterPhone,
      requesterDepartment,
      requesterEmployeeId,
      responsibilityAccepted,
      requestedDate: parseDateOnly(dateStr)!,
      startTime,
      endTime,
      reason,
      destination,
      notes,
      passengersCount,
      hasCargo,
      cargoDescription,
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

  const vehicleId = input.vehicleId?.trim();
  const driverId = input.driverId?.trim();
  if (!vehicleId) throw new FleetValidationError("Selecione o veículo para aprovar.");
  if (!driverId) throw new FleetValidationError("Selecione o motorista para aprovar.");

  const dateStr = existing.requestedDate.toISOString().slice(0, 10);
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

  const { reservations, pendingRequests } = await loadDayConflicts(dateStr, [vehicleId]);
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
