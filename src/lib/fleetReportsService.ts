import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { loadFleetSettings } from "@/src/lib/fleetService.js";
import {
  computeCnhStatus,
  computeDocumentStatus,
  FLEET_ACTIVE_RESERVATION_STATUSES,
} from "@/src/lib/fleetValidation.js";
import { buildMaintenanceWhere } from "@/src/lib/fleetMaintenanceOps.js";
import { computeCostPerKm, maskFinancialData } from "@/src/lib/fleetFinancialOps.js";
import { fleetRowsToCsv } from "@/src/lib/fleetCsv.js";
const FLEET_NON_OPERATIONAL_STATUSES = ["INACTIVE", "SOLD", "RETURNED"] as const;

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
  /** Inclui INACTIVE, SOLD, RETURNED (filtro histórico) */
  includeInactive?: boolean;
  /** Documentos/CNH: somente vencidos e vencendo */
  onlyExpiring?: boolean;
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
    if (!Number.isNaN(d.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) {
        d.setHours(23, 59, 59, 999);
      }
      filters.end = d;
    }
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
  const includeInactive =
    query.includeInactive === true ||
    query.includeInactive === "true" ||
    query.historical === true ||
    query.historical === "true";
  if (includeInactive) filters.includeInactive = true;
  const onlyExpiring =
    query.onlyExpiring === true ||
    query.onlyExpiring === "true" ||
    query.onlyIssues === true ||
    query.onlyIssues === "true";
  if (onlyExpiring) filters.onlyExpiring = true;
  return filters;
}

export function buildVehicleReportWhere(
  filters: FleetReportFilters
): Prisma.FleetVehicleWhereInput {
  const where: Prisma.FleetVehicleWhereInput = {};
  if (filters.status) {
    where.status = filters.status as Prisma.EnumFleetVehicleStatusFilter["equals"];
  } else if (!filters.includeInactive) {
    where.status = { notIn: [...FLEET_NON_OPERATIONAL_STATUSES] };
  }
  if (filters.unit) where.unit = filters.unit;
  if (filters.costCenter) where.costCenter = filters.costCenter;
  if (filters.origin) {
    where.origin = filters.origin as Prisma.EnumFleetVehicleOriginFilter["equals"];
  }
  if (filters.vehicleId) where.id = filters.vehicleId;
  return where;
}

export function filterRowsByReportFilters<T extends Record<string, unknown>>(
  rows: T[],
  filters: FleetReportFilters,
  keys: { unit?: keyof T; costCenter?: keyof T; status?: keyof T }
): T[] {
  return rows.filter((row) => {
    if (filters.unit && keys.unit && row[keys.unit] !== filters.unit) return false;
    if (filters.costCenter && keys.costCenter && row[keys.costCenter] !== filters.costCenter) {
      return false;
    }
    if (filters.status && keys.status && row[keys.status] !== filters.status) return false;
    return true;
  });
}

export function formatCostPerKmLabel(totalCost: number, km: number): string {
  const v = computeCostPerKm(totalCost, km);
  if (v == null) return "não calculável";
  return v.toFixed(4);
}

function periodMs(filters: FleetReportFilters): number {
  const start = filters.start ?? new Date(0);
  const end = filters.end ?? new Date();
  return Math.max(0, end.getTime() - start.getTime());
}

function msToDays(ms: number): number {
  return Math.round((ms / (1000 * 60 * 60 * 24)) * 10) / 10;
}

function msToHours(ms: number): number {
  return Math.round((ms / (1000 * 60 * 60)) * 10) / 10;
}

export async function reportFleet(filters: FleetReportFilters) {
  const cfg = await loadFleetSettings();
  const docDays = Number(cfg.diasAlertaDocumento ?? "30") || 30;
  const now = new Date();

  const vehicles = await prisma.fleetVehicle.findMany({
    where: buildVehicleReportWhere(filters),
    include: {
      contracts: { where: { status: "ACTIVE" }, take: 1, orderBy: { endDate: "desc" } },
      documents: { where: { status: { not: "REPLACED" } }, select: { expirationDate: true } },
    },
    orderBy: { plate: "asc" },
    take: 2000,
  });

  return vehicles.map((v) => {
    let documentsExpired = 0;
    let documentsExpiring = 0;
    for (const d of v.documents) {
      const st = computeDocumentStatus(d.expirationDate, docDays, now);
      if (st === "EXPIRED") documentsExpired += 1;
      else if (st === "EXPIRING") documentsExpiring += 1;
    }
    const contract = v.contracts[0];
    return {
      vehicleId: v.id,
      plate: v.plate,
      brand: v.brand,
      model: v.model,
      status: v.status,
      origin: v.origin,
      unit: v.unit,
      costCenter: v.costCenter,
      currentKm: Number(v.currentKm),
      activeContractNumber: contract?.contractNumber ?? "",
      contractType: contract?.contractType ?? "",
      contractEndDate: contract?.endDate?.toISOString().slice(0, 10) ?? "",
      documentsExpired,
      documentsExpiring,
      documentsTotal: v.documents.length,
    };
  });
}

