import { Prisma, type FleetReservationStatus, type FleetVehicleStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  FleetValidationError,
  assertContractDateRange,
  assertDateRange,
  assertDriverAuthorizedForReservation,
  assertKmRange,
  assertNonNegativeAmount,
  assertNonNegativeKm,
  assertVehicleReservable,
  findReservationConflict,
  isActiveDriverStatus,
  isActiveVehicleStatus,
  isCnhValid,
  normalizePlate,
  FLEET_ACTIVE_RESERVATION_STATUSES,
  parseDecimalKm,
} from "@/src/lib/fleetValidation.js";

export type FleetSettingsMap = Record<string, string>;

export async function loadFleetSettings(): Promise<FleetSettingsMap> {
  const rows = await prisma.fleetSettings.findMany();
  const map: FleetSettingsMap = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function writeFleetAuditLog(input: {
  entityType: string;
  entityId: string;
  action: string;
  oldValue?: string | null;
  newValue?: string | null;
  reason?: string | null;
  userId?: string | null;
}) {
  await prisma.fleetAuditLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      reason: input.reason ?? null,
      userId: input.userId ?? null,
    },
  });
}

export async function assertUniqueActivePlate(plate: string | null, excludeVehicleId?: string) {
  if (!plate) return;
  const existing = await prisma.fleetVehicle.findFirst({
    where: {
      plate,
      id: excludeVehicleId ? { not: excludeVehicleId } : undefined,
      status: { notIn: ["INACTIVE", "SOLD", "RETURNED"] },
    },
  });
  if (existing) {
    throw new FleetValidationError("Já existe veículo ativo com esta placa.");
  }
}

export async function assertUniqueActiveDriverCpf(cpf: string, excludeDriverId?: string) {
  const normalized = cpf.replace(/\D/g, "");
  const existing = await prisma.fleetDriver.findFirst({
    where: {
      cpf: normalized,
      id: excludeDriverId ? { not: excludeDriverId } : undefined,
      status: { not: "INACTIVE" },
    },
  });
  if (existing) {
    throw new FleetValidationError("Já existe motorista ativo com este CPF.");
  }
}

export async function assertNoReservationOverlap(
  vehicleId: string,
  start: Date,
  end: Date,
  excludeReservationId?: string
) {
  const conflicts = await prisma.fleetReservation.findMany({
    where: {
      vehicleId,
      status: { in: FLEET_ACTIVE_RESERVATION_STATUSES },
      id: excludeReservationId ? { not: excludeReservationId } : undefined,
    },
    select: { id: true, startDateTime: true, endDateTime: true },
  });
  const conflict = findReservationConflict(conflicts, start, end, excludeReservationId);
  if (conflict) {
    throw new FleetValidationError("Conflito de reserva: veículo já reservado neste período.");
  }
}

export async function validateReservationCreate(input: {
  vehicleId: string;
  driverId?: string | null;
  startDateTime: Date;
  endDateTime: Date;
  settings?: FleetSettingsMap;
}) {
  assertDateRange(input.startDateTime, input.endDateTime, "Reserva");

  const vehicle = await prisma.fleetVehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw new FleetValidationError("Veículo não encontrado.");
  assertVehicleReservable(vehicle);

  const settings = input.settings ?? (await loadFleetSettings());
  if (settings.bloquearReservaDocumentoVencido === "true") {
    const expiredDoc = await prisma.fleetVehicleDocument.findFirst({
      where: { vehicleId: vehicle.id, status: "EXPIRED" },
    });
    if (expiredDoc) {
      throw new FleetValidationError("Documento vencido impede nova reserva para este veículo.");
    }
  }

  if (input.driverId) {
    const driver = await prisma.fleetDriver.findUnique({ where: { id: input.driverId } });
    if (!driver) throw new FleetValidationError("Motorista não encontrado.");
    assertDriverAuthorizedForReservation(driver, {
      blockExpiredCnh: settings.bloquearRetiradaCnhVencida !== "false",
    });
  }

  await assertNoReservationOverlap(input.vehicleId, input.startDateTime, input.endDateTime);
}

export async function buildFleetDashboard() {
  const { buildFleetManagementDashboard } = await import("@/src/lib/fleetManagementOps.js");
  return buildFleetManagementDashboard();
}

export function serializeFleetVehicle(v: {
  currentKm: Prisma.Decimal;
  initialKm: Prisma.Decimal;
  [key: string]: unknown;
}) {
  return {
    ...v,
    currentKm: Number(v.currentKm),
    initialKm: Number(v.initialKm),
  };
}

export {
  FleetValidationError,
  normalizePlate,
  parseDecimalKm,
  assertNonNegativeKm,
  assertKmRange,
  assertDateRange,
  assertContractDateRange,
  assertNonNegativeAmount,
  isCnhValid,
  isActiveVehicleStatus,
  isActiveDriverStatus,
  findReservationConflict,
};
