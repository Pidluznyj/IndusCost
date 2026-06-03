/**
 * Diagnóstico read-only de integridade — Gestão de Frota.
 * Não altera dados. Funções puras testáveis + runner com Prisma.
 */
import type { PrismaClient } from "@prisma/client";
import type {
  FleetDocumentStatus,
  FleetDriverStatus,
  FleetReservationStatus,
  FleetUsageStatus,
  FleetVehicleStatus,
} from "@prisma/client";
import {
  computeDocumentStatus,
  computeKmDriven,
  FLEET_ACTIVE_RESERVATION_STATUSES,
  FLEET_MAINTENANCE_TERMINAL_STATUSES,
  isContractExpired,
  isVehicleReservable,
  parseDecimalKm,
  reservationPeriodsOverlap,
} from "@/src/lib/fleetValidation.js";

export type FleetIntegritySeverity = "critical" | "high" | "medium" | "low";

export type FleetIntegrityIssue = {
  severity: FleetIntegritySeverity;
  entity: string;
  entityId: string;
  code: string;
  message: string;
  suggestedFix: string;
  safeAutoFix: boolean;
};

export type FleetIntegrityReport = {
  generatedAt: string;
  readOnly: true;
  totalIssues: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  issues: FleetIntegrityIssue[];
};

/** Reservas que ocupam agenda / impedem sobreposição. */
export const FLEET_OCCUPYING_RESERVATION_STATUSES: FleetReservationStatus[] =
  FLEET_ACTIVE_RESERVATION_STATUSES;

const DISPOSED_VEHICLE_STATUSES: FleetVehicleStatus[] = ["INACTIVE", "SOLD", "RETURNED"];
const FINISHED_RESERVATION_STATUSES: FleetReservationStatus[] = [
  "FINISHED",
  "FINISHED_WITH_PENDING",
];
const ACTIVE_DRIVER_STATUSES: FleetDriverStatus[] = ["AUTHORIZED", "PENDING", "BLOCKED"];

const KM_TOLERANCE = 0.01;

export function issue(
  partial: Omit<FleetIntegrityIssue, "safeAutoFix"> & { safeAutoFix?: boolean }
): FleetIntegrityIssue {
  return { safeAutoFix: false, ...partial };
}

export function summarizeFleetIntegrityReport(issues: FleetIntegrityIssue[]): FleetIntegrityReport {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of issues) counts[i.severity]++;
  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    totalIssues: issues.length,
    ...counts,
    issues,
  };
}

function dec(value: unknown): number | null {
  return parseDecimalKm(value);
}

/** Detecta pares de reservas sobrepostas no mesmo veículo (status ocupante). */
export function detectReservationOverlaps<
  T extends {
    id: string;
    vehicleId: string;
    startDateTime: Date;
    endDateTime: Date;
    status: FleetReservationStatus;
  }
>(reservations: T[]): FleetIntegrityIssue[] {
  const issues: FleetIntegrityIssue[] = [];
  const occupying = reservations.filter((r) =>
    FLEET_OCCUPYING_RESERVATION_STATUSES.includes(r.status)
  );
  const byVehicle = new Map<string, T[]>();
  for (const r of occupying) {
    const list = byVehicle.get(r.vehicleId) ?? [];
    list.push(r);
    byVehicle.set(r.vehicleId, list);
  }

  for (const [, list] of byVehicle) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (
          reservationPeriodsOverlap(
            a.startDateTime,
            a.endDateTime,
            b.startDateTime,
            b.endDateTime
          )
        ) {
          issues.push(
            issue({
              severity: "critical",
              entity: "FleetReservation",
              entityId: a.id,
              code: "RESERVATION_OVERLAP",
              message: `Reserva ${a.id} sobrepõe ${b.id} no mesmo veículo (${a.vehicleId}).`,
              suggestedFix:
                "Cancelar ou ajustar período de uma das reservas; sincronizar status do veículo.",
            })
          );
        }
      }
    }
  }
  return issues;
}

