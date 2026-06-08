import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { FleetSettingsMap } from "@/src/lib/fleetService.js";
import { loadFleetSettings } from "@/src/lib/fleetService.js";
import {
  computeCnhStatus,
  computeDocumentStatus,
  FLEET_ACTIVE_RESERVATION_STATUSES,
  isContractExpired,
  isContractExpiringSoon,
} from "@/src/lib/fleetValidation.js";
import { buildMaintenanceDashboardAlerts } from "@/src/lib/fleetMaintenanceOps.js";
import { buildMaintenanceWhere } from "@/src/lib/fleetMaintenanceOps.js";
import {
  buildFleetOperationalAlerts,
  type FleetAlertItem,
} from "@/src/lib/fleetAlertsService.js";

export const FLEET_NON_OPERATIONAL_STATUSES = ["INACTIVE", "SOLD", "RETURNED"] as const;

export type { FleetAlertItem } from "@/src/lib/fleetAlertsService.js";
export { buildFleetOperationalAlerts as buildFleetAlerts } from "@/src/lib/fleetAlertsService.js";

export type { FleetReportFilters } from "@/src/lib/fleetReportsService.js";
export {
  parseFleetReportFilters,
  buildVehicleReportWhere,
  reportFleet,
  reportUsage,
  reportCosts,
  reportMaintenance,
  reportDocuments,
  fleetReportToCsv,
} from "@/src/lib/fleetReportsService.js";

export function summarizeVehicleStatusCounts(
  rows: { status: string }[]
): {
  totalOperational: number;
  available: number;
  reserved: number;
  inUse: number;
  maintenance: number;
  blocked: number;
  claimed: number;
  inactiveReturnedSold: number;
} {
  const counts = {
    totalOperational: 0,
    available: 0,
    reserved: 0,
    inUse: 0,
    maintenance: 0,
    blocked: 0,
    claimed: 0,
    inactiveReturnedSold: 0,
  };
  for (const r of rows) {
    if (FLEET_NON_OPERATIONAL_STATUSES.includes(r.status as (typeof FLEET_NON_OPERATIONAL_STATUSES)[number])) {
      counts.inactiveReturnedSold += 1;
      continue;
    }
    counts.totalOperational += 1;
    if (r.status === "AVAILABLE") counts.available += 1;
    else if (r.status === "RESERVED") counts.reserved += 1;
    else if (r.status === "IN_USE") counts.inUse += 1;
    else if (r.status === "MAINTENANCE") counts.maintenance += 1;
    else if (r.status === "BLOCKED") counts.blocked += 1;
    else if (r.status === "CLAIMED") counts.claimed += 1;
  }
  return counts;
}

function alertDays(settings: FleetSettingsMap) {
  return {
    doc: Number(settings.diasAlertaDocumento ?? "30") || 30,
    cnh: Number(settings.diasAlertaCnh ?? "30") || 30,
    contract: Number(settings.diasAlertaDocumento ?? "30") || 30,
  };
}

export async function buildFleetDashboardCards(settings?: FleetSettingsMap) {
  const cfg = settings ?? (await loadFleetSettings());
  const days = alertDays(cfg);
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const vehicles = await prisma.fleetVehicle.findMany({
    select: { status: true },
  });
  const vCounts = summarizeVehicleStatusCounts(vehicles);

  const documents = await prisma.fleetVehicleDocument.findMany({
    where: { status: { not: "REPLACED" }, expirationDate: { not: null } },
    select: { expirationDate: true },
  });
  let documentsExpired = 0;
  let documentsExpiring = 0;
  for (const d of documents) {
    const st = computeDocumentStatus(d.expirationDate, days.doc, now);
    if (st === "EXPIRED") documentsExpired += 1;
    else if (st === "EXPIRING") documentsExpiring += 1;
  }

  const driverRows = await prisma.fleetDriver.findMany({
    where: { status: { not: "INACTIVE" } },
    select: { cnhExpirationDate: true },
  });
  let cnhsExpired = 0;
  let cnhsExpiring = 0;
  for (const d of driverRows) {
    const st = computeCnhStatus(d.cnhExpirationDate, days.cnh, now);
    if (st === "EXPIRED") cnhsExpired += 1;
    else if (st === "EXPIRING") cnhsExpiring += 1;
  }

  const activeContracts = await prisma.fleetVehicleContract.findMany({
    where: { status: "ACTIVE" },
    select: { endDate: true },
  });
  let contractsExpired = 0;
  let contractsExpiring = 0;
  for (const c of activeContracts) {
    if (isContractExpired(c.endDate, now)) contractsExpired += 1;
    else if (isContractExpiringSoon(c.endDate, days.contract, now)) contractsExpiring += 1;
  }

  const [
    reservationsToday,
    reservationsOverdue,
    openMaintenances,
    pendingFines,
    openIncidents,
    maintAlerts,
  ] = await Promise.all([
    prisma.fleetReservation.count({
      where: {
        startDateTime: { lte: endOfDay },
        endDateTime: { gte: startOfDay },
        status: { in: ["APPROVED", "IN_USE", "PENDING_APPROVAL", "REQUESTED"] },
      },
    }),
    prisma.fleetReservation.count({
      where: {
        endDateTime: { lt: now },
        status: { in: ["APPROVED", "IN_USE", "PENDING_APPROVAL"] },
      },
    }),
    prisma.fleetMaintenance.count({
      where: { status: { notIn: ["COMPLETED", "CANCELED"] } },
    }),
    prisma.fleetFine.count({
      where: { status: { in: ["RECEIVED", "IDENTIFYING_DRIVER", "PENDING_PAYMENT"] } },
    }),
    prisma.fleetIncident.count({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
    }),
    buildMaintenanceDashboardAlerts(),
  ]);

  return {
    totalVehicles: vehicles.length,
    totalOperational: vCounts.totalOperational,
    available: vCounts.available,
    reserved: vCounts.reserved,
    inUse: vCounts.inUse,
    maintenance: vCounts.maintenance,
    blocked: vCounts.blocked,
    claimed: vCounts.claimed,
    inactiveReturnedSold: vCounts.inactiveReturnedSold,
    reservationsToday,
    reservationsOverdue,
    documentsExpired,
    documentsExpiring,
    cnhsExpired,
    cnhsExpiring,
    contractsExpired,
    contractsExpiring,
    openMaintenances,
    maintenanceOverdue: maintAlerts.overdue.length,
    maintenanceUpcoming: maintAlerts.upcoming.length,
    pendingFines,
    openIncidents,
  };
}

export async function buildFleetManagementDashboard() {
  const settings = await loadFleetSettings();
  const [cards, alerts] = await Promise.all([
    buildFleetDashboardCards(settings),
    buildFleetOperationalAlerts(settings),
  ]);
  return { cards, alerts };
}

export const FLEET_EDITABLE_SETTINGS_KEYS = [
  "bloquearReservaDocumentoVencido",
  "bloquearRetiradaCnhVencida",
  "checklistRetiradaObrigatorio",
  "checklistDevolucaoObrigatorio",
  "diasAlertaDocumento",
  "diasAlertaCnh",
  "percentualAlertaFranquiaKm",
  "manutencaoValorAprovacao",
  "publicReservationEnabled",
  "publicReservationBaseUrl",
  "publicReservationToken",
  "publicReservationTitle",
  "publicReservationInstructions",
  "publicReservationSlotMinutes",
  "publicReservationStartHour",
  "publicReservationEndHour",
] as const;
