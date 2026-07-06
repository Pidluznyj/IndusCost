import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { FleetSettingsMap } from "@/src/lib/fleetService.js";
import { loadFleetSettings } from "@/src/lib/fleetService.js";
import {
  computeCnhStatus,
  computeDocumentStatus,
  isContractExpired,
  isContractExpiringSoon,
} from "@/src/lib/fleetValidation.js";

export type FleetAlertItem = {
  level: "critical" | "warning" | "info";
  code: string;
  message: string;
  entityType?: string;
  entityId?: string;
};

/** Alertas com valor/custo — ocultos sem fleet.financial.view ou fleet.manage */
export const FINANCIAL_FLEET_ALERT_CODES = new Set([
  "FINE_PENDING_PAYMENT",
  "COST_OVER_BUDGET",
  "CONTRACT_MONTHLY_RENEWAL",
]);

const LEVEL_ORDER: Record<FleetAlertItem["level"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function fleetAlertDedupeKey(alert: FleetAlertItem): string {
  return `${alert.code}|${alert.entityType ?? ""}|${alert.entityId ?? ""}`;
}

export function dedupeFleetAlerts(alerts: FleetAlertItem[]): FleetAlertItem[] {
  const seen = new Set<string>();
  const out: FleetAlertItem[] = [];
  for (const a of alerts) {
    const key = fleetAlertDedupeKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

export function filterFleetAlertsByPermission(
  alerts: FleetAlertItem[],
  showFinancial: boolean
): FleetAlertItem[] {
  if (showFinancial) return alerts;
  return alerts.filter((a) => !FINANCIAL_FLEET_ALERT_CODES.has(a.code));
}

export function parseFleetAlertThresholds(settings: FleetSettingsMap) {
  return {
    docDays: Number(settings.diasAlertaDocumento ?? "30") || 30,
    cnhDays: Number(settings.diasAlertaCnh ?? "30") || 30,
    contractDays: Number(settings.diasAlertaDocumento ?? "30") || 30,
    kmFranchisePct: Number(settings.percentualAlertaFranquiaKm ?? "80") || 80,
    maintenanceUpcomingDays: 7,
  };
}

export function documentToFleetAlert(
  doc: {
    id: string;
    documentType: string;
    expirationDate: Date | null;
    vehicle: { plate: string | null; brand: string };
  },
  alertDays: number,
  now = new Date()
): FleetAlertItem | null {
  const st = computeDocumentStatus(doc.expirationDate, alertDays, now);
  const label = doc.vehicle.plate ?? doc.vehicle.brand;
  if (st === "EXPIRED") {
    return {
      level: "critical",
      code: "DOCUMENT_EXPIRED",
      message: `Documento vencido (${doc.documentType}): ${label}`,
      entityType: "FleetVehicleDocument",
      entityId: doc.id,
    };
  }
  if (st === "EXPIRING") {
    return {
      level: "warning",
      code: "DOCUMENT_EXPIRING",
      message: `Documento vencendo (${doc.documentType}): ${label}`,
      entityType: "FleetVehicleDocument",
      entityId: doc.id,
    };
  }
  return null;
}

export function driverCnhToFleetAlert(
  driver: {
    id: string;
    name: string;
    cnhExpirationDate: Date | null;
    status: string;
  },
  alertDays: number,
  now = new Date()
): FleetAlertItem | null {
  const st = computeCnhStatus(driver.cnhExpirationDate, alertDays, now);
  if (st === "EXPIRED") {
    return {
      level: "critical",
      code: "CNH_EXPIRED",
      message: `CNH vencida: ${driver.name}`,
      entityType: "FleetDriver",
      entityId: driver.id,
    };
  }
  if (st === "EXPIRING") {
    return {
      level: "warning",
      code: "CNH_EXPIRING",
      message: `CNH vencendo: ${driver.name}`,
      entityType: "FleetDriver",
      entityId: driver.id,
    };
  }
  return null;
}

export function contractToFleetAlert(
  contract: {
    id: string;
    contractNumber: string | null;
    endDate: Date | null;
    vehicle: { plate: string | null; brand: string };
  },
  contractAlertDays: number,
  now = new Date()
): FleetAlertItem | null {
  const label = contract.vehicle.plate ?? contract.vehicle.brand;
  if (isContractExpired(contract.endDate, now)) {
    return {
      level: "critical",
      code: "CONTRACT_EXPIRED",
      message: `Contrato vencido: ${label}${contract.contractNumber ? ` (${contract.contractNumber})` : ""}`,
      entityType: "FleetVehicleContract",
      entityId: contract.id,
    };
  }
  if (isContractExpiringSoon(contract.endDate, contractAlertDays, now)) {
    return {
      level: "warning",
      code: "CONTRACT_EXPIRING",
      message: `Contrato vencendo: ${label}`,
      entityType: "FleetVehicleContract",
      entityId: contract.id,
    };
  }
  return null;
}

export function reservationOverdueToFleetAlert(reservation: {
  id: string;
  vehicle: { plate: string | null; brand: string };
}): FleetAlertItem {
  return {
    level: "critical",
    code: "RESERVATION_OVERDUE",
    message: `Reserva atrasada: ${reservation.vehicle.plate ?? reservation.vehicle.brand}`,
    entityType: "FleetReservation",
    entityId: reservation.id,
  };
}

async function buildMaintenanceOperationalAlerts(
  maintenanceUpcomingDays: number
): Promise<FleetAlertItem[]> {
  const now = new Date();
  const soon = new Date(now);
  soon.setDate(soon.getDate() + maintenanceUpcomingDays);

  const [overdue, upcoming] = await Promise.all([
    prisma.fleetMaintenance.findMany({
      where: {
        maintenanceType: { equals: "PREVENTIVA", mode: "insensitive" },
        status: { in: ["SCHEDULED", "OPEN"] },
        scheduledAt: { lt: now },
      },
      include: { vehicle: { select: { plate: true, brand: true, model: true } } },
      take: 50,
    }),
    prisma.fleetMaintenance.findMany({
      where: {
        maintenanceType: { equals: "PREVENTIVA", mode: "insensitive" },
        status: { in: ["SCHEDULED", "OPEN"] },
        scheduledAt: { gte: now, lte: soon },
      },
      include: { vehicle: { select: { plate: true, brand: true, model: true } } },
      take: 50,
    }),
  ]);

  const alerts: FleetAlertItem[] = [];
  for (const m of overdue) {
    alerts.push({
      level: "critical",
      code: "MAINTENANCE_OVERDUE",
      message: `Manutenção vencida: ${m.vehicle.plate ?? m.vehicle.brand} — ${m.description}`,
      entityType: "FleetMaintenance",
      entityId: m.id,
    });
  }
  for (const m of upcoming) {
    alerts.push({
      level: "warning",
      code: "MAINTENANCE_UPCOMING",
      message: `Manutenção próxima: ${m.vehicle.plate ?? m.vehicle.brand} — ${m.description}`,
      entityType: "FleetMaintenance",
      entityId: m.id,
    });
  }
  return alerts;
}

async function buildContractKmFranchiseAlerts(
  kmFranchisePct: number
): Promise<FleetAlertItem[]> {
  const contracts = await prisma.fleetVehicleContract.findMany({
    where: { status: "ACTIVE", kmFranchise: { not: null } },
    include: {
      vehicle: { select: { id: true, plate: true, brand: true, currentKm: true } },
    },
    take: 100,
  });

  const alerts: FleetAlertItem[] = [];
  for (const c of contracts) {
    const franchise = Number(c.kmFranchise ?? 0);
    if (franchise <= 0) continue;
    const currentKm = Number(c.vehicle.currentKm);
    const threshold = franchise * (kmFranchisePct / 100);
    if (currentKm >= threshold) {
      alerts.push({
        level: currentKm >= franchise ? "critical" : "warning",
        code: "CONTRACT_KM_FRANCHISE",
        message: `Franquia de km (${kmFranchisePct}%): ${c.vehicle.plate ?? c.vehicle.brand} — ${currentKm.toLocaleString("pt-BR")} / ${franchise.toLocaleString("pt-BR")} km`,
        entityType: "FleetVehicleContract",
        entityId: c.id,
      });
    }
  }
  return alerts;
}

/**
 * Calcula alertas operacionais da frota com base no estado atual do banco.
 * Alertas são derivados (não persistidos): causas corrigidas deixam de aparecer na próxima execução.
 */
export async function buildFleetOperationalAlerts(
  settings?: FleetSettingsMap
): Promise<FleetAlertItem[]> {
  const cfg = settings ?? (await loadFleetSettings());
  const t = parseFleetAlertThresholds(cfg);
  const now = new Date();
  const alerts: FleetAlertItem[] = [];

  const documents = await prisma.fleetVehicleDocument.findMany({
    where: { status: { not: "REPLACED" }, expirationDate: { not: null } },
    include: { vehicle: { select: { plate: true, brand: true, model: true } } },
    take: 500,
  });
  for (const d of documents) {
    const a = documentToFleetAlert(d, t.docDays, now);
    if (a) alerts.push(a);
  }

  const drivers = await prisma.fleetDriver.findMany({
    where: { status: { not: "INACTIVE" } },
    select: { id: true, name: true, cnhExpirationDate: true, status: true },
    take: 500,
  });
  for (const d of drivers) {
    const a = driverCnhToFleetAlert(d, t.cnhDays, now);
    if (a) alerts.push(a);
  }

  const contracts = await prisma.fleetVehicleContract.findMany({
    where: { status: "ACTIVE" },
    include: { vehicle: { select: { plate: true, brand: true } } },
    take: 200,
  });
  for (const c of contracts) {
    const a = contractToFleetAlert(c, t.contractDays, now);
    if (a) alerts.push(a);
  }

  alerts.push(...(await buildMaintenanceOperationalAlerts(t.maintenanceUpcomingDays)));
  alerts.push(...(await buildContractKmFranchiseAlerts(t.kmFranchisePct)));

  const overdueReservations = await prisma.fleetReservation.findMany({
    where: {
      endDateTime: { lt: now },
      status: { in: ["APPROVED", "IN_USE", "PENDING_APPROVAL"] },
    },
    include: { vehicle: { select: { plate: true, brand: true } } },
    take: 50,
  });
  for (const r of overdueReservations) {
    alerts.push(reservationOverdueToFleetAlert(r));
  }

  const noShowSince = new Date(now);
  noShowSince.setDate(noShowSince.getDate() - 30);
  const noShows = await prisma.fleetReservation.findMany({
    where: {
      status: "NO_SHOW",
      endDateTime: { gte: noShowSince },
    },
    include: { vehicle: { select: { plate: true } } },
    orderBy: { endDateTime: "desc" },
    take: 20,
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
    take: 50,
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
    take: 50,
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

  const finesPendingPayment = await prisma.fleetFine.findMany({
    where: { status: "PENDING_PAYMENT" },
    include: { vehicle: { select: { plate: true } } },
    take: 30,
  });
  for (const f of finesPendingPayment) {
    alerts.push({
      level: "warning",
      code: "FINE_PENDING_PAYMENT",
      message: `Multa com pagamento pendente: ${f.vehicle.plate ?? "veículo"}`,
      entityType: "FleetFine",
      entityId: f.id,
    });
  }

  const openIncidents = await prisma.fleetIncident.findMany({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
    include: { vehicle: { select: { plate: true, brand: true } } },
    take: 30,
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

  return dedupeFleetAlerts(alerts);
}

export async function getFleetAlerts(input?: {
  settings?: FleetSettingsMap;
  showFinancial?: boolean;
  level?: string;
}): Promise<{ alerts: FleetAlertItem[]; count: number }> {
  let alerts = await buildFleetOperationalAlerts(input?.settings);
  alerts = filterFleetAlertsByPermission(alerts, input?.showFinancial ?? false);
  const level = input?.level?.trim();
  if (level) {
    alerts = alerts.filter((a) => a.level === level);
  }
  return { alerts, count: alerts.length };
}

/** @deprecated Use buildFleetOperationalAlerts — mantido para compatibilidade */
export const buildFleetAlerts = buildFleetOperationalAlerts;