/** kmDriven divergente de checkinKm - checkoutKm. */
export function detectUsageKmDrivenMismatch<
  T extends {
    id: string;
    checkoutKm: unknown;
    checkinKm: unknown;
    kmDriven: unknown;
  }
>(usages: T[]): FleetIntegrityIssue[] {
  const issues: FleetIntegrityIssue[] = [];
  for (const u of usages) {
    const checkout = dec(u.checkoutKm);
    const checkin = dec(u.checkinKm);
    const driven = dec(u.kmDriven);
    if (checkout == null || checkin == null || driven == null) continue;
    if (checkin < checkout) {
      issues.push(
        issue({
          severity: "critical",
          entity: "FleetUsage",
          entityId: u.id,
          code: "USAGE_CHECKIN_KM_LT_CHECKOUT",
          message: `Usage ${u.id}: checkinKm (${checkin}) < checkoutKm (${checkout}).`,
          suggestedFix: "Corrigir quilometragens de retirada/devolução e recalcular kmDriven.",
        })
      );
      continue;
    }
    let expected: number;
    try {
      expected = computeKmDriven(checkout, checkin);
    } catch {
      continue;
    }
    if (Math.abs(driven - expected) > KM_TOLERANCE) {
      issues.push(
        issue({
          severity: "high",
          entity: "FleetUsage",
          entityId: u.id,
          code: "USAGE_KM_DRIVEN_MISMATCH",
          message: `Usage ${u.id}: kmDriven=${driven}, esperado ${expected} (checkin - checkout).`,
          suggestedFix: "Atualizar kmDriven para checkinKm - checkoutKm.",
          safeAutoFix: true,
        })
      );
    }
  }
  return issues;
}

/** Documento com status gravado diferente do calculado por vencimento. */
export function detectDocumentStatusMismatch<
  T extends {
    id: string;
    vehicleId: string;
    expirationDate: Date | null;
    status: FleetDocumentStatus;
  }
>(documents: T[], alertDays: number, now: Date = new Date()): FleetIntegrityIssue[] {
  const issues: FleetIntegrityIssue[] = [];
  for (const d of documents) {
    if (d.status === "REPLACED") continue;
    const expected = computeDocumentStatus(d.expirationDate, alertDays, now);
    if (d.status === expected) continue;

    const expiredStoredValid =
      d.status === "VALID" && (expected === "EXPIRED" || expected === "EXPIRING");
    const validStoredExpired = d.status === "EXPIRED" && expected === "VALID";

    if (expiredStoredValid) {
      issues.push(
        issue({
          severity: "high",
          entity: "FleetVehicleDocument",
          entityId: d.id,
          code: "DOCUMENT_STATUS_STALE_VALID",
          message: `Documento ${d.id}: status VALID mas calculado ${expected} (vencimento ${d.expirationDate?.toISOString().slice(0, 10) ?? "—"}).`,
          suggestedFix: "Executar refresh de status de documentos ou atualizar manualmente para EXPIRED/EXPIRING.",
          safeAutoFix: true,
        })
      );
    } else if (validStoredExpired) {
      issues.push(
        issue({
          severity: "medium",
          entity: "FleetVehicleDocument",
          entityId: d.id,
          code: "DOCUMENT_STATUS_STALE_EXPIRED",
          message: `Documento ${d.id}: status EXPIRED mas calculado VALID.`,
          suggestedFix: "Renovar data de vencimento ou atualizar status para VALID.",
        })
      );
    } else if (d.status !== expected) {
      issues.push(
        issue({
          severity: "medium",
          entity: "FleetVehicleDocument",
          entityId: d.id,
          code: "DOCUMENT_STATUS_MISMATCH",
          message: `Documento ${d.id}: status ${d.status}, esperado ${expected}.`,
          suggestedFix: "Alinhar status ao vencimento (refreshDocumentStatuses).",
          safeAutoFix: true,
        })
      );
    }
  }
  return issues;
}

