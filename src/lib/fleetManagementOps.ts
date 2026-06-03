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
import { maskFinancialData } from "@/src/lib/fleetFinancialOps.js";
import { fleetRowsToCsv } from "@/src/lib/fleetCsv.js";

export const FLEET_NON_OPERATIONAL_STATUSES = ["INACTIVE", "SOLD", "RETURNED"] as const;

export type FleetAlertItem = {
  level: "critical" | "warning" | "info";
  code: string;
  message: string;
  entityType?: string;
  entityId?: string;
};

export type FleetReportFilters = {
  start?: Date;
  end?: Date;
  status?: string;
  unit?: string;
  costCenter?: string;
  origin?: string;
  vehicleId?: string;
  driverId?: string;
  competence?: string;
};

export function parseFleetReportFilters(query: Record<string, unknown>): FleetReportFilters {
  const startRaw = String(query.start ?? query.startDate ?? "").trim();
  const endRaw = String(query.end ?? query.endDate ?? "").trim();
  const filters: FleetReportFilters = {};
  if (startRaw) {
    const d = new Date(startRaw);
    if (!Number.isNaN(d.getTime())) filters.start = d;
  }
  if (endRaw) {
    const d = new Date(endRaw);
    if (!Number.isNaN(d.getTime())) filters.end = d;
  }
  const status = String(query.status ?? "").trim();
  const unit = String(query.unit ?? "").trim();
  const costCenter = String(query.costCenter ?? "").trim();
  const origin = String(query.origin ?? "").trim();
  const vehicleId = String(query.vehicleId ?? "").trim();
  const driverId = String(query.driverId ?? "").trim();
  const competence = String(query.competence ?? "").trim();
  if (status) filters.status = status;
  if (unit) filters.unit = unit;
  if (costCenter) filters.costCenter = costCenter;
  if (origin) filters.origin = origin;
  if (vehicleId) filters.vehicleId = vehicleId;
  if (driverId) filters.driverId = driverId;
  if (competence) filters.competence = competence;
  return filters;
}

export function buildVehicleReportWhere(filters: FleetReportFilters): Prisma.FleetVehicleWhereInput {
  const where: Prisma.FleetVehicleWhereInput = {};
  if (filters.status) where.status = filters.status as Prisma.EnumFleetVehicleStatusFilter["equals"];
  if (filters.unit) where.unit = filters.unit;
  if (filters.costCenter) where.costCenter = filters.costCenter;
  if (filters.origin) {
    where.origin = filters.origin as Prisma.EnumFleetVehicleOriginFilter["equals"];
  }
  if (filters.vehicleId) where.id = filters.vehicleId;
  return where;
}

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

