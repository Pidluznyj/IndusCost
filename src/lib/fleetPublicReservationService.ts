import { randomBytes } from "node:crypto";
import type { FleetPublicReservationRequestStatus, FleetVehicle } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { loadFleetSettings, writeFleetAuditLog } from "@/src/lib/fleetService.js";
import {
  FleetValidationError,
  assertDateRange,
  assertDriverAuthorizedForReservation,
  assertVehicleReservable,
  computeCnhStatus,
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
  buildFleetReservationLocalDateTime,
  combineDateAndTimeLocal,
  dateOnlyToYmd,
  filterPastSlotsForToday,
  formatFleetLocalDate,
  formatWeekdayDateLabel,
  parseLocalDateOnly,
  parseFleetPublicSlotConfig,
  type FleetPublicSlot,
} from "@/src/lib/fleetPublicReservationSlots.js";
import {
  assertValidPublicCpf,
  driverNeedsPublicApproval,
  driverPublicApprovalStatus,
  getPublicDriverOrThrow,
  identifyPublicDriverByCpf,
  publicRequestAwaitingDriverApproval,
  publicRequestAwaitingReservationApproval,
  registerPublicDriver,
  resolveInitialPublicRequestStatus,
  type PublicRegisterInput,
} from "@/src/lib/fleetPublicReservationDriverOps.js";
import { FleetBusinessError } from "@/src/lib/fleetErrors.js";
import { maskCpfForDisplay } from "@/src/lib/fleetCpfUtils.js";
import {
  buildPublicReservationShareLinks,
  buildPublicReservationUrl,
  normalizePublicReservationSlug,
  publicReservationPathMatchesSlug,
  resolvePublicReservationBaseUrl,
  validatePublicReservationSlug,
  FLEET_PUBLIC_RESERVATION_PATH,
} from "@/src/lib/fleetPublicReservationLink.js";

export { buildPublicReservationUrl } from "@/src/lib/fleetPublicReservationLink.js";

export { identifyPublicDriverByCpf, registerPublicDriver };
export type { PublicRegisterInput };

export const FLEET_PUBLIC_SETTINGS_KEYS = [
  "publicReservationEnabled",
  "publicReservationBaseUrl",
  "publicReservationSlug",
  "publicReservationToken",
  "publicReservationTitle",
  "publicReservationInstructions",
  "publicReservationSlotMinutes",
  "publicReservationStartHour",
  "publicReservationEndHour",
] as const;

export const FLEET_PUBLIC_ACTIVE_REQUEST_STATUSES: FleetPublicReservationRequestStatus[] = [
  "PENDING",
  "PENDING_DRIVER_APPROVAL",
  "PENDING_RESERVATION_APPROVAL",
];

export const FLEET_PUBLIC_PENDING_REVIEW_STATUSES: FleetPublicReservationRequestStatus[] = [
  "PENDING",
  "PENDING_DRIVER_APPROVAL",
  "PENDING_RESERVATION_APPROVAL",
];

export function serializePublicRequestDriver(
  driver: {
    id: string;
    name: string;
    cpf: string;
    cnhNumber: string | null;
    cnhCategory: string | null;
    cnhExpirationDate: Date | null;
    status: string;
    createdFromPublicReservation?: boolean;
    publicRegistrationRejectionReason?: string | null;
  } | null
) {
  if (!driver) return null;
  return {
    ...driver,
    approvalStatus: driverPublicApprovalStatus({
      status: driver.status as "AUTHORIZED" | "PENDING" | "BLOCKED" | "INACTIVE",
      cnhNumber: driver.cnhNumber,
      cnhExpirationDate: driver.cnhExpirationDate,
      createdFromPublicReservation: driver.createdFromPublicReservation ?? false,
      publicRegistrationRejectionReason: driver.publicRegistrationRejectionReason ?? null,
    }),
    needsPublicApproval: driverNeedsPublicApproval({
      status: driver.status as "AUTHORIZED" | "PENDING" | "BLOCKED" | "INACTIVE",
      cnhNumber: driver.cnhNumber,
      cnhExpirationDate: driver.cnhExpirationDate,
      createdFromPublicReservation: driver.createdFromPublicReservation ?? false,
      publicRegistrationRejectionReason: driver.publicRegistrationRejectionReason ?? null,
    }),
  };
}

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