/** Veículo IN_USE sem usage em aberto (CHECKED_OUT). */
export function detectVehicleInUseWithoutOpenUsage<
  V extends { id: string; status: FleetVehicleStatus },
  U extends { id: string; vehicleId: string; status: FleetUsageStatus }
>(vehicles: V[], usages: U[]): FleetIntegrityIssue[] {
  const issues: FleetIntegrityIssue[] = [];
  const openByVehicle = new Set(
    usages.filter((u) => u.status === "CHECKED_OUT").map((u) => u.vehicleId)
  );
  for (const v of vehicles) {
    if (v.status !== "IN_USE") continue;
    if (!openByVehicle.has(v.id)) {
      issues.push(
        issue({
          severity: "critical",
          entity: "FleetVehicle",
          entityId: v.id,
          code: "VEHICLE_IN_USE_WITHOUT_OPEN_USAGE",
          message: `Veículo ${v.id} está IN_USE sem FleetUsage CHECKED_OUT.`,
          suggestedFix:
            "Abrir usage vinculado à reserva IN_USE ou reverter status do veículo para AVAILABLE/RESERVED.",
        })
      );
    }
  }
  return issues;
}

/** Mesmo critério de buildFleetFinancialDashboard — só ACTIVE entram no total. */
export function filterCostsForDashboard<T extends { status: string }>(costs: T[]): T[] {
  return costs.filter((c) => c.status === "ACTIVE");
}

export function sumCostAmounts(costs: { amount: unknown }[]): number {
  return costs.reduce((s, c) => s + (dec(c.amount) ?? 0), 0);
}

/** Alerta se custos cancelados com valor poderiam distorcer relatório sem filtro ACTIVE. */
export function detectCanceledCostsInDashboardSum(
  costs: { id: string; status: string; amount: unknown }[]
): FleetIntegrityIssue[] {
  const issues: FleetIntegrityIssue[] = [];
  const activeSum = sumCostAmounts(filterCostsForDashboard(costs));
  const allSum = sumCostAmounts(costs);
  const canceled = costs.filter((c) => c.status === "CANCELED");
  const canceledSum = sumCostAmounts(canceled);
  if (canceled.length > 0 && canceledSum > 0 && Math.abs(activeSum - allSum) < KM_TOLERANCE) {
    issues.push(
      issue({
        severity: "low",
        entity: "FleetCost",
        entityId: "dashboard-filter",
        code: "CANCELED_COSTS_PRESENT_VERIFY_DASHBOARD_FILTER",
        message: `${canceled.length} custo(s) cancelado(s) com total R$ ${canceledSum.toFixed(2)}; dashboard deve filtrar status=ACTIVE.`,
        suggestedFix: "Confirmar que APIs usam status ACTIVE (buildFleetFinancialDashboard).",
      })
    );
  }
  return issues;
}

export type FleetIntegrityDataset = {
  now: Date;
  docAlertDays: number;
  vehicles: Awaited<ReturnType<typeof loadVehicles>>;
  reservations: Awaited<ReturnType<typeof loadReservations>>;
  drivers: Awaited<ReturnType<typeof loadDrivers>>;
  usages: Awaited<ReturnType<typeof loadUsages>>;
  maintenances: Awaited<ReturnType<typeof loadMaintenances>>;
  documents: Awaited<ReturnType<typeof loadDocuments>>;
  contracts: Awaited<ReturnType<typeof loadContracts>>;
  costs: Awaited<ReturnType<typeof loadCosts>>;
  orphanRows: Awaited<ReturnType<typeof findOrphanFkRows>>;
};

async function loadVehicles(prisma: PrismaClient) {
  return prisma.fleetVehicle.findMany({
    select: { id: true, plate: true, status: true, currentKm: true },
  });
}

async function loadReservations(prisma: PrismaClient) {
  return prisma.fleetReservation.findMany({
    select: {
      id: true,
      vehicleId: true,
      driverId: true,
      startDateTime: true,
      endDateTime: true,
      status: true,
    },
  });
}