export async function buildFleetAlerts(settings?: FleetSettingsMap): Promise<FleetAlertItem[]> {
  const cfg = settings ?? (await loadFleetSettings());
  const days = alertDays(cfg);
  const now = new Date();
  const alerts: FleetAlertItem[] = [];

  const documents = await prisma.fleetVehicleDocument.findMany({
    where: { status: { not: "REPLACED" }, expirationDate: { not: null } },
    include: { vehicle: { select: { plate: true, brand: true, model: true } } },
    take: 200,
  });
  for (const d of documents) {
    const st = computeDocumentStatus(d.expirationDate, days.doc, now);
    if (st === "EXPIRED") {
      alerts.push({
        level: "critical",
        code: "DOCUMENT_EXPIRED",
        message: `Documento vencido (${d.documentType}): ${d.vehicle.plate ?? d.vehicle.brand}`,
        entityType: "FleetVehicleDocument",
        entityId: d.id,
      });
    } else if (st === "EXPIRING") {
      alerts.push({
        level: "warning",
        code: "DOCUMENT_EXPIRING",
        message: `Documento vencendo (${d.documentType}): ${d.vehicle.plate ?? d.vehicle.brand}`,
        entityType: "FleetVehicleDocument",
        entityId: d.id,
      });
    }
  }

  const drivers = await prisma.fleetDriver.findMany({
    where: { status: { not: "INACTIVE" } },
    select: { id: true, name: true, cnhExpirationDate: true, status: true },
    take: 200,
  });
  for (const d of drivers) {
    const st = computeCnhStatus(d.cnhExpirationDate, days.cnh, now);
    if (st === "EXPIRED") {
      alerts.push({
        level: "critical",
        code: "CNH_EXPIRED",
        message: `CNH vencida: ${d.name}`,
        entityType: "FleetDriver",
        entityId: d.id,
      });
    } else if (st === "EXPIRING") {
      alerts.push({
        level: "warning",
        code: "CNH_EXPIRING",
        message: `CNH vencendo: ${d.name}`,
        entityType: "FleetDriver",
        entityId: d.id,
      });
    }
  }

  const contracts = await prisma.fleetVehicleContract.findMany({
    where: { status: "ACTIVE" },
    include: { vehicle: { select: { plate: true, brand: true } } },
    take: 200,
  });
  for (const c of contracts) {
    if (isContractExpired(c.endDate, now)) {
      alerts.push({
        level: "critical",
        code: "CONTRACT_EXPIRED",
        message: `Contrato vencido: ${c.vehicle.plate ?? c.vehicle.brand}${c.contractNumber ? ` (${c.contractNumber})` : ""}`,
        entityType: "FleetVehicleContract",
        entityId: c.id,
      });
    } else if (isContractExpiringSoon(c.endDate, days.contract, now)) {
      alerts.push({
        level: "warning",
        code: "CONTRACT_EXPIRING",
        message: `Contrato vencendo: ${c.vehicle.plate ?? c.vehicle.brand}`,
        entityType: "FleetVehicleContract",
        entityId: c.id,
      });
    }
  }

  const maint = await buildMaintenanceDashboardAlerts();
  alerts.push(...maint.alerts.map((a) => ({ ...a, code: a.message.includes("vencida") ? "MAINTENANCE_OVERDUE" : "MAINTENANCE_UPCOMING" })));

  const overdueReservations = await prisma.fleetReservation.findMany({
    where: {
      endDateTime: { lt: now },
      status: { in: ["APPROVED", "IN_USE", "PENDING_APPROVAL"] },
    },
    include: { vehicle: { select: { plate: true, brand: true } } },
    take: 30,
  });
  for (const r of overdueReservations) {
    alerts.push({
      level: "critical",
      code: "RESERVATION_OVERDUE",
      message: `Reserva atrasada: ${r.vehicle.plate ?? r.vehicle.brand}`,
      entityType: "FleetReservation",
      entityId: r.id,
    });
  }

  const noShows = await prisma.fleetReservation.findMany({
    where: { status: "NO_SHOW" },
    include: { vehicle: { select: { plate: true } } },
    orderBy: { endDateTime: "desc" },
    take: 10,
  });
  for (const r of noShows) {
    alerts.push({
      level: "warning",
      code: "RESERVATION_NO_SHOW",
      message: `No-show: ${r.vehicle.plate ?? "veículo"}`,
      entityType: "FleetReservation",
      entityId: r.id,
    });
  }

  const blockedVehicles = await prisma.fleetVehicle.findMany({
    where: { status: "BLOCKED" },
    select: { id: true, plate: true, brand: true, model: true },
    take: 20,
  });
  for (const v of blockedVehicles) {
    alerts.push({
      level: "critical",
      code: "VEHICLE_BLOCKED",
      message: `Veículo bloqueado: ${v.plate ?? v.brand} ${v.model}`,
      entityType: "FleetVehicle",
      entityId: v.id,
    });
  }

  const finesNoDriver = await prisma.fleetFine.findMany({
    where: { status: "IDENTIFYING_DRIVER" },
    include: { vehicle: { select: { plate: true } } },
    take: 20,
  });
  for (const f of finesNoDriver) {
    alerts.push({
      level: "warning",
      code: "FINE_NO_DRIVER",
      message: `Multa sem motorista: ${f.vehicle.plate ?? "veículo"}`,
      entityType: "FleetFine",
      entityId: f.id,
    });
  }

  const openIncidents = await prisma.fleetIncident.findMany({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
    include: { vehicle: { select: { plate: true, brand: true } } },
    take: 20,
  });
  for (const i of openIncidents) {
    alerts.push({
      level: i.severity === "GRAVE" || i.severity === "ALTA" ? "critical" : "warning",
      code: "INCIDENT_OPEN",
      message: `Sinistro/avaria aberto (${i.incidentType}): ${i.vehicle.plate ?? i.vehicle.brand}`,
      entityType: "FleetIncident",
      entityId: i.id,
    });
  }

  return alerts;
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
    buildFleetAlerts(settings),
  ]);
  return { cards, alerts };
}

