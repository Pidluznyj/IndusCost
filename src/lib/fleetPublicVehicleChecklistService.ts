import type { FleetReservationChecklistType } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { writeFleetAuditLog } from "@/src/lib/fleetService.js";
import {
  FleetValidationError,
  assertKmRange,
  assertNonNegativeKm,
} from "@/src/lib/fleetValidation.js";
import { maskCpfForDisplay } from "@/src/lib/fleetCpfUtils.js";
import { recalculateVehicleOperationalStatus } from "@/src/lib/fleetVehicleStatusOps.js";
import { computeKmDriven } from "@/src/lib/fleetValidation.js";
import { formatPublicVehicleLabel } from "@/src/lib/fleetPublicReservationService.js";
import {
  FLEET_VEHICLE_CHECKLIST_TEMPLATE,
  FLEET_VEHICLE_CHECKLIST_RESPONSIBILITY_TEXT,
} from "@/src/lib/fleetVehicleChecklistTemplate.js";
import {
  assertValidVehicleChecklistCpf,
  buildChecklistItemsForDb,
  deriveReservationChecklistState,
  listCompatibleReservationsForChecklist,
  parseSubmitChecklistBody,
  resolveReservationChecklistMode,
  resolveVehicleByChecklistToken,
  serializeReservationChecklist,
  CHECKLIST_INCLUDE,
} from "@/src/lib/fleetVehicleChecklistOps.js";

const AUTO_CHECKOUT_NOTES =
  "Devolução presumida por novo check-in de outra reserva no mesmo veículo.";

export async function getPublicVehicleChecklistConfig(publicToken: string) {
  const resolved = await resolveVehicleByChecklistToken(publicToken);
  if (resolved.ok === false) {
    if (resolved.reason === "revoked") {
      return { ok: false as const, reason: "revoked" as const };
    }
    if (resolved.reason === "vehicle_unavailable") {
      return { ok: false as const, reason: "vehicle_unavailable" as const };
    }
    return { ok: false as const, reason: "invalid" as const };
  }

  const v = resolved.vehicle;
  return {
    ok: true as const,
    vehicle: {
      id: v.id,
      label: formatPublicVehicleLabel(v),
      plate: v.plate,
      brand: v.brand,
      model: v.model,
    },
    template: FLEET_VEHICLE_CHECKLIST_TEMPLATE,
    itemStatuses: ["OK", "ATENCAO", "AVARIA", "NAO_SE_APLICA"],
    responsibilityText: FLEET_VEHICLE_CHECKLIST_RESPONSIBILITY_TEXT,
    fuelLevelHint: "Ex.: Cheio, 3/4, 1/2, 1/4, Reserva",
  };
}

export async function identifyPublicVehicleChecklistDriver(
  publicToken: string,
  cpf: unknown
) {
  const resolved = await resolveVehicleByChecklistToken(publicToken);
  if (resolved.ok === false) {
    return { ok: false as const, reason: resolved.reason };
  }

  const cpfDigits = assertValidVehicleChecklistCpf(cpf);

  const driver = await prisma.fleetDriver.findFirst({
    where: { cpf: cpfDigits },
    select: { id: true, name: true, cpf: true, status: true },
  });

  if (!driver) {
    return {
      ok: true as const,
      found: false as const,
      message: "CPF não encontrado. Solicite seu cadastro à equipe de frota.",
    };
  }

  const reservations = await listCompatibleReservationsForChecklist({
    vehicleId: resolved.vehicle.id,
    cpfDigits,
  });

  return {
    ok: true as const,
    found: true as const,
    driver: {
      id: driver.id,
      name: driver.name,
      cpfMasked: maskCpfForDisplay(driver.cpf),
    },
    reservations,
    requiresSelection: reservations.length > 1,
    message:
      reservations.length === 0
        ? "Nenhuma reserva compatível neste veículo para o horário atual."
        : null,
  };
}