async function loadDrivers(prisma: PrismaClient) {
  return prisma.fleetDriver.findMany({
    select: {
      id: true,
      name: true,
      cpf: true,
      status: true,
      cnhExpirationDate: true,
    },
  });
}

async function loadUsages(prisma: PrismaClient) {
  return prisma.fleetUsage.findMany({
    select: {
      id: true,
      reservationId: true,
      vehicleId: true,
      status: true,
      checkoutKm: true,
      checkinKm: true,
      kmDriven: true,
      checkoutAt: true,
      checkinAt: true,
    },
  });
}

async function loadMaintenances(prisma: PrismaClient) {
  return prisma.fleetMaintenance.findMany({
    select: {
      id: true,
      vehicleId: true,
      status: true,
      blocksVehicle: true,
      estimatedValue: true,
      finalValue: true,
    },
  });
}

async function loadDocuments(prisma: PrismaClient) {
  return prisma.fleetVehicleDocument.findMany({
    select: { id: true, vehicleId: true, expirationDate: true, status: true },
  });
}

async function loadContracts(prisma: PrismaClient) {
  return prisma.fleetVehicleContract.findMany({
    select: { id: true, vehicleId: true, startDate: true, endDate: true, status: true },
  });
}

async function loadCosts(prisma: PrismaClient) {
  return prisma.fleetCost.findMany({
    select: {
      id: true,
      vehicleId: true,
      contractId: true,
      maintenanceId: true,
      reservationId: true,
      status: true,
      amount: true,
    },
  });
}

/** FKs órfãs via SQL (registros com id inexistente na tabela pai). */
export async function findOrphanFkRows(prisma: PrismaClient) {
  const checks: { entity: string; code: string; sql: string }[] = [
    {
      entity: "FleetReservation",
      code: "ORPHAN_RESERVATION_VEHICLE",
      sql: `SELECT r.id FROM "FleetReservation" r
            LEFT JOIN "FleetVehicle" v ON v.id = r."vehicleId"
            WHERE v.id IS NULL`,
    },
    {
      entity: "FleetUsage",
      code: "ORPHAN_USAGE_RESERVATION",
      sql: `SELECT u.id FROM "FleetUsage" u
            LEFT JOIN "FleetReservation" r ON r.id = u."reservationId"
            WHERE r.id IS NULL`,
    },
    {
      entity: "FleetUsage",
      code: "ORPHAN_USAGE_VEHICLE",
      sql: `SELECT u.id FROM "FleetUsage" u
            LEFT JOIN "FleetVehicle" v ON v.id = u."vehicleId"
            WHERE v.id IS NULL`,
    },
    {
      entity: "FleetCost",
      code: "ORPHAN_COST_VEHICLE",
      sql: `SELECT c.id FROM "FleetCost" c
            LEFT JOIN "FleetVehicle" v ON v.id = c."vehicleId"
            WHERE v.id IS NULL`,
    },
    {
      entity: "FleetVehicleDocument",
      code: "ORPHAN_DOCUMENT_VEHICLE",
      sql: `SELECT d.id FROM "FleetVehicleDocument" d
            LEFT JOIN "FleetVehicle" v ON v.id = d."vehicleId"
            WHERE v.id IS NULL`,
    },
    {
      entity: "FleetMaintenance",
      code: "ORPHAN_MAINTENANCE_VEHICLE",
      sql: `SELECT m.id FROM "FleetMaintenance" m
            LEFT JOIN "FleetVehicle" v ON v.id = m."vehicleId"
            WHERE v.id IS NULL`,
    },
  ];

  const orphans: { entity: string; entityId: string; code: string }[] = [];
  for (const c of checks) {
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(c.sql);
    for (const row of rows) {
      orphans.push({ entity: c.entity, entityId: row.id, code: c.code });
    }
  }
  return orphans;
}