export async function reportFleet(filters: FleetReportFilters) {
  const rows = await prisma.fleetVehicle.findMany({
    where: buildVehicleReportWhere(filters),
    orderBy: { plate: "asc" },
    take: 2000,
  });
  return rows.map((v) => ({
    plate: v.plate,
    brand: v.brand,
    model: v.model,
    status: v.status,
    origin: v.origin,
    unit: v.unit,
    costCenter: v.costCenter,
    currentKm: Number(v.currentKm),
  }));
}

export async function reportUsage(filters: FleetReportFilters) {
  const where: Prisma.FleetReservationWhereInput = {
    status: {
      in: [
        ...FLEET_ACTIVE_RESERVATION_STATUSES,
        "FINISHED",
        "FINISHED_WITH_PENDING",
        "NO_SHOW",
        "IN_USE",
      ],
    },
  };
  if (filters.start || filters.end) {
    const start = filters.start ?? new Date(0);
    const end = filters.end ?? new Date("2099-12-31");
    where.AND = [{ startDateTime: { lte: end } }, { endDateTime: { gte: start } }];
  }
  if (filters.vehicleId) where.vehicleId = filters.vehicleId;
  if (filters.driverId) where.driverId = filters.driverId;
  if (filters.status) where.status = filters.status as Prisma.EnumFleetReservationStatusFilter["equals"];

  const vehicleWhere = buildVehicleReportWhere(filters);
  if (Object.keys(vehicleWhere).length > 0) {
    where.vehicle = vehicleWhere;
  }

  const rows = await prisma.fleetReservation.findMany({
    where,
    include: {
      vehicle: { select: { plate: true, brand: true, model: true, unit: true, costCenter: true } },
      driver: { select: { name: true } },
    },
    orderBy: { startDateTime: "desc" },
    take: 2000,
  });

  return rows.map((r) => ({
    id: r.id,
    vehicle: r.vehicle.plate ?? `${r.vehicle.brand} ${r.vehicle.model}`,
    driver: r.driver?.name ?? "—",
    start: r.startDateTime.toISOString(),
    end: r.endDateTime.toISOString(),
    status: r.status,
    destination: r.destination,
    costCenter: r.costCenter ?? r.vehicle.costCenter,
    unit: r.vehicle.unit,
  }));
}

export async function reportCosts(filters: FleetReportFilters, showFinancial: boolean) {
  const where: Prisma.FleetCostWhereInput = { status: "ACTIVE" };
  if (filters.competence) where.competence = filters.competence;
  if (filters.start || filters.end) {
    where.costDate = {};
    if (filters.start) where.costDate.gte = filters.start;
    if (filters.end) where.costDate.lte = filters.end;
  }
  const vehicleWhere = buildVehicleReportWhere(filters);
  if (Object.keys(vehicleWhere).length > 0) where.vehicle = vehicleWhere;

  const rows = await prisma.fleetCost.findMany({
    where,
    include: { vehicle: { select: { plate: true, brand: true, unit: true, costCenter: true } } },
    orderBy: { costDate: "desc" },
    take: 5000,
  });

  const mapped = rows.map((c) => ({
    costDate: c.costDate.toISOString().slice(0, 10),
    competence: c.competence,
    vehicle: c.vehicle.plate ?? c.vehicle.brand,
    costType: c.costType,
    amount: Number(c.amount),
    unit: c.vehicle.unit,
    costCenter: c.vehicle.costCenter,
    supplierName: c.supplierName,
  }));

  return maskFinancialData(mapped, showFinancial);
}