async function assertReservationForSubmit(input: {
  vehicleId: string;
  reservationId: string;
  cpfDigits: string;
  expectedMode: FleetReservationChecklistType;
  now: Date;
}) {
  const reservation = await prisma.fleetReservation.findUnique({
    where: { id: input.reservationId },
    include: {
      driver: { select: { id: true, cpf: true, name: true } },
      vehicle: { select: { id: true, status: true, currentKm: true } },
      usage: true,
      reservationChecklists: {
        where: { status: "COMPLETED" },
        select: { type: true, completedAt: true },
      },
    },
  });

  if (!reservation) throw new FleetValidationError("Reserva não encontrada.");
  if (reservation.vehicleId !== input.vehicleId) {
    throw new FleetValidationError("Reserva não pertence a este veículo.");
  }
  if (!reservation.driver || reservation.driver.cpf !== input.cpfDigits) {
    throw new FleetValidationError("CPF não corresponde ao condutor desta reserva.");
  }

  const state = deriveReservationChecklistState(reservation.reservationChecklists);
  const mode = resolveReservationChecklistMode(reservation, state, input.now);
  const expectedUiMode = input.expectedMode === "CHECK_IN" ? "CHECK_IN" : "CHECK_OUT";

  if (!mode || mode !== expectedUiMode) {
    if (state.hasCheckIn && input.expectedMode === "CHECK_IN") {
      throw new FleetValidationError("Check-in já registrado para esta reserva.");
    }
    if (state.hasCheckOut) {
      throw new FleetValidationError("Check-out já registrado para esta reserva.");
    }
    if (!state.hasCheckIn && input.expectedMode === "CHECK_OUT") {
      throw new FleetValidationError("Check-out não permitido sem check-in prévio.");
    }
    throw new FleetValidationError("Reserva indisponível para checklist neste horário.");
  }

  return { reservation, state };
}

async function performAutoCheckOutForOpenUsages(input: {
  vehicleId: string;
  excludeReservationId: string;
  triggeredByChecklistId: string;
  now: Date;
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
}) {
  const openUsages = await input.tx.fleetUsage.findMany({
    where: {
      vehicleId: input.vehicleId,
      status: "CHECKED_OUT",
      checkinAt: null,
      reservationId: { not: input.excludeReservationId },
    },
    include: {
      reservation: {
        include: {
          driver: { select: { id: true, name: true, cpf: true } },
          reservationChecklists: {
            where: { status: "COMPLETED", type: "CHECK_IN" },
            take: 1,
          },
        },
      },
      vehicle: { select: { currentKm: true } },
    },
  });

  const created: string[] = [];

  for (const usage of openUsages) {
    const res = usage.reservation;
    const state = deriveReservationChecklistState(
      await input.tx.fleetReservationChecklist.findMany({
        where: { reservationId: res.id, status: "COMPLETED" },
        select: { type: true },
      })
    );
    if (!state.hasCheckIn || state.hasCheckOut) continue;

    const odometer = Number(usage.checkoutKm ?? usage.vehicle.currentKm ?? 0);
    const driver = res.driver;

    const autoChecklist = await input.tx.fleetReservationChecklist.create({
      data: {
        reservationId: res.id,
        vehicleId: input.vehicleId,
        driverId: driver?.id ?? null,
        type: "AUTO_CHECK_OUT",
        source: "AUTO_FROM_NEXT_CHECKIN",
        status: "COMPLETED",
        odometer,
        fuelLevel: usage.checkoutFuelLevel,
        generalNotes: AUTO_CHECKOUT_NOTES,
        responsibilityAccepted: false,
        completedAt: input.now,
        completedByCpf: null,
        completedByName: "Sistema — devolução presumida",
        triggeredByChecklistId: input.triggeredByChecklistId,
        items: {
          create: FLEET_VEHICLE_CHECKLIST_TEMPLATE.map((t) => ({
            code: t.code,
            label: t.label,
            status: "NAO_SE_APLICA",
            notes: AUTO_CHECKOUT_NOTES,
          })),
        },
      },
    });
    created.push(autoChecklist.id);

    await input.tx.fleetUsage.update({
      where: { id: usage.id },
      data: {
        checkinAt: input.now,
        checkinKm: odometer,
        checkinFuelLevel: usage.checkoutFuelLevel,
        checkinNotes: AUTO_CHECKOUT_NOTES,
        kmDriven: 0,
        status: "CHECKED_IN",
      },
    });

    await input.tx.fleetReservation.update({
      where: { id: res.id },
      data: { status: "FINISHED" },
    });
  }

  return created;
}