export async function loadFleetIntegrityDataset(prisma: PrismaClient): Promise<FleetIntegrityDataset> {
  const now = new Date();
  const setting = await prisma.fleetSettings.findUnique({
    where: { key: "diasAlertaDocumento" },
  });
  const docAlertDays = setting?.value ? Math.max(0, parseInt(setting.value, 10) || 30) : 30;

  const [
    vehicles,
    reservations,
    drivers,
    usages,
    maintenances,
    documents,
    contracts,
    costs,
    orphanRows,
  ] = await Promise.all([
    loadVehicles(prisma),
    loadReservations(prisma),
    loadDrivers(prisma),
    loadUsages(prisma),
    loadMaintenances(prisma),
    loadDocuments(prisma),
    loadContracts(prisma),
    loadCosts(prisma),
    findOrphanFkRows(prisma),
  ]);

  return {
    now,
    docAlertDays,
    vehicles,
    reservations,
    drivers,
    usages,
    maintenances,
    documents,
    contracts,
    costs,
    orphanRows,
  };
}

/** Executa todas as regras sobre um dataset já carregado (testável sem DB). */
export function runFleetIntegrityChecks(data: FleetIntegrityDataset): FleetIntegrityIssue[] {
  const issues: FleetIntegrityIssue[] = [];
  const { now, docAlertDays } = data;

  const vehicleById = new Map(data.vehicles.map((v) => [v.id, v]));
  const usageByReservation = new Map(data.usages.map((u) => [u.reservationId, u]));
  const openMaintenancesByVehicle = new Map<string, typeof data.maintenances>();
  for (const m of data.maintenances) {
    if (FLEET_MAINTENANCE_TERMINAL_STATUSES.includes(m.status)) continue;
    if (!m.blocksVehicle) continue;
    const list = openMaintenancesByVehicle.get(m.vehicleId) ?? [];
    list.push(m);
    openMaintenancesByVehicle.set(m.vehicleId, list);
  }

  issues.push(...detectReservationOverlaps(data.reservations));
  issues.push(...detectUsageKmDrivenMismatch(data.usages));
  issues.push(...detectDocumentStatusMismatch(data.documents, docAlertDays, now));
  issues.push(...detectVehicleInUseWithoutOpenUsage(data.vehicles, data.usages));
  issues.push(...detectCanceledCostsInDashboardSum(data.costs));

  for (const v of data.vehicles) {
    const km = dec(v.currentKm);
    if (km != null && km < 0) {
      issues.push(
        issue({
          severity: "high",
          entity: "FleetVehicle",
          entityId: v.id,
          code: "VEHICLE_NEGATIVE_CURRENT_KM",
          message: `Veículo ${v.plate ?? v.id}: currentKm negativo (${km}).`,
          suggestedFix: "Corrigir currentKm com base no último check-in válido.",
        })
      );
    }

    if (v.status === "AVAILABLE") {
      const inUseRes = data.reservations.find(
        (r) => r.vehicleId === v.id && r.status === "IN_USE"
      );
      if (inUseRes) {
        issues.push(
          issue({
            severity: "critical",
            entity: "FleetVehicle",
            entityId: v.id,
            code: "VEHICLE_AVAILABLE_WITH_IN_USE_RESERVATION",
            message: `Veículo AVAILABLE com reserva IN_USE (${inUseRes.id}).`,
            suggestedFix: "Atualizar status do veículo para IN_USE ou finalizar reserva.",
          })
        );
      }
    }

    if (v.status === "MAINTENANCE" || v.status === "BLOCKED") {
      const blocking = openMaintenancesByVehicle.get(v.id) ?? [];
      if (blocking.length === 0) {
        issues.push(
          issue({
            severity: "high",
            entity: "FleetVehicle",
            entityId: v.id,
            code: "VEHICLE_MAINTENANCE_WITHOUT_BLOCKING_JOB",
            message: `Veículo ${v.status} sem manutenção aberta com blocksVehicle=true.`,
            suggestedFix: "Abrir manutenção bloqueante ou liberar status do veículo.",
          })
        );
      }
    }

    if (DISPOSED_VEHICLE_STATUSES.includes(v.status)) {
      const futureActive = data.reservations.filter(
        (r) =>
          r.vehicleId === v.id &&
          FLEET_OCCUPYING_RESERVATION_STATUSES.includes(r.status) &&
          r.endDateTime.getTime() > now.getTime()
      );
      for (const r of futureActive) {
        issues.push(
          issue({
            severity: "high",
            entity: "FleetReservation",
            entityId: r.id,
            code: "DISPOSED_VEHICLE_FUTURE_RESERVATION",
            message: `Veículo ${v.status} com reserva futura ativa ${r.id}.`,
            suggestedFix: "Cancelar reserva ou reativar veículo.",
          })
        );
      }
    }

    const lastCheckin = data.usages
      .filter((u) => u.vehicleId === v.id && u.status === "CHECKED_IN" && dec(u.checkinKm) != null)
      .map((u) => dec(u.checkinKm)!)
      .reduce((max, k) => Math.max(max, k), -Infinity);
    if (km != null && lastCheckin >= 0 && km < lastCheckin - KM_TOLERANCE) {
      issues.push(
        issue({
          severity: "high",
          entity: "FleetVehicle",
          entityId: v.id,
          code: "VEHICLE_KM_LT_LAST_CHECKIN",
          message: `currentKm (${km}) menor que último check-in (${lastCheckin}).`,
          suggestedFix: "Atualizar currentKm para o último checkinKm registrado.",
          safeAutoFix: true,
        })
      );
    }
  }

  for (const r of data.reservations) {
    if (r.startDateTime.getTime() >= r.endDateTime.getTime()) {
      issues.push(
        issue({
          severity: "critical",
          entity: "FleetReservation",
          entityId: r.id,
          code: "RESERVATION_INVALID_PERIOD",
          message: "startDateTime >= endDateTime.",
          suggestedFix: "Ajustar período da reserva.",
        })
      );
    }

    if (r.status === "APPROVED" || r.status === "IN_USE") {
      const vehicle = vehicleById.get(r.vehicleId);
      if (vehicle && !isVehicleReservable(vehicle.status) && r.status === "APPROVED") {
        issues.push(
          issue({
            severity: "high",
            entity: "FleetReservation",
            entityId: r.id,
            code: "RESERVATION_APPROVED_NON_RESERVABLE_VEHICLE",
            message: `Reserva APPROVED para veículo status ${vehicle.status}.`,
            suggestedFix: "Cancelar reserva ou corrigir status do veículo.",
          })
        );
      }
    }

    if (r.status === "IN_USE") {
      const usage = usageByReservation.get(r.id);
      if (!usage) {
        issues.push(
          issue({
            severity: "critical",
            entity: "FleetReservation",
            entityId: r.id,
            code: "RESERVATION_IN_USE_WITHOUT_USAGE",
            message: "Reserva IN_USE sem FleetUsage.",
            suggestedFix: "Registrar checkout / criar FleetUsage.",
          })
        );
      }
    }

    if (FINISHED_RESERVATION_STATUSES.includes(r.status)) {
      const usage = usageByReservation.get(r.id);
      if (!usage?.checkinAt) {
        issues.push(
          issue({
            severity: "high",
            entity: "FleetReservation",
            entityId: r.id,
            code: "RESERVATION_FINISHED_WITHOUT_CHECKIN",
            message: `Reserva ${r.status} sem checkinAt no usage.`,
            suggestedFix: "Completar check-in ou ajustar status da reserva.",
          })
        );
      }
    }
  }

  for (const d of data.drivers) {
    if (!ACTIVE_DRIVER_STATUSES.includes(d.status) && d.status !== "INACTIVE") continue;

    const futureApproved = data.reservations.filter(
      (r) =>
        r.driverId === d.id &&
        (r.status === "APPROVED" || r.status === "IN_USE") &&
        r.endDateTime.getTime() > now.getTime()
    );

    if (d.status === "BLOCKED") {
      for (const r of futureApproved) {
        issues.push(
          issue({
            severity: "high",
            entity: "FleetDriver",
            entityId: d.id,
            code: "DRIVER_BLOCKED_FUTURE_RESERVATION",
            message: `Motorista bloqueado com reserva futura ${r.id}.`,
            suggestedFix: "Cancelar reserva ou desbloquear motorista.",
          })
        );
      }
    }

    if (d.cnhExpirationDate) {
      const exp = new Date(d.cnhExpirationDate);
      exp.setHours(23, 59, 59, 999);
      if (exp.getTime() < now.getTime()) {
        for (const r of futureApproved) {
          issues.push(
            issue({
              severity: "high",
              entity: "FleetDriver",
              entityId: d.id,
              code: "DRIVER_EXPIRED_CNH_FUTURE_RESERVATION",
              message: `CNH vencida com reserva futura aprovada ${r.id}.`,
              suggestedFix: "Atualizar CNH, trocar motorista ou cancelar reserva.",
            })
          );
        }
      }
    }
  }

  const cpfMap = new Map<string, string[]>();
  for (const d of data.drivers) {
    if (d.status === "INACTIVE") continue;
    const cpf = d.cpf.trim();
    if (!cpf) continue;
    const ids = cpfMap.get(cpf) ?? [];
    ids.push(d.id);
    cpfMap.set(cpf, ids);
  }
  for (const [cpf, ids] of cpfMap) {
    if (ids.length > 1) {
      issues.push(
        issue({
          severity: "critical",
          entity: "FleetDriver",
          entityId: ids[0],
          code: "DRIVER_DUPLICATE_CPF_ACTIVE",
          message: `CPF ${cpf} duplicado em motoristas ativos: ${ids.join(", ")}.`,
          suggestedFix: "Inativar duplicata ou corrigir CPF; verificar índice único.",
        })
      );
    }
  }

  for (const u of data.usages) {
    if (u.status === "CHECKED_IN" && !u.checkinAt) {
      issues.push(
        issue({
          severity: "high",
          entity: "FleetUsage",
          entityId: u.id,
          code: "USAGE_CHECKED_IN_WITHOUT_AT",
          message: "Usage CHECKED_IN sem checkinAt.",
          suggestedFix: "Preencher checkinAt ou reverter status.",
        })
      );
    }
  }

  for (const m of data.maintenances) {
    const est = dec(m.estimatedValue);
    const fin = dec(m.finalValue);
    if ((est != null && est < 0) || (fin != null && fin < 0)) {
      issues.push(
        issue({
          severity: "medium",
          entity: "FleetMaintenance",
          entityId: m.id,
          code: "MAINTENANCE_NEGATIVE_VALUE",
          message: "Valor estimado ou final negativo.",
          suggestedFix: "Corrigir valores da manutenção.",
        })
      );
    }

    if (m.status === "COMPLETED") {
      const vehicle = vehicleById.get(m.vehicleId);
      if (vehicle?.status === "MAINTENANCE") {
        const otherOpen = (openMaintenancesByVehicle.get(m.vehicleId) ?? []).filter(
          (x) => x.id !== m.id
        );
        if (otherOpen.length === 0) {
          issues.push(
            issue({
              severity: "medium",
              entity: "FleetMaintenance",
              entityId: m.id,
              code: "MAINTENANCE_COMPLETED_VEHICLE_STILL_MAINTENANCE",
              message: "Manutenção concluída mas veículo permanece MAINTENANCE.",
              suggestedFix: "Sincronizar status do veículo após conclusão.",
              safeAutoFix: true,
            })
          );
        }
      }
    }

    if (m.blocksVehicle && !FLEET_MAINTENANCE_TERMINAL_STATUSES.includes(m.status)) {
      const vehicle = vehicleById.get(m.vehicleId);
      if (vehicle && vehicle.status !== "MAINTENANCE" && vehicle.status !== "BLOCKED") {
        issues.push(
          issue({
            severity: "high",
            entity: "FleetMaintenance",
            entityId: m.id,
            code: "MAINTENANCE_BLOCKS_VEHICLE_STATUS_MISMATCH",
            message: `blocksVehicle=true mas veículo está ${vehicle.status}.`,
            suggestedFix: "Colocar veículo em MAINTENANCE/BLOCKED ou desmarcar blocksVehicle.",
          })
        );
      }
    }
  }

  for (const c of data.contracts) {
    if (c.endDate && c.endDate.getTime() < c.startDate.getTime()) {
      issues.push(
        issue({
          severity: "high",
          entity: "FleetVehicleContract",
          entityId: c.id,
          code: "CONTRACT_END_BEFORE_START",
          message: "endDate < startDate.",
          suggestedFix: "Corrigir datas do contrato.",
        })
      );
    }
    if (c.status === "ACTIVE" && isContractExpired(c.endDate, now)) {
      issues.push(
        issue({
          severity: "medium",
          entity: "FleetVehicleContract",
          entityId: c.id,
          code: "CONTRACT_EXPIRED_STILL_ACTIVE",
          message: "Contrato vencido com status ACTIVE.",
          suggestedFix: "Atualizar status para EXPIRED/INACTIVE.",
        })
      );
    }
  }

  for (const c of data.costs) {
    const amount = dec(c.amount);
    if (amount != null && amount < 0) {
      issues.push(
        issue({
          severity: "high",
          entity: "FleetCost",
          entityId: c.id,
          code: "COST_NEGATIVE_AMOUNT",
          message: `Custo com amount negativo (${amount}).`,
          suggestedFix: "Corrigir ou cancelar lançamento.",
        })
      );
    }
    if (c.status === "ACTIVE" && !c.vehicleId) {
      issues.push(
        issue({
          severity: "critical",
          entity: "FleetCost",
          entityId: c.id,
          code: "COST_ACTIVE_WITHOUT_VEHICLE",
          message: "Custo ACTIVE sem vehicleId.",
          suggestedFix: "Vincular a um veículo ou cancelar.",
        })
      );
    }
  }

  for (const o of data.orphanRows) {
    issues.push(
      issue({
        severity: "critical",
        entity: o.entity,
        entityId: o.entityId,
        code: o.code,
        message: `Registro órfão (${o.code}).`,
        suggestedFix: "Remover registro órfão ou restaurar FK pai.",
      })
    );
  }

  return issues;
}