export async function reportUsage(filters: FleetReportFilters) {
  const periodStart = filters.start ?? new Date(0);
  const periodEnd = filters.end ?? new Date("2099-12-31");
  const periodDays = Math.max(1, msToDays(periodMs(filters)));

  const vehicleWhere = buildVehicleReportWhere(filters);

  const usages = await prisma.fleetUsage.findMany({
    where: {
      status: "CHECKED_IN",
      checkoutAt: { gte: periodStart, lte: periodEnd },
      ...(Object.keys(vehicleWhere).length ? { vehicle: vehicleWhere } : {}),
      ...(filters.driverId ? { driverId: filters.driverId } : {}),
    },
    include: {
      vehicle: { select: { id: true, plate: true, brand: true, model: true, unit: true, costCenter: true } },
      driver: { select: { id: true, name: true } },
      reservation: { select: { id: true, startDateTime: true, endDateTime: true } },
    },
    take: 5000,
  });

  const reservations = await prisma.fleetReservation.findMany({
    where: {
      startDateTime: { lte: periodEnd },
      endDateTime: { gte: periodStart },
      status: {
        in: [
          ...FLEET_ACTIVE_RESERVATION_STATUSES,
          "FINISHED",
          "FINISHED_WITH_PENDING",
          "NO_SHOW",
          "IN_USE",
        ],
      },
      ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
      ...(filters.driverId ? { driverId: filters.driverId } : {}),
      ...(Object.keys(vehicleWhere).length ? { vehicle: vehicleWhere } : {}),
    },
    select: { id: true, vehicleId: true, driverId: true },
    take: 5000,
  });

  type Agg = {
    vehicleId: string;
    vehicle: string;
    unit: string | null;
    costCenter: string | null;
    drivers: Set<string>;
    reservationIds: Set<string>;
    kmDriven: number;
    usageMs: number;
  };

  const byVehicle = new Map<string, Agg>();

  const ensure = (vehicleId: string, label: string, unit: string | null, costCenter: string | null) => {
    let a = byVehicle.get(vehicleId);
    if (!a) {
      a = {
        vehicleId,
        vehicle: label,
        unit,
        costCenter,
        drivers: new Set(),
        reservationIds: new Set(),
        kmDriven: 0,
        usageMs: 0,
      };
      byVehicle.set(vehicleId, a);
    }
    return a;
  };

  for (const u of usages) {
    const label = u.vehicle.plate ?? `${u.vehicle.brand} ${u.vehicle.model}`;
    const a = ensure(u.vehicleId, label, u.vehicle.unit, u.vehicle.costCenter);
    if (u.driver?.name) a.drivers.add(u.driver.name);
    a.reservationIds.add(u.reservationId);
    a.kmDriven += Number(u.kmDriven ?? 0);
    if (u.checkinAt && u.checkoutAt) {
      a.usageMs += u.checkinAt.getTime() - u.checkoutAt.getTime();
    }
  }

  for (const r of reservations) {
    const a = byVehicle.get(r.vehicleId);
    if (a) a.reservationIds.add(r.id);
  }

  return [...byVehicle.values()].map((a) => {
    const usageDays = msToDays(a.usageMs);
    const usageHours = msToHours(a.usageMs);
    const idlenessDays = Math.max(0, Math.round((periodDays - usageDays) * 10) / 10);
    return {
      vehicleId: a.vehicleId,
      vehicle: a.vehicle,
      unit: a.unit,
      costCenter: a.costCenter,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
      drivers: [...a.drivers].join(", ") || "—",
      reservationsCount: a.reservationIds.size,
      kmDriven: a.kmDriven,
      usageHours,
      usageDays,
      idlenessDays,
    };
  });
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

  const costs = await prisma.fleetCost.findMany({
    where,
    include: { vehicle: { select: { id: true, plate: true, brand: true, unit: true, costCenter: true } } },
    orderBy: [{ vehicleId: "asc" }, { costDate: "desc" }],
    take: 5000,
  });

  const periodStart = filters.start ?? new Date(0);
  const periodEnd = filters.end ?? new Date("2099-12-31");

  const usages = await prisma.fleetUsage.findMany({
    where: {
      status: "CHECKED_IN",
      checkoutAt: { gte: periodStart, lte: periodEnd },
      ...(Object.keys(vehicleWhere).length ? { vehicle: vehicleWhere } : {}),
    },
    select: { vehicleId: true, kmDriven: true },
    take: 10000,
  });

  const kmByVehicle = new Map<string, number>();
  for (const u of usages) {
    kmByVehicle.set(u.vehicleId, (kmByVehicle.get(u.vehicleId) ?? 0) + Number(u.kmDriven ?? 0));
  }

  type Key = string;
  const groups = new Map<
    Key,
    {
      vehicleId: string;
      vehicle: string;
      unit: string | null;
      costCenter: string | null;
      costType: string;
      competence: string;
      totalAmount: number;
    }
  >();

  for (const c of costs) {
    const key = `${c.vehicleId}|${c.costType}|${c.competence}`;
    const g = groups.get(key) ?? {
      vehicleId: c.vehicleId,
      vehicle: c.vehicle.plate ?? c.vehicle.brand,
      unit: c.vehicle.unit,
      costCenter: c.vehicle.costCenter,
      costType: c.costType,
      competence: c.competence,
      totalAmount: 0,
    };
    g.totalAmount += Number(c.amount);
    groups.set(key, g);
  }

  const rows = [...groups.values()].map((g) => {
    const km = kmByVehicle.get(g.vehicleId) ?? 0;
    const costPerKm = computeCostPerKm(g.totalAmount, km);
    const costPerKmLabel = formatCostPerKmLabel(g.totalAmount, km);
    return {
      vehicleId: g.vehicleId,
      vehicle: g.vehicle,
      unit: g.unit,
      costCenter: g.costCenter,
      costType: g.costType,
      competence: g.competence,
      totalAmount: g.totalAmount,
      kmInPeriod: km,
      costPerKm,
      costPerKmLabel: showFinancial ? costPerKmLabel : km > 0 ? "••••••" : costPerKmLabel,
    };
  });

  return maskFinancialData(rows, showFinancial);
}