/** Veículo apto para aparecer no fluxo público (reutiliza isVehicleReservable). */
export function isPublicReservationVehicleEligible(
  status: Parameters<typeof isVehicleReservable>[0]
): boolean {
  return isVehicleReservable(status);
}

export function serializePublicRequestItem<
  T extends {
    requestedDate: Date;
    driver?: Parameters<typeof serializePublicRequestDriver>[0];
  }
>(item: T) {
  return {
    ...item,
    requestedDate: dateOnlyToYmd(item.requestedDate),
    requestedDateLabel: formatFleetLocalDate(item.requestedDate),
    driver: item.driver ? serializePublicRequestDriver(item.driver) : item.driver,
  };
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
    where: vehicleId ? { id: vehicleId } : { status: "AVAILABLE" },
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
  return vehicles.filter((v) => isPublicReservationVehicleEligible(v.status));
}

async function assertPublicReservationVehicleOrThrow(vehicleId: string) {
  const vehicle = await prisma.fleetVehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, brand: true, model: true, vehicleType: true, status: true, plate: true, notes: true },
  });
  if (!vehicle || !isPublicReservationVehicleEligible(vehicle.status)) {
    throw new FleetBusinessError("Veículo não disponível para solicitação pública.", {
      httpStatus: 422,
      code: "FLEET_VEHICLE_NOT_ELIGIBLE",
    });
  }
  assertVehicleReservable(vehicle);
  return vehicle;
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
    const rDate = dateOnlyToYmd(r.requestedDate);
    const rStart = combineDateAndTimeLocal(rDate, r.startTime);
    const rEnd = combineDateAndTimeLocal(rDate, r.endTime);
    return reservationPeriodsOverlap(start, end, rStart, rEnd);
  });
}

async function loadDayConflicts(dateStr: string, vehicleId: string) {
  const dayStart = combineDateAndTimeLocal(dateStr, "00:00");
  const dayEnd = combineDateAndTimeLocal(dateStr, "23:59");
  const requestedDate = parseLocalDateOnly(dateStr);

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
  const dateObjs = dates.map((d) => parseLocalDateOnly(d)!).filter(Boolean);

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
    (r) => dateOnlyToYmd(r.requestedDate) === dateStr
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

  await assertPublicReservationVehicleOrThrow(vid);

  const fromDate = parseLocalDateOnly(from);
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
    requiresDriverApproval: boolean;
    successMessage: string;
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
  if (!dateStr || !parseLocalDateOnly(dateStr)) {
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

  await assertPublicReservationVehicleOrThrow(vehicleId);

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

  const initialStatus = resolveInitialPublicRequestStatus(driver);
  const requiresDriverApproval = initialStatus === "PENDING_DRIVER_APPROVAL";
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
      requestedDate: parseLocalDateOnly(dateStr)!,
      startTime,
      endTime,
      reason,
      destination,
      notes,
      passengersCount,
      vehicleId,
      status: initialStatus,
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

  const successMessage = requiresDriverApproval
    ? "Sua solicitação foi enviada. Primeiro validaremos seu cadastro de motorista e depois a reserva do veículo."
    : "Sua solicitação foi enviada e será analisada pela equipe responsável.";

  return {
    ok: true as const,
    request: created,
    requiresDriverApproval,
    successMessage,
  };
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
            phone: true,
            email: true,
            cnhNumber: true,
            cnhCategory: true,
            cnhExpirationDate: true,
            status: true,
            createdFromPublicReservation: true,
            publicRegistrationRejectionReason: true,
          },
        },
        vehicle: {
          select: { id: true, brand: true, model: true, vehicleType: true, plate: true, status: true },
        },
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
          phone: true,
          email: true,
          cnhNumber: true,
          cnhCategory: true,
          cnhExpirationDate: true,
          status: true,
          createdFromPublicReservation: true,
          publicRegistrationRejectionReason: true,
        },
      },
      vehicle: { select: { id: true, brand: true, model: true, vehicleType: true, plate: true } },
      fleetReservation: { select: { id: true, status: true } },
    },
  });
  if (!row) throw new FleetValidationError("Solicitação não encontrada.");
  return row;
}

