import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { writeFleetAuditLog } from "@/src/lib/fleetService.js";
import {
  FleetValidationError,
  assertNonNegativeAmount,
  parseDecimalKm,
} from "@/src/lib/fleetValidation.js";

export const FLEET_COST_TYPES = [
  "LOCACAO",
  "MANUTENCAO",
  "COMBUSTIVEL",
  "MULTA",
  "SINISTRO",
  "AVARIA",
  "SEGURO",
  "TAXA",
  "OUTRO",
] as const;

export type FleetCostType = (typeof FLEET_COST_TYPES)[number];

const MONEY_KEYS = new Set([
  "amount",
  "estimatedValue",
  "finalValue",
  "totalValue",
  "unitPrice",
  "deductibleValue",
  "monthlyValue",
  "excessKmValue",
]);

export function maskFinancialData<T>(data: T, showFinancial: boolean): T {
  if (showFinancial || data == null) return data;
  if (Array.isArray(data)) {
    return data.map((item) => maskFinancialData(item, false)) as T;
  }
  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (MONEY_KEYS.has(k) && (typeof v === "number" || v != null)) {
        out[k] = null;
        out[`${k}Masked`] = true;
      } else if (typeof v === "object" && v !== null) {
        out[k] = maskFinancialData(v, false);
      } else {
        out[k] = v;
      }
    }
    return out as T;
  }
  return data;
}

export function assertCompetence(value: unknown): string {
  const c = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}$/.test(c)) {
    throw new FleetValidationError("Competência obrigatória no formato YYYY-MM.");
  }
  return c;
}

export function competenceFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function createFleetCostFromSource(input: {
  vehicleId: string;
  costType: string;
  amount: number;
  costDate: Date;
  competence?: string;
  contractId?: string | null;
  maintenanceId?: string | null;
  reservationId?: string | null;
  supplierName?: string | null;
  documentNumber?: string | null;
  notes?: string | null;
  userId?: string | null;
}) {
  assertNonNegativeAmount(input.amount);
  const competence = input.competence ?? competenceFromDate(input.costDate);
  assertCompetence(competence);

  const cost = await prisma.fleetCost.create({
    data: {
      vehicleId: input.vehicleId,
      costType: input.costType,
      costDate: input.costDate,
      competence,
      amount: input.amount,
      contractId: input.contractId ?? null,
      maintenanceId: input.maintenanceId ?? null,
      reservationId: input.reservationId ?? null,
      supplierName: input.supplierName ?? null,
      documentNumber: input.documentNumber ?? null,
      notes: input.notes ?? null,
      status: "ACTIVE",
    },
  });

  await writeFleetAuditLog({
    entityType: "FleetCost",
    entityId: cost.id,
    action: "CREATE",
    newValue: String(input.amount),
    userId: input.userId ?? null,
  });

  return cost;
}

export async function buildFleetFinancialDashboard(competence?: string) {
  const now = new Date();
  const comp =
    competence && /^\d{4}-\d{2}$/.test(competence)
      ? competence
      : competenceFromDate(now);

  const monthStart = new Date(`${comp}-01T00:00:00.000Z`);
  const monthEnd = new Date(monthStart);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

  const activeCosts = await prisma.fleetCost.findMany({
    where: { status: "ACTIVE", competence: comp },
    select: { amount: true, costType: true, vehicleId: true },
  });

  const totalMonth = activeCosts.reduce((s, c) => s + Number(c.amount), 0);
  const byType: Record<string, number> = {};
  for (const c of activeCosts) {
    byType[c.costType] = (byType[c.costType] ?? 0) + Number(c.amount);
  }

  const pendingFines = await prisma.fleetFine.count({
    where: { status: { in: ["RECEIVED", "IDENTIFYING_DRIVER", "PENDING_PAYMENT"] } },
  });

  const openIncidents = await prisma.fleetIncident.count({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
  });

  const recentFuelings = await prisma.fleetFueling.findMany({
    orderBy: { fuelingDate: "desc" },
    take: 5,
    include: {
      vehicle: { select: { plate: true, brand: true, model: true } },
      driver: { select: { name: true } },
    },
  });

  const usages = await prisma.fleetUsage.findMany({
    where: {
      status: "CHECKED_IN",
      checkinAt: { gte: monthStart, lt: monthEnd },
      kmDriven: { not: null },
    },
    select: { kmDriven: true },
  });
  const kmMonth = usages.reduce((s, u) => s + Number(u.kmDriven ?? 0), 0);
  const costPerKm = kmMonth > 0 ? totalMonth / kmMonth : null;

  return {
    competence: comp,
    totalMonth,
    byType,
    pendingFines,
    openIncidents,
    recentFuelings: recentFuelings.map((f) => ({
      id: f.id,
      fuelingDate: f.fuelingDate.toISOString(),
      liters: Number(f.liters),
      totalValue: Number(f.totalValue),
      vehicle: f.vehicle,
      driver: f.driver,
      avgConsumption: computeAvgConsumption(f.liters, f.km),
    })),
    kmMonth,
    costPerKm,
  };
}

export function resolveFineInitialStatus(driverId: string | null | undefined): "RECEIVED" | "IDENTIFYING_DRIVER" {
  return driverId ? "RECEIVED" : "IDENTIFYING_DRIVER";
}

export function incidentBlocksVehicle(severity: string, blocksVehicle?: boolean): boolean {
  const s = severity.trim().toUpperCase();
  return Boolean(blocksVehicle) || s === "GRAVE" || s === "ALTA";
}

export function shouldCreateFuelingCost(createCost: unknown): boolean {
  return createCost !== false;
}

export function sumActiveCostAmounts(
  costs: { status: string; amount: number }[]
): number {
  return costs
    .filter((c) => c.status === "ACTIVE")
    .reduce((s, c) => s + c.amount, 0);
}

export function computeAvgConsumption(liters: Prisma.Decimal | number, km: Prisma.Decimal | number) {
  const l = Number(liters);
  const k = Number(km);
  if (!Number.isFinite(l) || !Number.isFinite(k) || k <= 0) return null;
  return (l / k) * 100;
}

export async function suggestDriverForVehiclePeriod(
  vehicleId: string,
  at: Date
): Promise<string | null> {
  const reservation = await prisma.fleetReservation.findFirst({
    where: {
      vehicleId,
      driverId: { not: null },
      startDateTime: { lte: at },
      endDateTime: { gte: at },
      status: { in: ["APPROVED", "IN_USE", "FINISHED", "FINISHED_WITH_PENDING"] },
    },
    orderBy: { startDateTime: "desc" },
  });
  return reservation?.driverId ?? null;
}

export async function assertFuelingKm(vehicleId: string, km: number, allowBelow: boolean) {
  const vehicle = await prisma.fleetVehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw new FleetValidationError("Veículo não encontrado.");
  const current = Number(vehicle.currentKm);
  if (km < current && !allowBelow) {
    throw new FleetValidationError(
      "Km do abastecimento não pode ser menor que km atual do veículo."
    );
  }
  if (km >= current) {
    await prisma.fleetVehicle.update({ where: { id: vehicleId }, data: { currentKm: km } });
  }
}

export function parsePositiveLiters(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) {
    throw new FleetValidationError("Litros deve ser maior que zero.");
  }
  return n;
}

export function serializeCostRow(
  c: Prisma.FleetCostGetPayload<{
    include: { vehicle: { select: { plate: true; brand: true; model: true } } };
  }>
) {
  return {
    ...c,
    amount: Number(c.amount),
    costDate: c.costDate.toISOString().slice(0, 10),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