export async function reportMaintenance(filters: FleetReportFilters, showFinancial = true) {
  const where = buildMaintenanceWhere({
    vehicleId: filters.vehicleId,
    status: filters.status,
    start: filters.start?.toISOString(),
    end: filters.end?.toISOString(),
  });
  if (filters.unit || filters.costCenter || filters.origin) {
    where.vehicle = buildVehicleReportWhere(filters);
  }

  const rows = await prisma.fleetMaintenance.findMany({
    where,
    include: { vehicle: { select: { plate: true, brand: true, unit: true, costCenter: true } } },
    orderBy: { openedAt: "desc" },
    take: 2000,
  });

  const now = new Date();
  const mapped = rows.map((m) => {
    const endAt = m.completedAt ?? (m.blocksVehicle ? now : m.startedAt ?? m.openedAt);
    const downtimeMs = endAt.getTime() - m.openedAt.getTime();
    const isOpen = !["COMPLETED", "CANCELED"].includes(m.status);
    return {
      maintenanceId: m.id,
      openedAt: m.openedAt.toISOString().slice(0, 10),
      completedAt: m.completedAt?.toISOString().slice(0, 10) ?? "",
      vehicle: m.vehicle.plate ?? m.vehicle.brand,
      unit: m.vehicle.unit,
      costCenter: m.vehicle.costCenter,
      maintenanceType: m.maintenanceType,
      status: m.status,
      isOpen,
      priority: m.priority,
      supplierName: m.supplierName ?? "",
      description: m.description,
      downtimeDays: msToDays(Math.max(0, downtimeMs)),
      estimatedValue: m.estimatedValue != null ? Number(m.estimatedValue) : null,
      finalValue: m.finalValue != null ? Number(m.finalValue) : null,
      blocksVehicle: m.blocksVehicle,
    };
  });

  return maskFinancialData(mapped, showFinancial);
}

export async function reportDocuments(filters: FleetReportFilters) {
  const cfg = await loadFleetSettings();
  const docDays = Number(cfg.diasAlertaDocumento ?? "30") || 30;
  const cnhDays = Number(cfg.diasAlertaCnh ?? "30") || 30;
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
    const st = computeDocumentStatus(d.expirationDate, docDays, now);
    return {
      kind: "DOCUMENT",
      vehicle: d.vehicle.plate ?? d.vehicle.brand,
      reference: d.documentType,
      expirationDate: d.expirationDate?.toISOString().slice(0, 10) ?? "",
      complianceStatus: st,
      unit: d.vehicle.unit,
      costCenter: d.vehicle.costCenter,
    };
  });

  const driverRows = drivers.map((d) => {
    const st = computeCnhStatus(d.cnhExpirationDate, cnhDays, now);
    return {
      kind: "CNH",
      vehicle: "—",
      reference: d.name,
      expirationDate: d.cnhExpirationDate?.toISOString().slice(0, 10) ?? "",
      complianceStatus: st,
      unit: d.unit,
      costCenter: d.costCenter,
    };
  });

  let combined = [...docRows, ...driverRows];

  if (filters.onlyExpiring) {
    combined = combined.filter((r) =>
      ["EXPIRED", "EXPIRING"].includes(String(r.complianceStatus))
    );
  } else if (filters.status) {
    combined = combined.filter((r) => r.complianceStatus === filters.status);
  }

  return combined;
}

export function fleetReportToCsv(report: string, rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return fleetRowsToCsv(["info"], [["Nenhum registro no período/filtros selecionados"]]);
  }
  const headers = Object.keys(rows[0]);
  const data = rows.map((r) => headers.map((h) => r[h] as string | number | null));
  return fleetRowsToCsv(headers, data);
}