export async function submitPublicVehicleChecklist(publicToken: string, body: Record<string, unknown>) {
  const resolved = await resolveVehicleByChecklistToken(publicToken);
  if (resolved.ok === false) {
    return { ok: false as const, reason: resolved.reason };
  }

  const parsed = parseSubmitChecklistBody(body);
  const now = new Date();

  const compatible = await listCompatibleReservationsForChecklist({
    vehicleId: resolved.vehicle.id,
    cpfDigits: parsed.cpf,
    now,
  });
  const selected = compatible.find((r) => r.reservationId === parsed.reservationId);
  if (!selected) {
    throw new FleetValidationError("Reserva não disponível para checklist neste momento.");
  }

  const checklistType: FleetReservationChecklistType =
    selected.mode === "CHECK_IN" ? "CHECK_IN" : "CHECK_OUT";

  const { reservation } = await assertReservationForSubmit({
    vehicleId: resolved.vehicle.id,
    reservationId: parsed.reservationId,
    cpfDigits: parsed.cpf,
    expectedMode: checklistType,
    now,
  });

  const driver = reservation.driver!;
  const vehicleKm = Number(reservation.vehicle.currentKm);

  if (checklistType === "CHECK_IN") {
    if (parsed.odometer < vehicleKm) {
      throw new FleetValidationError("Odômetro não pode ser menor que o km atual do veículo.");
    }
  } else {
    const usage = reservation.usage;
    if (!usage || !usage.checkoutKm) {
      throw new FleetValidationError("Check-out não permitido sem check-in prévio.");
    }
    const checkoutKm = Number(usage.checkoutKm);
    assertKmRange(checkoutKm, parsed.odometer);
  }

  const itemRows = buildChecklistItemsForDb(parsed.items);

  const result = await prisma.$transaction(async (tx) => {
    const checklist = await tx.fleetReservationChecklist.create({
      data: {
        reservationId: reservation.id,
        vehicleId: resolved.vehicle.id,
        driverId: driver.id,
        type: checklistType,
        source: "PUBLIC_QR",
        status: "COMPLETED",
        odometer: parsed.odometer,
        fuelLevel: parsed.fuelLevel,
        generalNotes: parsed.generalNotes,
        responsibilityAccepted: true,
        completedAt: now,
        completedByCpf: parsed.cpf,
        completedByName: driver.name,
        items: { create: itemRows },
      },
      include: CHECKLIST_INCLUDE,
    });

    if (checklistType === "CHECK_IN") {
      const autoIds = await performAutoCheckOutForOpenUsages({
        vehicleId: resolved.vehicle.id,
        excludeReservationId: reservation.id,
        triggeredByChecklistId: checklist.id,
        now,
        tx,
      });

      const existingUsage = await tx.fleetUsage.findUnique({
        where: { reservationId: reservation.id },
      });
      if (existingUsage) {
        throw new FleetValidationError("Check-in já registrado para esta reserva.");
      }

      await tx.fleetUsage.create({
        data: {
          reservationId: reservation.id,
          vehicleId: resolved.vehicle.id,
          driverId: driver.id,
          checkoutAt: now,
          checkoutKm: parsed.odometer,
          checkoutFuelLevel: parsed.fuelLevel,
          checkoutNotes: parsed.generalNotes,
          status: "CHECKED_OUT",
        },
      });

      await tx.fleetReservation.update({
        where: { id: reservation.id },
        data: { status: "IN_USE" },
      });

      await tx.fleetVehicle.update({
        where: { id: resolved.vehicle.id },
        data: { currentKm: parsed.odometer },
      });

      return { checklist, autoIds, mode: "CHECK_IN" as const };
    }

    const usage = reservation.usage!;
    const checkoutKm = Number(usage.checkoutKm);
    const kmDriven = computeKmDriven(checkoutKm, parsed.odometer);

    await tx.fleetUsage.update({
      where: { id: usage.id },
      data: {
        checkinAt: now,
        checkinKm: parsed.odometer,
        checkinFuelLevel: parsed.fuelLevel,
        checkinNotes: parsed.generalNotes,
        kmDriven,
        status: "CHECKED_IN",
      },
    });

    await tx.fleetReservation.update({
      where: { id: reservation.id },
      data: { status: "FINISHED" },
    });

    await tx.fleetVehicle.update({
      where: { id: resolved.vehicle.id },
      data: { currentKm: parsed.odometer },
    });

    return { checklist, autoIds: [] as string[], mode: "CHECK_OUT" as const, kmDriven };
  });

  await recalculateVehicleOperationalStatus(resolved.vehicle.id, {
    trigger: result.mode === "CHECK_IN" ? "CHECKOUT" : "CHECKIN",
    userId: null,
    reason: `Checklist público QR — ${result.mode}`,
  });

  await writeFleetAuditLog({
    entityType: "FleetReservationChecklist",
    entityId: result.checklist.id,
    action: result.mode === "CHECK_IN" ? "PUBLIC_CHECK_IN" : "PUBLIC_CHECK_OUT",
    newValue: String(parsed.odometer),
    reason: `CPF ${maskCpfForDisplay(parsed.cpf)}`,
    userId: null,
  });

  for (const autoId of result.autoIds) {
    await writeFleetAuditLog({
      entityType: "FleetReservationChecklist",
      entityId: autoId,
      action: "PRESUMED_CHECK_OUT",
      reason: `Provocado por check-in ${result.checklist.id}`,
      userId: null,
    });
  }

  return {
    ok: true as const,
    mode: result.mode,
    checklist: serializeReservationChecklist(result.checklist),
    autoCheckOutCount: result.autoIds.length,
    successMessage:
      result.mode === "CHECK_IN"
        ? "Check-in registrado com sucesso."
        : "Check-out registrado com sucesso.",
  };
}
