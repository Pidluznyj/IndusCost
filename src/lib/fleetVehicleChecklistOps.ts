import { randomBytes } from "node:crypto";
import type {
  FleetReservation,
  FleetReservationChecklist,
  FleetReservationChecklistType,
  FleetReservationStatus,
  FleetVehicle,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { loadFleetSettings, writeFleetAuditLog } from "@/src/lib/fleetService.js";
import {
  FleetValidationError,
  FLEET_PUBLIC_HARD_BLOCKED_VEHICLE_STATUSES,
  assertNonNegativeKm,
  parseDecimalKm,
} from "@/src/lib/fleetValidation.js";
import { isValidCpf, normalizeCpfDigits } from "@/src/lib/fleetCpfUtils.js";
import { recalculateVehicleOperationalStatus } from "@/src/lib/fleetVehicleStatusOps.js";
import { computeKmDriven } from "@/src/lib/fleetValidation.js";
import {
  FLEET_VEHICLE_CHECKLIST_TEMPLATE,
  FLEET_VEHICLE_CHECKLIST_RESPONSIBILITY_TEXT,
  validateVehicleChecklistItems,
  type VehicleChecklistItemInput,
} from "@/src/lib/fleetVehicleChecklistTemplate.js";
import {
  buildVehicleChecklistPublicUrl,
  resolveVehicleChecklistBaseUrl,
} from "@/src/lib/fleetVehicleChecklistLink.js";

export const CHECK_IN_WINDOW_BEFORE_MS = 2 * 60 * 60 * 1000;
export const CHECK_OUT_WINDOW_AFTER_MS = 24 * 60 * 60 * 1000;

export const FLEET_VEHICLE_CHECKLIST_BLOCKED_RESERVATION_STATUSES: FleetReservationStatus[] = [
  "REJECTED",
  "CANCELED",
  "REQUESTED",
  "PENDING_APPROVAL",
  "NO_SHOW",
];

export type VehicleChecklistReservationMode = "CHECK_IN" | "CHECK_OUT";

export type ResolvedVehicleChecklistReservation = {
  reservationId: string;
  mode: VehicleChecklistReservationMode;
  startDateTime: string;
  endDateTime: string;
  destination: string | null;
  driverName: string;
  driverCpfMasked: string;
  hasCheckIn: boolean;
  hasCheckOut: boolean;
};

export function generateVehicleChecklistToken(): string {
  return randomBytes(32).toString("hex");
}

export function assertValidVehicleChecklistCpf(cpf: unknown): string {
  const digits = normalizeCpfDigits(typeof cpf === "string" ? cpf : "");
  if (!isValidCpf(digits)) {
    throw new FleetValidationError("CPF inválido.");
  }
  return digits;
}

export function isVehicleEligibleForPublicChecklist(
  status: FleetVehicle["status"]
): boolean {
  return !FLEET_PUBLIC_HARD_BLOCKED_VEHICLE_STATUSES.includes(status);
}

export type ReservationChecklistState = {
  hasCheckIn: boolean;
  hasCheckOut: boolean;
  checkInAt: Date | null;
};

export function deriveReservationChecklistState(
  checklists: Pick<FleetReservationChecklist, "type">[]
): ReservationChecklistState {
  const hasCheckIn = checklists.some((c) => c.type === "CHECK_IN");
  const hasCheckOut = checklists.some(
    (c) => c.type === "CHECK_OUT" || c.type === "AUTO_CHECK_OUT"
  );
  return { hasCheckIn, hasCheckOut, checkInAt: null };
}

export function resolveReservationChecklistMode(
  reservation: Pick<FleetReservation, "status" | "startDateTime" | "endDateTime">,
  state: ReservationChecklistState,
  now: Date = new Date()
): VehicleChecklistReservationMode | null {
  if (FLEET_VEHICLE_CHECKLIST_BLOCKED_RESERVATION_STATUSES.includes(reservation.status)) {
    return null;
  }

  const startMs = reservation.startDateTime.getTime();
  const endMs = reservation.endDateTime.getTime();
  const nowMs = now.getTime();

  if (!state.hasCheckIn) {
    if (reservation.status !== "APPROVED") return null;
    const windowStart = startMs - CHECK_IN_WINDOW_BEFORE_MS;
    if (nowMs < windowStart || nowMs > endMs) return null;
    return "CHECK_IN";
  }

  if (state.hasCheckOut) return null;
  if (reservation.status !== "IN_USE" && reservation.status !== "APPROVED") return null;
  const windowEnd = endMs + CHECK_OUT_WINDOW_AFTER_MS;
  if (nowMs > windowEnd) return null;
  return "CHECK_OUT";
}

export function buildChecklistItemsForDb(items: VehicleChecklistItemInput[]) {
  const byCode = new Map(items.map((i) => [i.code, i]));
  return FLEET_VEHICLE_CHECKLIST_TEMPLATE.map((t) => {
    const input = byCode.get(t.code)!;
    return {
      code: t.code,
      label: t.label,
      status: input.status,
      notes: input.notes?.trim() || null,
    };
  });
}

const CHECKLIST_INCLUDE = {
  items: { orderBy: { code: "asc" as const } },
  driver: { select: { id: true, name: true, cpf: true } },
  reservation: {
    select: {
      id: true,
      status: true,
      startDateTime: true,
      endDateTime: true,
      destination: true,
    },
  },
  vehicle: { select: { id: true, plate: true, brand: true, model: true } },
  triggeredByChecklist: { select: { id: true, type: true, reservationId: true } },
} as const;

type ReservationChecklistRow = Prisma.FleetReservationChecklistGetPayload<{
  include: typeof CHECKLIST_INCLUDE;
}>;

export function serializeReservationChecklist(row: ReservationChecklistRow) {
  return {
    ...row,
    odometer: Number(row.odometer),
    completedAt: row.completedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items: row.items.map((i) => ({
      ...i,
      createdAt: (i as { createdAt?: Date }).createdAt?.toISOString?.() ?? undefined,
      updatedAt: (i as { updatedAt?: Date }).updatedAt?.toISOString?.() ?? undefined,
    })),
    reservation: row.reservation
      ? {
          ...row.reservation,
          startDateTime: row.reservation.startDateTime.toISOString(),
          endDateTime: row.reservation.endDateTime.toISOString(),
        }
      : row.reservation,
  };
}

export async function resolveVehicleByChecklistToken(publicToken: string) {
  const token = publicToken?.trim();
  if (!token) return { ok: false as const, reason: "invalid" as const };

  const row = await prisma.fleetVehicleChecklistToken.findUnique({
    where: { publicToken: token },
    include: {
      vehicle: {
        select: {
          id: true,
          brand: true,
          model: true,
          plate: true,
          vehicleType: true,
          status: true,
        },
      },
    },
  });

  if (!row) return { ok: false as const, reason: "invalid" as const };
  if (row.status !== "ACTIVE") return { ok: false as const, reason: "revoked" as const };
  if (!isVehicleEligibleForPublicChecklist(row.vehicle.status)) {
    return { ok: false as const, reason: "vehicle_unavailable" as const };
  }

  return { ok: true as const, token: row, vehicle: row.vehicle };
}

export async function getVehicleChecklistTokenInfo(vehicleId: string, origin?: string | null) {
  const settings = await loadFleetSettings();
  const tokenRow = await prisma.fleetVehicleChecklistToken.findUnique({
    where: { vehicleId },
  });
  const baseUrl = resolveVehicleChecklistBaseUrl(settings.publicReservationBaseUrl, origin);
  const publicToken = tokenRow?.publicToken ?? null;
  return {
    vehicleId,
    hasToken: Boolean(publicToken),
    publicToken,
    status: tokenRow?.status ?? null,
    revokedAt: tokenRow?.revokedAt?.toISOString() ?? null,
    baseUrl,
    publicPath: publicToken ? `/public/fleet/vehicle-checklist/${publicToken}` : null,
    publicUrl: publicToken ? buildVehicleChecklistPublicUrl(publicToken, baseUrl) : null,
    globalEnabled: settings.publicReservationEnabled === "true",
  };
}

export async function ensureVehicleChecklistToken(vehicleId: string, userId: string | null) {
  const vehicle = await prisma.fleetVehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw new FleetValidationError("Veículo não encontrado.");

  const existing = await prisma.fleetVehicleChecklistToken.findUnique({ where: { vehicleId } });
  if (existing?.status === "ACTIVE" && existing.publicToken) {
    return existing;
  }

  const publicToken = generateVehicleChecklistToken();
  const row = await prisma.fleetVehicleChecklistToken.upsert({
    where: { vehicleId },
    create: {
      vehicleId,
      publicToken,
      status: "ACTIVE",
      createdByUserId: userId,
    },
    update: {
      publicToken,
      status: "ACTIVE",
      revokedAt: null,
    },
  });

  await writeFleetAuditLog({
    entityType: "FleetVehicleChecklistToken",
    entityId: row.id,
    action: existing ? "REGENERATE" : "CREATE",
    userId,
  });

  return row;
}

export async function regenerateVehicleChecklistToken(vehicleId: string, userId: string | null) {
  const publicToken = generateVehicleChecklistToken();
  const row = await prisma.fleetVehicleChecklistToken.upsert({
    where: { vehicleId },
    create: {
      vehicleId,
      publicToken,
      status: "ACTIVE",
      createdByUserId: userId,
    },
    update: {
      publicToken,
      status: "ACTIVE",
      revokedAt: null,
    },
  });

  await writeFleetAuditLog({
    entityType: "FleetVehicleChecklistToken",
    entityId: row.id,
    action: "REGENERATE",
    userId,
  });

  return row;
}

export async function revokeVehicleChecklistToken(vehicleId: string, userId: string | null) {
  const existing = await prisma.fleetVehicleChecklistToken.findUnique({ where: { vehicleId } });
  if (!existing) throw new FleetValidationError("Este veículo ainda não possui token de checklist.");

  const row = await prisma.fleetVehicleChecklistToken.update({
    where: { vehicleId },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  await writeFleetAuditLog({
    entityType: "FleetVehicleChecklistToken",
    entityId: row.id,
    action: "REVOKE",
    userId,
  });

  return row;
}

export async function listCompatibleReservationsForChecklist(input: {
  vehicleId: string;
  cpfDigits: string;
  now?: Date;
}): Promise<ResolvedVehicleChecklistReservation[]> {
  const driver = await prisma.fleetDriver.findFirst({
    where: { cpf: input.cpfDigits },
    select: { id: true, name: true, cpf: true, status: true },
  });
  if (!driver) return [];

  const now = input.now ?? new Date();
  const reservations = await prisma.fleetReservation.findMany({
    where: {
      vehicleId: input.vehicleId,
      driverId: driver.id,
      status: { in: ["APPROVED", "IN_USE"] },
    },
    include: {
      reservationChecklists: {
        where: { status: "COMPLETED" },
        select: { type: true, completedAt: true },
      },
    },
    orderBy: { startDateTime: "asc" },
  });

  const out: ResolvedVehicleChecklistReservation[] = [];
  for (const r of reservations) {
    const state = deriveReservationChecklistState(r.reservationChecklists);
    const checkInRow = r.reservationChecklists.find((c) => c.type === "CHECK_IN");
    state.checkInAt = checkInRow?.completedAt ?? null;
    const mode = resolveReservationChecklistMode(r, state, now);
    if (!mode) continue;
    out.push({
      reservationId: r.id,
      mode,
      startDateTime: r.startDateTime.toISOString(),
      endDateTime: r.endDateTime.toISOString(),
      destination: r.destination,
      driverName: driver.name,
      driverCpfMasked: `***.***.***-${driver.cpf.slice(9)}`,
      hasCheckIn: state.hasCheckIn,
      hasCheckOut: state.hasCheckOut,
    });
  }
  return out;
}

export function parseSubmitChecklistBody(body: Record<string, unknown>) {
  const cpf = assertValidVehicleChecklistCpf(body.cpf);
  const reservationId = typeof body.reservationId === "string" ? body.reservationId.trim() : "";
  if (!reservationId) throw new FleetValidationError("Reserva não informada.");

  const odometer = parseDecimalKm(body.odometer);
  if (odometer == null) throw new FleetValidationError("Odômetro é obrigatório.");
  assertNonNegativeKm(odometer);

  const fuelLevel =
    typeof body.fuelLevel === "string" ? body.fuelLevel.trim() || null : null;
  if (!fuelLevel) throw new FleetValidationError("Nível de combustível é obrigatório.");

  const generalNotes =
    typeof body.generalNotes === "string" ? body.generalNotes.trim() || null : null;
  if (generalNotes && generalNotes.length > 1000) {
    throw new FleetValidationError("Observação geral excede 1000 caracteres.");
  }

  const responsibilityAccepted = body.responsibilityAccepted === true;
  if (!responsibilityAccepted) {
    throw new FleetValidationError("É necessário aceitar a declaração de conferência do veículo.");
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: VehicleChecklistItemInput[] = rawItems.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      code: String(row.code ?? "").trim(),
      status: row.status as VehicleChecklistItemInput["status"],
      notes: typeof row.notes === "string" ? row.notes : null,
    };
  });

  const itemValidation = validateVehicleChecklistItems(items);
  if (itemValidation.ok === false) throw new FleetValidationError(itemValidation.message);

  return {
    cpf,
    reservationId,
    odometer,
    fuelLevel,
    generalNotes,
    responsibilityAccepted,
    items,
    responsibilityText: FLEET_VEHICLE_CHECKLIST_RESPONSIBILITY_TEXT,
  };
}

export async function listReservationChecklists(reservationId: string) {
  const rows = await prisma.fleetReservationChecklist.findMany({
    where: { reservationId },
    include: CHECKLIST_INCLUDE,
    orderBy: { completedAt: "desc" },
  });
  return rows.map((r) => serializeReservationChecklist(r));
}

export async function listVehicleReservationChecklists(vehicleId: string, limit = 50) {
  const rows = await prisma.fleetReservationChecklist.findMany({
    where: { vehicleId },
    include: CHECKLIST_INCLUDE,
    orderBy: { completedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => serializeReservationChecklist(r));
}

export function getReservationChecklistStatusLabel(input: {
  reservationStatus: FleetReservationStatus;
  hasCheckIn: boolean;
  hasCheckOut: boolean;
  hasAutoCheckOut: boolean;
}): string {
  if (input.hasAutoCheckOut) return "Check-out automático por novo check-in";
  if (input.hasCheckOut) return "Check-out realizado";
  if (input.hasCheckIn) return "Aguardando check-out";
  if (input.reservationStatus === "APPROVED") return "Aguardando check-in";
  if (input.reservationStatus === "IN_USE") return "Em uso — aguardando check-out";
  return "—";
}

export async function getReservationChecklistSummary(reservationId: string) {
  const checklists = await prisma.fleetReservationChecklist.findMany({
    where: { reservationId, status: "COMPLETED" },
    select: { type: true },
  });
  const state = deriveReservationChecklistState(checklists);
  const hasAutoCheckOut = checklists.some((c) => c.type === "AUTO_CHECK_OUT");
  const reservation = await prisma.fleetReservation.findUnique({
    where: { id: reservationId },
    select: { status: true },
  });
  return {
    ...state,
    hasAutoCheckOut,
    label: getReservationChecklistStatusLabel({
      reservationStatus: reservation?.status ?? "APPROVED",
      hasCheckIn: state.hasCheckIn,
      hasCheckOut: state.hasCheckOut,
      hasAutoCheckOut,
    }),
  };
}

export { CHECKLIST_INCLUDE, FLEET_VEHICLE_CHECKLIST_RESPONSIBILITY_TEXT };
