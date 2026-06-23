import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { FleetSettingsMap } from "@/src/lib/fleetService.js";
import type { FleetAlertDto } from "@/src/types/fleet.js";
import type {
  FleetExecutiveDashboard,
  FleetExecutiveDashboardFilters,
  FleetExecutiveTopVehicle,
  FleetExecutiveVehicleRow,
} from "@/src/types/fleet.js";

type FleetExecutiveAttentionReservation = FleetExecutiveDashboard["attentionReservations"][number];
import {
  buildFleetOperationalAlerts,
  dedupeFleetAlerts,
  type FleetAlertItem,
} from "@/src/lib/fleetAlertsService.js";
import { summarizeVehicleStatusCounts } from "@/src/lib/fleetManagementOps.js";
import { FLEET_ACTIVE_RESERVATION_STATUSES } from "@/src/lib/fleetValidation.js";

export type {
  FleetExecutiveDashboard,
  FleetExecutiveDashboardFilters,
  FleetExecutiveTopVehicle,
  FleetExecutiveVehicleRow,
} from "@/src/types/fleet.js";

const OPEN_RES_STATUSES = ["REQUESTED", "PENDING_APPROVAL", "APPROVED"] as const;
const IN_PROGRESS_RES_STATUSES = ["IN_USE"] as const;
const FINISHED_RES_STATUSES = ["FINISHED", "FINISHED_WITH_PENDING"] as const;
const CANCELED_RES_STATUSES = ["CANCELED", "REJECTED", "NO_SHOW"] as const;
const OVERDUE_RES_STATUSES = ["APPROVED", "IN_USE", "PENDING_APPROVAL"] as const;

export function parseFleetExecutiveDashboardQuery(
  query: Record<string, unknown>
): FleetExecutiveDashboardFilters {
  const now = new Date();
  const year = Number.parseInt(String(query.year ?? now.getFullYear()), 10);
  const month = Number.parseInt(String(query.month ?? now.getMonth() + 1), 10);
  const trim = (key: string) => {
    const raw = typeof query[key] === "string" ? query[key].trim() : "";
    return raw || undefined;
  };
  return {
    year: Number.isFinite(year) ? year : now.getFullYear(),
    month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : now.getMonth() + 1,
    vehicleStatus: trim("status"),
    vehicleType: trim("vehicleType"),
    plate: trim("plate"),
    unit: trim("unit"),
    driverId: trim("driverId"),
    vehicleId: trim("vehicleId"),
  };
}

export function resolveFleetMonthRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  return { start, end };
}

export function competenceLabel(year: number, month: number): string {
  return `${String(month).padStart(2, "0")}/${year}`;
}

export function summarizeReservationsByStatus(
  rows: { status: string }[]
): Array<{ status: string; count: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.status, (map.get(row.status) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

export function computeUsageKmRecord(usage: {
  kmDriven: unknown;
  checkoutKm: unknown;
  checkinKm: unknown;
}): number {
  const driven = usage.kmDriven != null ? Number(usage.kmDriven) : NaN;
  if (Number.isFinite(driven) && driven >= 0) return driven;
  const checkout = usage.checkoutKm != null ? Number(usage.checkoutKm) : NaN;
  const checkin = usage.checkinKm != null ? Number(usage.checkinKm) : NaN;
  if (Number.isFinite(checkout) && Number.isFinite(checkin) && checkin >= checkout) {
    return checkin - checkout;
  }
  return 0;
}

export function sortFleetExecutiveGridRows(
  rows: FleetExecutiveVehicleRow[],
  sortKey: "plate" | "monthlyReservations" | "monthlyKm" | "status",
  sortDir: "asc" | "desc"
): FleetExecutiveVehicleRow[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "plate") return a.plate.localeCompare(b.plate) * dir;
    if (sortKey === "status") return a.status.localeCompare(b.status) * dir;
    return (a[sortKey] - b[sortKey]) * dir;
  });
}

export function sumMonthlyKmFromUsages(
  usages: Array<{ kmDriven: unknown; checkoutKm: unknown; checkinKm: unknown }>
): number {
  return usages.reduce((sum, usage) => sum + computeUsageKmRecord(usage), 0);
}

