import type { FleetVehicleStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { writeFleetAuditLog } from "@/src/lib/fleetService.js";
import { resolveMaintenanceVehicleStatus } from "@/src/lib/fleetValidation.js";

export type FleetBlockerSummary = {
  type: "maintenance" | "incident" | "usage" | "reservation" | "admin_block";
  id: string;
  label: string;
};

export type RecalculateVehicleStatusResult = {
  previousStatus: FleetVehicleStatus;
  nextStatus: FleetVehicleStatus;
  changed: boolean;
  blockers: FleetBlockerSummary[];
};

const FROZEN_VEHICLE_STATUSES: FleetVehicleStatus[] = ["SOLD", "RETURNED", "INACTIVE"];

export function resolveOperationalStatusFromContext(input: {
  currentStatus: FleetVehicleStatus;
  blockers: FleetBlockerSummary[];
  blockingMaintenancePriority?: string | null;
  hasApprovedReservation?: boolean;
  hasManualAdminBlock?: boolean;
}): FleetVehicleStatus {
  const { currentStatus, blockers } = input;

  if (FROZEN_VEHICLE_STATUSES.includes(currentStatus)) {
    return currentStatus;
  }

  if (blockers.some((b) => b.type === "usage")) {
    return "IN_USE";
  }

  if (blockers.some((b) => b.type === "reservation" && b.label.includes("em uso"))) {
    return "IN_USE";
  }

  const maintBlockers = blockers.filter((b) => b.type === "maintenance");
  if (maintBlockers.length > 0) {
    const priority = input.blockingMaintenancePriority ?? "MEDIA";
    return resolveMaintenanceVehicleStatus(priority, true) ?? "MAINTENANCE";
  }

  if (blockers.some((b) => b.type === "incident")) {
    return "BLOCKED";
  }

  if (input.hasManualAdminBlock || blockers.some((b) => b.type === "admin_block")) {
    return "BLOCKED";
  }

  if (input.hasApprovedReservation) {
    return "RESERVED";
  }

  return "AVAILABLE";
}

export async function hasActiveManualVehicleBlock(vehicleId: string): Promise<boolean> {
  const logs = await prisma.fleetAuditLog.findMany({
    where: {
      entityType: "FleetVehicle",
      entityId: vehicleId,
      action: { in: ["BLOCK", "UNBLOCK"] },
    },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const latest = logs[0];
  return latest?.action === "BLOCK" && latest.newValue === "BLOCKED";
}

export async function collectActiveFleetBlockers(
  vehicleId: string,
  excludeMaintenanceId?: string
): Promise<FleetBlockerSummary[]> {
  const blockers: FleetBlockerSummary[] = [];

  const maintenances = await prisma.fleetMaintenance.findMany({
    where: {
      vehicleId,
      id: excludeMaintenanceId ? { not: excludeMaintenanceId } : undefined,
      blocksVehicle: true,
      status: { notIn: ["COMPLETED", "CANCELED"] },
    },
    orderBy: { openedAt: "desc" },
  });
  for (const m of maintenances) {
    blockers.push({
      type: "maintenance",
      id: m.id,
      label: `Manutenção (${m.status}): ${m.description}`,
    });
  }

  const incidents = await prisma.fleetIncident.findMany({
    where: {
      vehicleId,
      blocksVehicle: true,
      status: { notIn: ["RESOLVED", "CANCELED"] },
    },
    orderBy: { incidentDate: "desc" },
  });
  for (const i of incidents) {
    blockers.push({
      type: "incident",
      id: i.id,
      label: `Ocorrência (${i.status}): ${i.description}`,
    });
  }

  const openUsage = await prisma.fleetUsage.findFirst({
    where: {
      vehicleId,
      status: "CHECKED_OUT",
      checkinAt: null,
    },
    include: { reservation: { select: { id: true, status: true } } },
  });
  if (openUsage) {
    blockers.push({
      type: "usage",
      id: openUsage.id,
      label: "Uso em aberto (sem devolução)",
    });
  }

  const inUseReservation = await prisma.fleetReservation.findFirst({
    where: { vehicleId, status: "IN_USE" },
    select: { id: true, status: true },
  });
  if (inUseReservation && !openUsage) {
    blockers.push({
      type: "reservation",
      id: inUseReservation.id,
      label: "Reserva em uso",
    });
  }

  if (await hasActiveManualVehicleBlock(vehicleId)) {
    blockers.push({
      type: "admin_block",
      id: vehicleId,
      label: "Bloqueio administrativo manual",
    });
  }

  return blockers;
}

export async function recalculateVehicleOperationalStatus(
  vehicleId: string,
  options?: {
    excludeMaintenanceId?: string;
    userId?: string | null;
    reason?: string | null;
    trigger?: string;
  }
): Promise<RecalculateVehicleStatusResult> {
  const vehicle = await prisma.fleetVehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) {
    throw new Error("Veículo não encontrado.");
  }

  const blockers = await collectActiveFleetBlockers(vehicleId, options?.excludeMaintenanceId);

  const blockingMaintenance = await prisma.fleetMaintenance.findFirst({
    where: {
      vehicleId,
      id: options?.excludeMaintenanceId ? { not: options.excludeMaintenanceId } : undefined,
      blocksVehicle: true,
      status: { notIn: ["COMPLETED", "CANCELED"] },
    },
    orderBy: { openedAt: "desc" },
  });

  const now = new Date();
  const approvedReservation = await prisma.fleetReservation.findFirst({
    where: {
      vehicleId,
      OR: [
        { status: "IN_USE" },
        { status: "APPROVED", endDateTime: { gt: now } },
      ],
    },
    select: { id: true },
  });

  const hasManualAdminBlock = await hasActiveManualVehicleBlock(vehicleId);

  const nextStatus = resolveOperationalStatusFromContext({
    currentStatus: vehicle.status,
    blockers,
    blockingMaintenancePriority: blockingMaintenance?.priority ?? null,
    hasApprovedReservation: Boolean(approvedReservation),
    hasManualAdminBlock,
  });

  const changed = vehicle.status !== nextStatus;
  if (changed) {
    await prisma.fleetVehicle.update({
      where: { id: vehicleId },
      data: { status: nextStatus, updatedBy: options?.userId ?? undefined },
    });

    await writeFleetAuditLog({
      entityType: "FleetVehicle",
      entityId: vehicleId,
      action: options?.trigger ?? "RECALCULATE_STATUS",
      oldValue: vehicle.status,
      newValue: nextStatus,
      reason:
        options?.reason ??
        (blockers.length > 0
          ? `Bloqueios ativos: ${blockers.map((b) => b.label).join("; ")}`
          : "Nenhum bloqueio ativo — veículo liberado"),
      userId: options?.userId ?? null,
    });
  }

  return {
    previousStatus: vehicle.status,
    nextStatus,
    changed,
    blockers,
  };
}

/** Compat: chamadas legadas após manutenção/ocorrência. */
export async function syncVehicleStatusAfterMaintenance(vehicleId: string) {
  await recalculateVehicleOperationalStatus(vehicleId, {
    trigger: "SYNC_AFTER_MAINTENANCE",
  });
}
