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
  computeDocumentStatus,
  findReservationConflict,
  isActiveDriverStatus,
  isActiveVehicleStatus,
  isCnhValid,
  isContractExpired,
  isContractExpiringSoon,
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
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const settings = await loadFleetSettings();
  const docAlertDays = Number(settings.diasAlertaDocumento ?? "30") || 30;
  const cnhAlertDays = Number(settings.diasAlertaCnh ?? "30") || 30;
  const docThreshold = new Date(now);
  docThreshold.setDate(docThreshold.getDate() + docAlertDays);
  const cnhThreshold = new Date(now);
  cnhThreshold.setDate(cnhThreshold.getDate() + cnhAlertDays);

  const [
    totalVehicles,
    available,
    inUse,
    maintenance,
    blocked,
    documentsExpiring,
    cnhsExpiring,
    reservationsToday,
    openMaintenances,
    vehicles,
    drivers,
    contracts,
  ] = await Promise.all([
    prisma.fleetVehicle.count({ where: { status: { notIn: ["INACTIVE", "SOLD"] } } }),
    prisma.fleetVehicle.count({ where: { status: "AVAILABLE" } }),
    prisma.fleetVehicle.count({ where: { status: "IN_USE" } }),
    prisma.fleetVehicle.count({ where: { status: "MAINTENANCE" } }),
    prisma.fleetVehicle.count({ where: { status: "BLOCKED" } }),
    prisma.fleetVehicleDocument.count({
      where: {
        status: { in: ["EXPIRING", "EXPIRED"] },
        expirationDate: { not: null },
      },
    }),
    prisma.fleetDriver.count({
      where: {
        status: "AUTHORIZED",
        cnhExpirationDate: { lte: cnhThreshold, gte: now },
      },
    }),
    prisma.fleetReservation.count({
      where: {
        startDateTime: { lte: endOfDay },
        endDateTime: { gte: startOfDay },
        status: { in: ["APPROVED", "IN_USE", "PENDING_APPROVAL", "REQUESTED"] },
      },
    }),
    prisma.fleetMaintenance.count({
      where: { status: { notIn: ["COMPLETED", "CANCELED"] } },
    }),
    prisma.fleetVehicle.findMany({
      where: { status: { in: ["BLOCKED", "MAINTENANCE", "CLAIMED"] } },
      select: { id: true, plate: true, brand: true, model: true, status: true },
      take: 20,
    }),
    prisma.fleetDriver.findMany({
      where: {
        status: "AUTHORIZED",
        cnhExpirationDate: { lt: now },
      },
      select: { id: true, name: true, cnhExpirationDate: true },
      take: 20,
    }),
    prisma.fleetVehicleContract.findMany({
      where: { endDate: { lt: now }, status: "ACTIVE" },
      select: { id: true, vehicleId: true, contractNumber: true, endDate: true },
      take: 20,
    }),
  ]);

  const alerts: { level: "critical" | "warning"; message: string; entityType?: string; entityId?: string }[] =
    [];

  for (const v of vehicles) {
    alerts.push({
      level: "critical",
      message: `Veículo ${v.plate ?? v.brand} — status ${v.status}`,
      entityType: "FleetVehicle",
      entityId: v.id,
    });
  }
  for (const d of drivers) {
    alerts.push({
      level: "critical",
      message: `CNH vencida: ${d.name}`,
      entityType: "FleetDriver",
      entityId: d.id,
    });
  }
  for (const c of contracts) {
    alerts.push({
      level: "warning",
      message: `Contrato vencido${c.contractNumber ? ` ${c.contractNumber}` : ""}`,
      entityType: "FleetVehicleContract",
      entityId: c.id,
    });
  }

  const expiredDocs = await prisma.fleetVehicleDocument.findMany({
    where: { status: { not: "REPLACED" }, expirationDate: { not: null } },
    select: { id: true, documentType: true, vehicleId: true, expirationDate: true },
    take: 20,
  });
  for (const d of expiredDocs) {
    const st = computeDocumentStatus(d.expirationDate, docAlertDays, now);
    if (st === "EXPIRED") {
      alerts.push({
        level: "critical",
        message: `Documento vencido: ${d.documentType}`,
        entityType: "FleetVehicleDocument",
        entityId: d.id,
      });
    }
  }

  const { buildMaintenanceDashboardAlerts } = await import("@/src/lib/fleetMaintenanceOps.js");
  const maintAlerts = await buildMaintenanceDashboardAlerts();
  alerts.push(...maintAlerts.alerts);

  const vehiclesInMaintenance = await prisma.fleetVehicle.findMany({
    where: { status: "MAINTENANCE" },
    select: { id: true, plate: true, brand: true, model: true },
    take: 10,
  });
  for (const v of vehiclesInMaintenance) {
    if (!alerts.some((a) => a.entityId === v.id && a.message.includes("Manutenção"))) {
      alerts.push({
        level: "warning",
        message: `Veículo em manutenção: ${v.plate ?? v.brand} ${v.model}`,
        entityType: "FleetVehicle",
        entityId: v.id,
      });
    }
  }

  return {
    cards: {
      totalVehicles,
      available,
      inUse,
      maintenance,
      blocked,
      documentsExpiring,
      cnhsExpiring,
      reservationsToday,
      openMaintenances,
      preventiveOverdue: maintAlerts.overdue.length,
      preventiveUpcoming: maintAlerts.upcoming.length,
    },
    alerts,
  };
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