export async function runFleetIntegrityDiagnostic(
  prisma: PrismaClient
): Promise<FleetIntegrityReport> {
  const data = await loadFleetIntegrityDataset(prisma);
  const issues = runFleetIntegrityChecks(data);
  return summarizeFleetIntegrityReport(issues);
}

export function printFleetIntegritySummary(report: FleetIntegrityReport): void {
  console.log("\n=== Fleet Integrity Diagnostic (read-only) ===");
  console.log(`Gerado em: ${report.generatedAt}`);
  console.log(`Total: ${report.totalIssues}`);
  console.log(
    `  critical: ${report.critical} | high: ${report.high} | medium: ${report.medium} | low: ${report.low}`
  );
  if (report.issues.length === 0) {
    console.log("Nenhum problema detectado.");
    return;
  }
  const bySeverity = (s: FleetIntegritySeverity) =>
    report.issues.filter((i) => i.severity === s);
  for (const sev of ["critical", "high", "medium", "low"] as const) {
    const list = bySeverity(sev);
    if (list.length === 0) continue;
    console.log(`\n--- ${sev.toUpperCase()} (${list.length}) ---`);
    for (const i of list.slice(0, 25)) {
      console.log(`  [${i.code}] ${i.entity} ${i.entityId}: ${i.message}`);
    }
    if (list.length > 25) console.log(`  ... +${list.length - 25} mais`);
  }
}