const DRIVER_SELECT = {
  id: true,
  name: true,
  cpf: true,
  phone: true,
  email: true,
  cnhNumber: true,
  cnhCategory: true,
  cnhExpirationDate: true,
  status: true,
  createdFromPublicReservation: true,
  publicRegistrationRejectionReason: true,
} as const;

function assertDriverReadyForPublicReservationApproval(
  driver: NonNullable<Awaited<ReturnType<typeof getPublicReservationRequestOrThrow>>["driver"]>
): void {
  if (driverNeedsPublicApproval(driver)) {
    throw new FleetBusinessError(
      "Aprove o cadastro do motorista antes de aprovar a reserva.",
      { httpStatus: 409, code: "FLEET_DRIVER_APPROVAL_REQUIRED" }
    );
  }
  assertDriverAuthorizedForReservation(driver, { requireAuthorized: true });
}

export async function approvePublicReservationDriver(input: {
  id: string;
  reviewedByUserId: string | null;
  reviewedByLabel: string | null;
}) {
  const existing = await getPublicReservationRequestOrThrow(input.id);
  if (!publicRequestAwaitingDriverApproval(existing.status)) {
    throw new FleetValidationError(
      "Somente solicitações aguardando aprovação do motorista podem ser aprovadas nesta etapa."
    );
  }
  if (!existing.driverId || !existing.driver) {
    throw new FleetValidationError("Motorista da solicitação não encontrado.");
  }

  const driver = existing.driver;
  if (!driver.cnhNumber?.trim()) {
    throw new FleetValidationError("CNH do motorista é obrigatória para aprovação.");
  }
  if (computeCnhStatus(driver.cnhExpirationDate, 0) === "EXPIRED") {
    throw new FleetValidationError("CNH vencida — regularize antes de aprovar o motorista.");
  }

  const reviewedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await tx.fleetDriver.update({
      where: { id: driver.id },
      data: {
        status: "AUTHORIZED",
        publicRegistrationReviewedAt: reviewedAt,
        publicRegistrationReviewedByUserId: input.reviewedByUserId,
        publicRegistrationRejectionReason: null,
      },
    });

    const updated = await tx.fleetPublicReservationRequest.update({
      where: { id: existing.id },
      data: { status: "PENDING_RESERVATION_APPROVAL" },
      include: {
        driver: { select: DRIVER_SELECT },
        vehicle: {
          select: { id: true, brand: true, model: true, vehicleType: true, plate: true, status: true },
        },
        fleetReservation: { select: { id: true, status: true } },
      },
    });

    return updated;
  });

  await writeFleetAuditLog({
    entityType: "FleetPublicReservationRequest",
    entityId: existing.id,
    action: "APPROVE_DRIVER",
    oldValue: "PENDING_DRIVER_APPROVAL",
    newValue: "PENDING_RESERVATION_APPROVAL",
    userId: input.reviewedByUserId,
  });

  await writeFleetAuditLog({
    entityType: "FleetDriver",
    entityId: driver.id,
    action: "PUBLIC_REGISTER_APPROVE",
    oldValue: driver.status,
    newValue: "AUTHORIZED",
    userId: input.reviewedByUserId,
  });

  return { request: result };
}

