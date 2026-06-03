import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { loadFleetSettings, writeFleetAuditLog } from "@/src/lib/fleetService.js";
import {
  FleetValidationError,
  assertDriverAuthorizedForReservation,
  assertKmRange,
  assertNonNegativeKm,
  assertVehicleCanCheckout,
  computeKmDriven,
  hasCriticalNotOk,
  parseDecimalKm,
} from "@/src/lib/fleetValidation.js";
import { getReservationOrThrow, RESERVATION_INCLUDE } from "@/src/lib/fleetReservationOps.js";
import {
  applyCriticalChecklistOnCheckin,
  assertCompletedChecklistForPhase,
} from "@/src/lib/fleetChecklistOps.js";

export const USAGE_INCLUDE = {
  driver: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plate: true, brand: true, model: true, currentKm: true } },
  reservation: {
    select: {
      id: true,
      status: true,
      startDateTime: true,
      endDateTime: true,
      destination: true,
    },
  },
  checklists: {
    include: { items: true },
    orderBy: { createdAt: "desc" as const },
  },
} as const;

export function serializeUsage(
  usage: Prisma.FleetUsageGetPayload<{ include: typeof USAGE_INCLUDE }>
) {
  return {
    ...usage,
    checkoutKm: usage.checkoutKm != null ? Number(usage.checkoutKm) : null,
    checkinKm: usage.checkinKm != null ? Number(usage.checkinKm) : null,
    kmDriven: usage.kmDriven != null ? Number(usage.kmDriven) : null,
    checkoutAt: usage.checkoutAt?.toISOString() ?? null,
    checkinAt: usage.checkinAt?.toISOString() ?? null,
    createdAt: usage.createdAt.toISOString(),
    updatedAt: usage.updatedAt.toISOString(),
    vehicle: usage.vehicle
      ? { ...usage.vehicle, currentKm: Number(usage.vehicle.currentKm) }
      : usage.vehicle,
    reservation: usage.reservation
      ? {
          ...usage.reservation,
          startDateTime: usage.reservation.startDateTime.toISOString(),
          endDateTime: usage.reservation.endDateTime.toISOString(),
        }
      : usage.reservation,
  };
}

export async function getUsageByReservationId(reservationId: string) {
  const usage = await prisma.fleetUsage.findUnique({
    where: { reservationId },
    include: USAGE_INCLUDE,
  });
  if (!usage) throw new FleetValidationError("Uso da reserva não encontrado.");
  return serializeUsage(usage);
}

export async function performCheckout(input: {
  reservationId: string;
  body: Record<string, unknown>;
  userId: string | null;
  userLabel?: string | null;
}) {
  const reservation = await getReservationOrThrow(input.reservationId);
  if (reservation.status !== "APPROVED") {
    throw new FleetValidationError("Somente reserva aprovada pode ser retirada.");
  }

  const existingUsage = await prisma.fleetUsage.findUnique({
    where: { reservationId: input.reservationId },
  });
  if (existingUsage) {
    throw new FleetValidationError("Retirada já registrada para esta reserva.");
  }

  assertVehicleCanCheckout(reservation.vehicle.status);

  const settings = await loadFleetSettings();
  if (!reservation.driverId || !reservation.driver) {
    throw new FleetValidationError("Motorista é obrigatório para retirada.");
  }
  assertDriverAuthorizedForReservation(reservation.driver, {
    blockExpiredCnh: settings.bloquearRetiradaCnhVencida !== "false",
    vehicleType: reservation.vehicle.vehicleType,
  });

  const checkoutKm = parseDecimalKm(input.body.checkoutKm);
  if (checkoutKm == null) throw new FleetValidationError("Km de retirada é obrigatório.");
  assertNonNegativeKm(checkoutKm);
  const vehicleKm = Number(reservation.vehicle.currentKm);
  if (checkoutKm < vehicleKm) {
    throw new FleetValidationError(
      "Km de retirada não pode ser menor que km atual do veículo."
    );
  }

  const checklistId =
    typeof input.body.checklistId === "string" ? input.body.checklistId : null;
  await assertCompletedChecklistForPhase({
    settings,
    checklistType: "CHECKOUT",
    reservationId: input.reservationId,
    checklistId,
    blockCriticalOnCheckout: true,
  });

  const checkoutAtRaw = input.body.checkoutAt;
  const checkoutAt = checkoutAtRaw ? new Date(String(checkoutAtRaw)) : new Date();
  if (Number.isNaN(checkoutAt.getTime())) {
    throw new FleetValidationError("Data/hora de retirada inválida.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const usage = await tx.fleetUsage.create({
      data: {
        reservationId: input.reservationId,
        vehicleId: reservation.vehicleId,
        driverId: reservation.driverId,
        checkoutAt,
        checkoutKm,
        checkoutFuelLevel:
          typeof input.body.checkoutFuelLevel === "string"
            ? input.body.checkoutFuelLevel.trim() || null
            : null,
        checkoutNotes:
          typeof input.body.checkoutNotes === "string"
            ? input.body.checkoutNotes.trim() || null
            : null,
        status: "CHECKED_OUT",
      },
      include: USAGE_INCLUDE,
    });

    if (checklistId) {
      await tx.fleetChecklist.updateMany({
        where: { id: checklistId },
        data: { usageId: usage.id },
      });
    }

    const resUpdated = await tx.fleetReservation.update({
      where: { id: input.reservationId },
      data: { status: "IN_USE" },
      include: RESERVATION_INCLUDE,
    });

    await tx.fleetVehicle.update({
      where: { id: reservation.vehicleId },
      data: { status: "IN_USE", currentKm: checkoutKm },
    });

    return { usage, reservation: resUpdated };
  });

  await writeFleetAuditLog({
    entityType: "FleetUsage",
    entityId: result.usage.id,
    action: "CHECKOUT",
    newValue: String(checkoutKm),
    userId: input.userId,
  });
  await writeFleetAuditLog({
    entityType: "FleetVehicle",
    entityId: reservation.vehicleId,
    action: "KM_UPDATE",
    oldValue: String(vehicleKm),
    newValue: String(checkoutKm),
    userId: input.userId,
  });
  await writeFleetAuditLog({
    entityType: "FleetReservation",
    entityId: input.reservationId,
    action: "CHECKOUT",
    oldValue: "APPROVED",
    newValue: "IN_USE",
    userId: input.userId,
  });

  return {
    usage: serializeUsage(result.usage),
    reservation: result.reservation,
  };
}