export function rankTopVehiclesByMetric(
  vehicles: FleetExecutiveVehicleRow[],
  metric: "monthlyReservations" | "monthlyKm",
  limit = 5
): FleetExecutiveTopVehicle[] {
  const sorted = [...vehicles].sort((a, b) => b[metric] - a[metric]);
  return sorted
    .filter((v) => v[metric] > 0)
    .slice(0, limit)
    .map((v) => ({
      vehicleId: v.id,
      plate: v.plate,
      brand: v.brand,
      model: v.model,
      value: v[metric],
      label: `${v.plate} — ${v.brand} ${v.model}`,
    }));
}

export function rankTopIdleVehicles(
  vehicles: FleetExecutiveVehicleRow[],
  limit = 5
): Array<FleetExecutiveTopVehicle & { idleDays: number }> {
  return [...vehicles]
    .filter((v) => v.idleDays != null && v.idleDays > 0)
    .sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0))
    .slice(0, limit)
    .map((v) => ({
      vehicleId: v.id,
      plate: v.plate,
      brand: v.brand,
      model: v.model,
      value: v.idleDays ?? 0,
      label: `${v.plate} — ${v.brand} ${v.model}`,
      idleDays: v.idleDays ?? 0,
    }));
}

function fleetAlertToDto(alert: FleetAlertItem): FleetAlertDto {
  return {
    level: alert.level,
    code: alert.code,
    message: alert.message,
    entityType: alert.entityType,
    entityId: alert.entityId,
  };
}