export async function rejectPublicReservationDriver(input: {
  id: string;
  reason: string;
  reviewedByUserId: string | null;
}) {
  const existing = await getPublicReservationRequestOrThrow(input.id);
  if (!publicRequestAwaitingDriverApproval(existing.status)) {
    throw new FleetValidationError(
      "Somente solicitações aguardando aprovação do motorista podem ser rejeitadas nesta etapa."
    );
  }
  if (!existing.driverId || !existing.driver) {
    throw new FleetValidationError("Motorista da solicitação não encontrado.");
  }

  const reason = assertReasonRequired(input.reason, "Motivo da rejeição do motorista");
  const reviewedAt = new Date();
  const driver = existing.driver;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.fleetDriver.update({
      where: { id: driver.id },
      data: {
        status: "BLOCKED",
        publicRegistrationReviewedAt: reviewedAt,
        publicRegistrationReviewedByUserId: input.reviewedByUserId,
        publicRegistrationRejectionReason: reason,
      },
    });

    return tx.fleetPublicReservationRequest.update({
      where: { id: existing.id },
      data: {
        status: "REJECTED",
        reviewComment: reason,
        reviewedByUserId: input.reviewedByUserId,
        reviewedAt,
      },
      include: {
        driver: { select: DRIVER_SELECT },
        vehicle: {
          select: { id: true, brand: true, model: true, vehicleType: true, plate: true, status: true },
        },
        fleetReservation: { select: { id: true, status: true } },
      },
    });
  });

  await writeFleetAuditLog({
    entityType: "FleetPublicReservationRequest",
    entityId: existing.id,
    action: "REJECT_DRIVER",
    oldValue: "PENDING_DRIVER_APPROVAL",
    newValue: "REJECTED",
    reason,
    userId: input.reviewedByUserId,
  });

  return { request: updated };
}

export async function approvePublicReservationRequest(input: {
  id: string;
  vehicleId: string;
  driverId: string;
  reviewedByUserId: string | null;
  reviewedByLabel: string | null;
}) {
  const existing = await getPublicReservationRequestOrThrow(input.id);
  if (publicRequestAwaitingDriverApproval(existing.status)) {
    throw new FleetBusinessError(
      "Aprove o cadastro do motorista antes de aprovar a reserva.",
      { httpStatus: 409, code: "FLEET_DRIVER_APPROVAL_REQUIRED" }
    );
  }
  if (!publicRequestAwaitingReservationApproval(existing.status)) {
    throw new FleetValidationError("Somente solicitações aguardando aprovação da reserva podem ser aprovadas.");
  }

  const vehicleId = input.vehicleId?.trim() || existing.vehicleId?.trim();
  const driverId = input.driverId?.trim() || existing.driverId?.trim();
  if (!vehicleId) throw new FleetValidationError("Selecione o veículo para aprovar.");
  if (!driverId) throw new FleetValidationError("Selecione o motorista para aprovar.");

  const driverRow =
    existing.driver ??
    (await prisma.fleetDriver.findUnique({
      where: { id: driverId },
      select: DRIVER_SELECT,
    }));
  if (!driverRow) throw new FleetValidationError("Motorista não encontrado.");
  assertDriverReadyForPublicReservationApproval(driverRow);

  const dateStr = dateOnlyToYmd(existing.requestedDate);
  const startDateTime = buildFleetReservationLocalDateTime(dateStr, existing.startTime);
  const endDateTime = buildFleetReservationLocalDateTime(dateStr, existing.endTime);
  assertDateRange(startDateTime, endDateTime, "Reserva");

  await validateReservationFull({
    vehicleId,
    driverId,
    startDateTime,
    endDateTime,
    excludeReservationId: undefined,
  });

  try {
    await assertPublicReservationVehicleOrThrow(vehicleId);
  } catch (e) {
    if (e instanceof FleetBusinessError) {
      throw new FleetBusinessError(
        "Veículo não está mais disponível para aprovação. Verifique o status do veículo.",
        { httpStatus: 422, code: "FLEET_VEHICLE_NOT_ELIGIBLE" }
      );
    }
    throw e;
  }

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
        vehicle: {
          select: { id: true, brand: true, model: true, vehicleType: true, plate: true, status: true },
        },
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
    oldValue: existing.status,
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
  if (publicRequestAwaitingDriverApproval(existing.status)) {
    throw new FleetValidationError(
      "Rejeite o cadastro do motorista nesta etapa — a solicitação ainda aguarda aprovação do condutor."
    );
  }
  if (!publicRequestAwaitingReservationApproval(existing.status)) {
    throw new FleetValidationError("Somente solicitações aguardando aprovação da reserva podem ser rejeitadas.");
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
    oldValue: existing.status,
    newValue: "REJECTED",
    reason,
    userId: input.reviewedByUserId,
  });

  return updated;
}