export async function performCheckin(input: {
  reservationId: string;
  body: Record<string, unknown>;
  userId: string | null;
}) {
  const reservation = await prisma.fleetReservation.findUnique({
    where: { id: input.reservationId },
    include: {
      vehicle: true,
      usage: true,
      driver: true,
    },
  });
  if (!reservation) throw new FleetValidationError("Reserva não encontrada.");
  if (reservation.status !== "IN_USE" || !reservation.usage) {
    throw new FleetValidationError("Reserva não está em uso / sem retirada registrada.");
  }

  const checkinKm = parseDecimalKm(input.body.checkinKm);
  if (checkinKm == null) throw new FleetValidationError("Km de devolução é obrigatório.");
  const checkoutKm = Number(reservation.usage.checkoutKm ?? 0);
  assertKmRange(checkoutKm, checkinKm);
  const kmDriven = computeKmDriven(checkoutKm, checkinKm);

  const settings = await loadFleetSettings();
  const checklistId =
    typeof input.body.checklistId === "string" ? input.body.checklistId : null;
  const checklist = await assertCompletedChecklistForPhase({
    settings,
    checklistType: "CHECKIN",
    reservationId: input.reservationId,
    checklistId,
  });

  const checkinAtRaw = input.body.checkinAt;
  const checkinAt = checkinAtRaw ? new Date(String(checkinAtRaw)) : new Date();
  if (Number.isNaN(checkinAt.getTime())) {
    throw new FleetValidationError("Data/hora de devolução inválida.");
  }

  const manualPending = Boolean(input.body.hasPending);
  const criticalFail = checklist && hasCriticalNotOk(checklist.items);
  const hasPending = manualPending || criticalFail;

  const result = await prisma.$transaction(async (tx) => {
    const usage = await tx.fleetUsage.update({
      where: { id: reservation.usage!.id },
      data: {
        checkinAt,
        checkinKm,
        checkinFuelLevel:
          typeof input.body.checkinFuelLevel === "string"
            ? input.body.checkinFuelLevel.trim() || null
            : null,
        checkinNotes:
          typeof input.body.checkinNotes === "string"
            ? input.body.checkinNotes.trim() || null
            : null,
        kmDriven,
        status: "CHECKED_IN",
      },
      include: USAGE_INCLUDE,
    });

    if (checklistId) {
      await tx.fleetChecklist.updateMany({
        where: { id: checklistId },
        data: { usageId: usage.id },
      });
    }

    const resStatus = hasPending ? "FINISHED_WITH_PENDING" : "FINISHED";
    const resUpdated = await tx.fleetReservation.update({
      where: { id: input.reservationId },
      data: { status: resStatus },
      include: RESERVATION_INCLUDE,
    });

    let vehicleStatus: "AVAILABLE" | "BLOCKED" | "MAINTENANCE" = hasPending ? "BLOCKED" : "AVAILABLE";
    if (criticalFail) vehicleStatus = "BLOCKED";

    await tx.fleetVehicle.update({
      where: { id: reservation.vehicleId },
      data: {
        currentKm: checkinKm,
        status: vehicleStatus,
      },
    });

    return { usage, reservation: resUpdated, vehicleStatus };
  });

  const criticalResult = await applyCriticalChecklistOnCheckin({
    vehicleId: reservation.vehicleId,
    reservationId: input.reservationId,
    checklistId: checklist?.id ?? checklistId,
    userId: input.userId,
    currentKm: checkinKm,
  });

  await writeFleetAuditLog({
    entityType: "FleetUsage",
    entityId: result.usage.id,
    action: "CHECKIN",
    newValue: JSON.stringify({ checkinKm, kmDriven }),
    userId: input.userId,
  });
  await writeFleetAuditLog({
    entityType: "FleetVehicle",
    entityId: reservation.vehicleId,
    action: "KM_UPDATE",
    oldValue: String(checkoutKm),
    newValue: String(checkinKm),
    userId: input.userId,
  });
  await writeFleetAuditLog({
    entityType: "FleetReservation",
    entityId: input.reservationId,
    action: "CHECKIN",
    oldValue: "IN_USE",
    newValue: result.reservation.status,
    userId: input.userId,
  });

  return {
    usage: serializeUsage(result.usage),
    reservation: result.reservation,
    kmDriven,
    hasPending,
    criticalBlocked: criticalResult.blocked,
    maintenanceId: criticalResult.maintenanceId ?? null,
  };
}