function buildVehicleWhere(filters: FleetExecutiveDashboardFilters): Prisma.FleetVehicleWhereInput {
  const where: Prisma.FleetVehicleWhereInput = {};
  if (filters.vehicleStatus) where.status = filters.vehicleStatus as Prisma.EnumFleetVehicleStatusFilter;
  if (filters.vehicleType) where.vehicleType = { contains: filters.vehicleType, mode: "insensitive" };
  if (filters.plate) where.plate = { contains: filters.plate.replace(/[^a-zA-Z0-9]/g, ""), mode: "insensitive" };
  if (filters.unit) where.unit = { contains: filters.unit, mode: "insensitive" };
  if (filters.vehicleId) where.id = filters.vehicleId;
  return where;
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

export function buildFleetAttentionReservations(input: {
  reservations: Array<{
    id: string;
    status: string;
    endDateTime: Date;
    startDateTime: Date;
    driverId: string | null;
    vehicle: { plate: string; status: string };
    usage: { checkoutKm: unknown; checkinKm: unknown; kmDriven: unknown; status: string } | null;
  }>;
  now?: Date;
}): FleetExecutiveAttentionReservation[] {
  const now = input.now ?? new Date();
  const items: FleetExecutiveAttentionReservation[] = [];

  for (const r of input.reservations) {
    if (OVERDUE_RES_STATUSES.includes(r.status as (typeof OVERDUE_RES_STATUSES)[number]) && r.endDateTime < now) {
      items.push({
        id: r.id,
        plate: r.vehicle.plate,
        status: r.status,
        endDateTime: r.endDateTime.toISOString(),
        reason: "Devolução vencida sem fechamento",
        severity: "critical",
      });
    }
    if (r.status === "IN_USE" && r.usage && r.usage.status !== "CHECKED_IN" && !r.usage.checkinKm) {
      items.push({
        id: r.id,
        plate: r.vehicle.plate,
        status: r.status,
        endDateTime: r.endDateTime.toISOString(),
        reason: "Reserva em uso sem km de devolução",
        severity: "warning",
      });
    }
    if (!r.driverId) {
      items.push({
        id: r.id,
        plate: r.vehicle.plate,
        status: r.status,
        endDateTime: r.endDateTime.toISOString(),
        reason: "Reserva sem motorista/responsável",
        severity: "warning",
      });
    }
    if (
      r.vehicle.status === "MAINTENANCE" &&
      FLEET_ACTIVE_RESERVATION_STATUSES.includes(r.status as (typeof FLEET_ACTIVE_RESERVATION_STATUSES)[number])
    ) {
      items.push({
        id: r.id,
        plate: r.vehicle.plate,
        status: r.status,
        endDateTime: r.endDateTime.toISOString(),
        reason: "Veículo em manutenção com reserva ativa",
        severity: "critical",
      });
    }
    if (r.usage?.checkoutKm != null && r.usage.checkinKm != null) {
      const checkout = Number(r.usage.checkoutKm);
      const checkin = Number(r.usage.checkinKm);
      if (Number.isFinite(checkout) && Number.isFinite(checkin) && checkin < checkout) {
        items.push({
          id: r.id,
          plate: r.vehicle.plate,
          status: r.status,
          endDateTime: r.endDateTime.toISOString(),
          reason: "Km final menor que km inicial",
          severity: "critical",
        });
      }
    }
    if (
      FINISHED_RES_STATUSES.includes(r.status as (typeof FINISHED_RES_STATUSES)[number]) &&
      r.usage &&
      !r.usage.checkinKm
    ) {
      items.push({
        id: r.id,
        plate: r.vehicle.plate,
        status: r.status,
        endDateTime: r.endDateTime.toISOString(),
        reason: "Reserva finalizada sem km de devolução",
        severity: "warning",
      });
    }
  }

  return items.slice(0, 20);
}

export async function buildFleetExecutiveDashboard(
  filters: FleetExecutiveDashboardFilters,
  settings?: FleetSettingsMap,
  _showFinancial = true
): Promise<FleetExecutiveDashboard> {
  const { start: monthStart, end: monthEnd } = resolveFleetMonthRange(filters.year, filters.month);
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const vehicleWhere = buildVehicleWhere(filters);

  const [vehiclesRaw, monthReservations, activeReservations, monthUsages, operationalAlerts] =
    await Promise.all([
      prisma.fleetVehicle.findMany({
        where: vehicleWhere,
        select: {
          id: true,
          plate: true,
          brand: true,
          model: true,
          modelYear: true,
          status: true,
          vehicleType: true,
          unit: true,
          currentKm: true,
        },
        orderBy: { plate: "asc" },
      }),
      prisma.fleetReservation.findMany({
        where: {
          vehicle: vehicleWhere,
          startDateTime: { lt: monthEnd },
          endDateTime: { gt: monthStart },
          ...(filters.driverId ? { driverId: filters.driverId } : {}),
        },
        select: {
          id: true,
          vehicleId: true,
          driverId: true,
          status: true,
          startDateTime: true,
          endDateTime: true,
          driver: { select: { name: true } },
          vehicle: { select: { plate: true, status: true, brand: true, model: true } },
          usage: {
            select: { checkoutKm: true, checkinKm: true, kmDriven: true, status: true },
          },
        },
      }),
      prisma.fleetReservation.findMany({
        where: {
          vehicle: vehicleWhere,
          status: { in: [...FLEET_ACTIVE_RESERVATION_STATUSES] },
          ...(filters.driverId ? { driverId: filters.driverId } : {}),
        },
        select: {
          id: true,
          vehicleId: true,
          driverId: true,
          status: true,
          startDateTime: true,
          endDateTime: true,
          driver: { select: { name: true } },
          vehicle: { select: { plate: true, status: true } },
          usage: {
            select: { checkoutKm: true, checkinKm: true, kmDriven: true, status: true },
          },
        },
      }),
      prisma.fleetUsage.findMany({
        where: {
          status: "CHECKED_IN",
          checkinAt: { gte: monthStart, lt: monthEnd },
          reservation: {
            vehicle: vehicleWhere,
            ...(filters.driverId ? { driverId: filters.driverId } : {}),
          },
        },
        select: {
          reservationId: true,
          checkoutKm: true,
          checkinKm: true,
          kmDriven: true,
          reservation: { select: { vehicleId: true } },
        },
      }),
      buildFleetOperationalAlerts(settings),
    ]);

  const vCounts = summarizeVehicleStatusCounts(vehiclesRaw);
  const alerts = dedupeFleetAlerts(operationalAlerts);
  const alertDtos = alerts.map(fleetAlertToDto);

  const reservationsByStatus = summarizeReservationsByStatus(monthReservations);

  const kmByVehicleId = new Map<string, number>();
  for (const usage of monthUsages) {
    const vehicleId = usage.reservation.vehicleId;
    const km = computeUsageKmRecord(usage);
    kmByVehicleId.set(vehicleId, (kmByVehicleId.get(vehicleId) ?? 0) + km);
  }
  const monthlyKm = [...kmByVehicleId.values()].reduce((s, v) => s + v, 0);
  const monthlyKmDataAvailable = monthUsages.length > 0;

  const reservationsByVehicle = new Map<string, typeof monthReservations>();
  for (const r of monthReservations) {
    const list = reservationsByVehicle.get(r.vehicleId) ?? [];
    list.push(r);
    reservationsByVehicle.set(r.vehicleId, list);
  }

  const lastReservationByVehicle = new Map<string, (typeof monthReservations)[number]>();
  const nextReservationByVehicle = new Map<string, (typeof activeReservations)[number]>();
  for (const r of [...monthReservations, ...activeReservations]) {
    const prev = lastReservationByVehicle.get(r.vehicleId);
    if (!prev || r.endDateTime > prev.endDateTime) {
      lastReservationByVehicle.set(r.vehicleId, r);
    }
  }
  for (const r of activeReservations) {
    if (r.startDateTime >= now) {
      const prev = nextReservationByVehicle.get(r.vehicleId);
      if (!prev || r.startDateTime < prev.startDateTime) {
        nextReservationByVehicle.set(r.vehicleId, r);
      }
    }
  }

  const driverCounts = new Map<string, { name: string; count: number }>();
  for (const r of monthReservations) {
    if (!r.driverId) continue;
    const row = driverCounts.get(r.driverId) ?? { name: r.driver?.name ?? "Motorista", count: 0 };
    row.count += 1;
    driverCounts.set(r.driverId, row);
  }

  const vehicleRows: FleetExecutiveVehicleRow[] = vehiclesRaw.map((v) => {
    const vehicleAlerts = alertDtos.filter(
      (a) => a.entityType === "FleetVehicle" && a.entityId === v.id
    );
    const monthCount = (reservationsByVehicle.get(v.id) ?? []).length;
    const last = lastReservationByVehicle.get(v.id);
    const next = nextReservationByVehicle.get(v.id);
    const idleDays =
      last && last.endDateTime < now
        ? daysBetween(last.endDateTime, now)
        : monthCount === 0
          ? daysBetween(monthStart, now)
          : null;
    if (!v.plate?.trim()) {
      vehicleAlerts.push({
        level: "warning",
        code: "VEHICLE_NO_PLATE",
        message: "Veículo sem placa cadastrada",
        entityType: "FleetVehicle",
        entityId: v.id,
      });
    }
    if (v.currentKm == null) {
      vehicleAlerts.push({
        level: "info",
        code: "VEHICLE_NO_KM",
        message: `Sem km atual: ${v.brand} ${v.model}`,
        entityType: "FleetVehicle",
        entityId: v.id,
      });
    }
    return {
      id: v.id,
      plate: v.plate,
      brand: v.brand,
      model: v.model,
      modelYear: v.modelYear,
      status: v.status,
      vehicleType: v.vehicleType,
      unit: v.unit,
      currentKm: v.currentKm != null ? Number(v.currentKm) : null,
      monthlyKm: kmByVehicleId.get(v.id) ?? 0,
      monthlyReservations: monthCount,
      lastReservation: last
        ? {
            id: last.id,
            startDateTime: last.startDateTime.toISOString(),
            endDateTime: last.endDateTime.toISOString(),
            status: last.status,
            driverName: last.driver?.name ?? null,
          }
        : null,
      nextReservation: next
        ? {
            id: next.id,
            startDateTime: next.startDateTime.toISOString(),
            endDateTime: next.endDateTime.toISOString(),
            status: next.status,
            driverName: next.driver?.name ?? null,
          }
        : null,
      idleDays,
      alerts: vehicleAlerts,
      alertCount: vehicleAlerts.length,
    };
  });

  const topVehiclesByReservation = rankTopVehiclesByMetric(vehicleRows, "monthlyReservations");
  const topVehiclesByKm = rankTopVehiclesByMetric(vehicleRows, "monthlyKm");
  const topIdleVehicles = rankTopIdleVehicles(vehicleRows);

  const openReservations = activeReservations.filter((r) =>
    OPEN_RES_STATUSES.includes(r.status as (typeof OPEN_RES_STATUSES)[number])
  ).length;
  const inProgress = activeReservations.filter((r) =>
    IN_PROGRESS_RES_STATUSES.includes(r.status as (typeof IN_PROGRESS_RES_STATUSES)[number])
  ).length;
  const finishedInMonth = monthReservations.filter((r) =>
    FINISHED_RES_STATUSES.includes(r.status as (typeof FINISHED_RES_STATUSES)[number])
  ).length;
  const canceledInMonth = monthReservations.filter((r) =>
    CANCELED_RES_STATUSES.includes(r.status as (typeof CANCELED_RES_STATUSES)[number])
  ).length;
  const overdue = activeReservations.filter(
    (r) =>
      OVERDUE_RES_STATUSES.includes(r.status as (typeof OVERDUE_RES_STATUSES)[number]) &&
      r.endDateTime < now
  ).length;
  const today = monthReservations.filter(
    (r) =>
      r.startDateTime <= endOfDay &&
      r.endDateTime >= startOfDay &&
      !CANCELED_RES_STATUSES.includes(r.status as (typeof CANCELED_RES_STATUSES)[number])
  ).length;
  const upcoming = activeReservations.filter((r) => r.startDateTime > endOfDay).length;

  const attentionReservations = buildFleetAttentionReservations({
    reservations: [...activeReservations, ...monthReservations],
    now,
  });

  const criticalAlerts = alertDtos.filter((a) => a.level === "critical").length;
  const warningAlerts = alertDtos.filter((a) => a.level === "warning").length;
  const infoAlerts = alertDtos.filter((a) => a.level === "info").length;

  return {
    filters,
    competenceLabel: competenceLabel(filters.year, filters.month),
    summary: {
      totalVehicles: vehiclesRaw.length,
      activeVehicles: vCounts.totalOperational,
      inactiveVehicles: vCounts.inactiveReturnedSold,
      availableVehicles: vCounts.available,
      inUseVehicles: vCounts.inUse,
      reservedVehicles: vCounts.reserved,
      maintenanceVehicles: vCounts.maintenance,
      openReservations,
      closedReservationsInMonth: finishedInMonth,
      monthlyKm,
      monthlyKmDataAvailable,
      topReservedVehicle: topVehiclesByReservation[0] ?? null,
      topKmVehicle: topVehiclesByKm[0] ?? null,
      activeAlerts: alertDtos.length,
      criticalAlerts,
      warningAlerts,
      infoAlerts,
    },
    reservationsByStatus,
    reservationSummary: {
      open: openReservations,
      inProgress,
      finished: finishedInMonth,
      canceled: canceledInMonth,
      overdue,
      today,
      upcoming,
    },
    kmByVehicle: topVehiclesByKm.map((v) => ({
      vehicleId: v.vehicleId,
      plate: v.plate,
      label: v.label,
      km: v.value,
    })),
    topVehiclesByReservation,
    topVehiclesByKm,
    topIdleVehicles,
    topDrivers: [...driverCounts.entries()]
      .map(([driverId, row]) => ({ driverId, name: row.name, reservations: row.count }))
      .sort((a, b) => b.reservations - a.reservations)
      .slice(0, 5),
    attentionReservations,
    vehicles: vehicleRows.sort((a, b) => b.monthlyKm - a.monthlyKm || b.monthlyReservations - a.monthlyReservations),
    alerts: alertDtos,
  };
}