export async function reportMaintenance(filters: FleetReportFilters) {
  const where = buildMaintenanceWhere({
    vehicleId: filters.vehicleId,
    status: filters.status,
    start: filters.start?.toISOString(),
    end: filters.end?.toISOString(),
  });
  if (filters.unit || filters.costCenter) {
    where.vehicle = buildVehicleReportWhere(filters);
  }

  const rows = await prisma.fleetMaintenance.findMany({
    where,
    include: { vehicle: { select: { plate: true, brand: true, unit: true, costCenter: true } } },
    orderBy: { openedAt: "desc" },
    take: 2000,
  });

  return rows.map((m) => ({
    openedAt: m.openedAt.toISOString(),
    vehicle: m.vehicle.plate ?? m.vehicle.brand,
    type: m.maintenanceType,
    status: m.status,
    priority: m.priority,
    description: m.description,
    unit: m.vehicle.unit,
    costCenter: m.vehicle.costCenter,
    estimatedValue: m.estimatedValue != null ? Number(m.estimatedValue) : null,
    finalValue: m.finalValue != null ? Number(m.finalValue) : null,
  }));
}

export async function reportDocuments(filters: FleetReportFilters) {
  const cfg = await loadFleetSettings();
  const days = alertDays(cfg);
  const now = new Date();

  const vehicleWhere = buildVehicleReportWhere(filters);
  const docs = await prisma.fleetVehicleDocument.findMany({
    where: {
      status: { not: "REPLACED" },
      ...(Object.keys(vehicleWhere).length ? { vehicle: vehicleWhere } : {}),
    },
    include: { vehicle: { select: { plate: true, brand: true, unit: true, costCenter: true } } },
    take: 2000,
  });

  const drivers = await prisma.fleetDriver.findMany({
    where: {
      status: { not: "INACTIVE" },
      ...(filters.unit ? { unit: filters.unit } : {}),
      ...(filters.costCenter ? { costCenter: filters.costCenter } : {}),
      ...(filters.driverId ? { id: filters.driverId } : {}),
    },
    take: 2000,
  });

  const docRows = docs.map((d) => {
    const st = computeDocumentStatus(d.expirationDate, days.doc, now);
    return {
      kind: "DOCUMENT",
      vehicle: d.vehicle.plate ?? d.vehicle.brand,
      type: d.documentType,
      expirationDate: d.expirationDate?.toISOString().slice(0, 10) ?? "",
      status: st,
      unit: d.vehicle.unit,
      costCenter: d.vehicle.costCenter,
    };
  });

  const driverRows = drivers.map((d) => {
    const st = computeCnhStatus(d.cnhExpirationDate, days.cnh, now);
    return {
      kind: "CNH",
      vehicle: "—",
      type: d.name,
      expirationDate: d.cnhExpirationDate?.toISOString().slice(0, 10) ?? "",
      status: st,
      unit: d.unit,
      costCenter: d.costCenter,
    };
  });

  let combined = [...docRows, ...driverRows];
  if (filters.status) {
    combined = combined.filter((r) => r.status === filters.status);
  }
  return combined;
}

export function fleetReportToCsv(
  report: string,
  rows: Record<string, unknown>[]
): string {
  if (rows.length === 0) {
    return fleetRowsToCsv(["info"], [["Nenhum registro no período/filtros selecionados"]]);
  }
  const headers = Object.keys(rows[0]);
  const data = rows.map((r) => headers.map((h) => r[h] as string | number | null));
  return fleetRowsToCsv(headers, data);
}

export const FLEET_EDITABLE_SETTINGS_KEYS = [
  "bloquearReservaDocumentoVencido",
  "bloquearRetiradaCnhVencida",
  "checklistRetiradaObrigatorio",
  "checklistDevolucaoObrigatorio",
  "diasAlertaDocumento",
  "diasAlertaCnh",
  "percentualAlertaFranquiaKm",
] as const;
