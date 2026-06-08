import type { FleetReservation, FleetReservationStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  FleetValidationError,
  assertDateRange,
  assertDriverAuthorizedForReservation,
  assertVehicleReservable,
  isVehicleReservable,
} from "@/src/lib/fleetValidation.js";
import { assertNoReservationOverlap, loadFleetSettings } from "@/src/lib/fleetService.js";
import { recalculateVehicleOperationalStatus } from "@/src/lib/fleetVehicleStatusOps.js";

const RESERVATION_INCLUDE = {
  vehicle: {
    select: {
      id: true,
      plate: true,
      brand: true,
      model: true,
      vehicleType: true,
      status: true,
      unit: true,
      costCenter: true,
      currentKm: true,
    },
  },
  driver: {
    select: {
      id: true,
      name: true,
      status: true,
      cnhExpirationDate: true,
      cnhCategory: true,
    },
  },
} as const;

export async function getReservationOrThrow(id: string) {
  const r = await prisma.fleetReservation.findUnique({
    where: { id },
    include: RESERVATION_INCLUDE,
  });
  if (!r) throw new FleetValidationError("Reserva não encontrada.");
  return r;
}

export function buildReservationWhere(query: {
  vehicleId?: string;
  driverId?: string;
  status?: string;
  start?: string;
  end?: string;
  requesterUserId?: string;
}): Prisma.FleetReservationWhereInput {
  const where: Prisma.FleetReservationWhereInput = {};
  if (query.vehicleId) where.vehicleId = query.vehicleId;
  if (query.driverId) where.driverId = query.driverId;
  if (query.status) where.status = query.status as FleetReservationStatus;
  if (query.requesterUserId) where.requesterUserId = query.requesterUserId;
  if (query.start || query.end) {
    const start = query.start ? new Date(query.start) : new Date(0);
    const end = query.end ? new Date(query.end) : new Date("2099-12-31");
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      where.AND = [{ startDateTime: { lt: end } }, { endDateTime: { gt: start } }];
    }
  }
  return where;
}

export async function validateReservationFull(input: {
  vehicleId: string;
  driverId: string | null;
  startDateTime: Date;
  endDateTime: Date;
  excludeReservationId?: string;
}) {
  assertDateRange(input.startDateTime, input.endDateTime, "Reserva");

  const vehicle = await prisma.fleetVehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw new FleetValidationError("Veículo não encontrado.");
  assertVehicleReservable(vehicle);

  const settings = await loadFleetSettings();
  if (settings.bloquearReservaDocumentoVencido === "true") {
    const expiredDoc = await prisma.fleetVehicleDocument.findFirst({
      where: { vehicleId: vehicle.id, status: "EXPIRED" },
    });
    if (expiredDoc) {
      throw new FleetValidationError("Documento vencido impede nova reserva para este veículo.");
    }
  }

  if (!input.driverId) {
    throw new FleetValidationError("Motorista é obrigatório para a reserva.");
  }
  const driver = await prisma.fleetDriver.findUnique({ where: { id: input.driverId } });
  if (!driver) throw new FleetValidationError("Motorista não encontrado.");
  assertDriverAuthorizedForReservation(driver, {
    blockExpiredCnh: settings.bloquearRetiradaCnhVencida !== "false",
    vehicleType: vehicle.vehicleType,
  });

  await assertNoReservationOverlap(
    input.vehicleId,
    input.startDateTime,
    input.endDateTime,
    input.excludeReservationId
  );
}

/** Atualiza status do veículo via recalc central (substitui matriz local legada). */
export async function syncVehicleStatusAfterReservationChange(
  vehicleId: string,
  options?: { userId?: string | null; trigger?: string }
) {
  await recalculateVehicleOperationalStatus(vehicleId, {
    trigger: options?.trigger ?? "SYNC_AFTER_RESERVATION",
    userId: options?.userId ?? null,
    reason: "Alteração de reserva — recalcular status operacional",
  });
}

export function canUserCancelReservation(
  reservation: Pick<FleetReservation, "requesterUserId" | "status">,
  userId: string | null,
  canManageFleet: boolean
): boolean {
  if (reservation.status === "IN_USE") return false;
  if (canManageFleet) return true;
  if (!userId) return false;
  if (reservation.requesterUserId !== userId) return false;
  return ["REQUESTED", "PENDING_APPROVAL", "APPROVED"].includes(reservation.status);
}

export async function listAvailableVehicles(params: {
  start: Date;
  end: Date;
  vehicleType?: string;
  unit?: string;
  costCenter?: string;
}) {
  assertDateRange(params.start, params.end);

  const where: Prisma.FleetVehicleWhereInput = {
    status: { in: ["AVAILABLE", "RESERVED"] },
  };
  if (params.vehicleType) where.vehicleType = { equals: params.vehicleType, mode: "insensitive" };
  if (params.unit) where.unit = { contains: params.unit, mode: "insensitive" };
  if (params.costCenter) where.costCenter = { contains: params.costCenter, mode: "insensitive" };

  const vehicles = await prisma.fleetVehicle.findMany({
    where,
    orderBy: [{ plate: "asc" }, { brand: "asc" }],
  });

  const available = [];
  for (const v of vehicles) {
    if (!isVehicleReservable(v.status) && v.status !== "RESERVED") continue;
    try {
      await assertNoReservationOverlap(v.id, params.start, params.end);
      available.push({
        id: v.id,
        plate: v.plate,
        brand: v.brand,
        model: v.model,
        vehicleType: v.vehicleType,
        status: v.status,
        unit: v.unit,
        costCenter: v.costCenter,
        currentKm: Number(v.currentKm),
      });
    } catch {
      /* conflito — não incluir */
    }
  }
  return available;
}

export { RESERVATION_INCLUDE };