export async function getInternalPublicReservationLink(requestOrigin?: string) {
  const settings = await loadFleetSettings();
  const token = settings.publicReservationToken?.trim();
  const enabled = settings.publicReservationEnabled === "true";
  const baseUrl = resolvePublicReservationBaseUrl(settings, requestOrigin);
  const configuredBase = settings.publicReservationBaseUrl?.trim() || null;
  const slug =
    normalizePublicReservationSlug(settings.publicReservationSlug) ||
    normalizePublicReservationSlug("reservar-carro");

  const links = buildPublicReservationShareLinks({ token, baseUrl, slug });

  return {
    enabled,
    token: token || null,
    baseUrl,
    configuredBaseUrl: configuredBase,
    slug: links.slug,
    shortPath: links.shortPath,
    shortUrl: links.shortUrl,
    technicalPath: links.technicalPath,
    technicalUrl: links.technicalUrl,
    url: links.shareUrl,
    shareUrl: links.shareUrl,
    needsBaseUrlConfig: !baseUrl,
  };
}

export type PublicReservationSlugResolveFailure = {
  ok: false;
  reason: "disabled" | "not_found" | "invalid_slug";
};

export type PublicReservationSlugResolveSuccess = {
  ok: true;
  enabled: true;
  targetPath: string;
  targetUrl: string | null;
};

export async function resolvePublicReservationLinkBySlug(
  slugParam: string,
  requestOrigin?: string | null
): Promise<PublicReservationSlugResolveFailure | PublicReservationSlugResolveSuccess> {
  const validation = validatePublicReservationSlug(slugParam);
  if (!validation.ok) {
    return { ok: false, reason: "invalid_slug" };
  }

  const settings = await loadFleetSettings();
  if (settings.publicReservationEnabled !== "true") {
    return { ok: false, reason: "disabled" };
  }

  const configuredSlug = normalizePublicReservationSlug(settings.publicReservationSlug);
  if (!configuredSlug || validation.slug !== configuredSlug) {
    return { ok: false, reason: "not_found" };
  }

  const token = settings.publicReservationToken?.trim();
  if (!token || token.length < 32) {
    return { ok: false, reason: "not_found" };
  }

  const baseUrl = resolvePublicReservationBaseUrl(settings, requestOrigin);
  const targetPath = `${FLEET_PUBLIC_RESERVATION_PATH}/${token}`;
  const targetUrl = baseUrl ? `${baseUrl}${targetPath}` : targetPath;

  return { ok: true, enabled: true, targetPath, targetUrl };
}

export async function tryPublicReservationShortLinkRedirect(
  requestPath: string
): Promise<string | null> {
  const settings = await loadFleetSettings();
  if (settings.publicReservationEnabled !== "true") return null;

  const slug = normalizePublicReservationSlug(settings.publicReservationSlug);
  if (!slug || !publicReservationPathMatchesSlug(requestPath, slug)) return null;

  const token = settings.publicReservationToken?.trim();
  if (!token || token.length < 32) return null;

  return `${FLEET_PUBLIC_RESERVATION_PATH}/${token}`;
}
