import type { FleetDriver, FleetDriverStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  FleetValidationError,
  assertBlockReason,
  computeCnhStatus,
} from "@/src/lib/fleetValidation.js";
import { assertUniqueActiveDriverCpf, loadFleetSettings, writeFleetAuditLog } from "@/src/lib/fleetService.js";

export type FleetDriverAlert = {
  level: "critical" | "warning";
  code: string;
  message: string;
};

export function normalizeCpf(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

export function serializeDriver(driver: FleetDriver, alertDays?: number) {
  const settings = alertDays ?? 30;
  const cnhStatus = computeCnhStatus(driver.cnhExpirationDate, settings);
  return {
    ...driver,
    cnhStatus,
  };
}

export async function buildDriverAlerts(
  driver: Pick<FleetDriver, "cnhExpirationDate" | "status">
): Promise<FleetDriverAlert[]> {
  const settings = await loadFleetSettings();
  const alertDays = Number(settings.diasAlertaCnh ?? "30") || 30;
  const alerts: FleetDriverAlert[] = [];
  const cnh = computeCnhStatus(driver.cnhExpirationDate, alertDays);
  if (driver.status === "BLOCKED") {
    alerts.push({ level: "critical", code: "DRIVER_BLOCKED", message: "Motorista bloqueado." });
  }
  if (cnh === "EXPIRED") {
    alerts.push({ level: "critical", code: "CNH_EXPIRED", message: "CNH vencida." });
  } else if (cnh === "EXPIRING") {
    alerts.push({ level: "warning", code: "CNH_EXPIRING", message: "CNH vencendo em breve." });
  } else if (cnh === "MISSING") {
    alerts.push({ level: "warning", code: "CNH_MISSING", message: "CNH sem data de validade." });
  }
  return alerts;
}

export function parseDriverInput(body: Record<string, unknown>, existing?: FleetDriver) {
  const name =
    body.name !== undefined
      ? typeof body.name === "string"
        ? body.name.trim()
        : ""
      : (existing?.name ?? "");
  const cpfRaw =
    body.cpf !== undefined
      ? typeof body.cpf === "string"
        ? body.cpf.trim()
        : ""
      : (existing?.cpf ?? "");
  const cpf = normalizeCpf(cpfRaw);
  if (!name) throw new FleetValidationError("Nome é obrigatório.");
  if (!cpf) throw new FleetValidationError("CPF é obrigatório.");

  const cnhExpirationDate =
    body.cnhExpirationDate !== undefined
      ? body.cnhExpirationDate
        ? new Date(String(body.cnhExpirationDate))
        : null
      : undefined;
  if (cnhExpirationDate instanceof Date && Number.isNaN(cnhExpirationDate.getTime())) {
    throw new FleetValidationError("Data de validade da CNH inválida.");
  }

  return {
    name,
    cpf,
    cnhNumber:
      body.cnhNumber !== undefined
        ? (typeof body.cnhNumber === "string" ? body.cnhNumber.trim() || null : null)
        : undefined,
    cnhCategory:
      body.cnhCategory !== undefined
        ? (typeof body.cnhCategory === "string" ? body.cnhCategory.trim() || null : null)
        : undefined,
    cnhExpirationDate,
    phone:
      body.phone !== undefined
        ? (typeof body.phone === "string" ? body.phone.trim() || null : null)
        : undefined,
    email:
      body.email !== undefined
        ? (typeof body.email === "string" ? body.email.trim() || null : null)
        : undefined,
    unit:
      body.unit !== undefined
        ? (typeof body.unit === "string" ? body.unit.trim() || null : null)
        : undefined,
    costCenter:
      body.costCenter !== undefined
        ? (typeof body.costCenter === "string" ? body.costCenter.trim() || null : null)
        : undefined,
    status: (body.status as FleetDriverStatus | undefined) ?? undefined,
    notes:
      body.notes !== undefined
        ? (typeof body.notes === "string" ? body.notes.trim() || null : null)
        : undefined,
  };
}

export async function getDriverOrThrow(id: string) {
  const driver = await prisma.fleetDriver.findUnique({ where: { id } });
  if (!driver) throw new FleetValidationError("Motorista não encontrado.");
  return driver;
}

export async function changeDriverStatus(
  driverId: string,
  status: FleetDriverStatus,
  userId: string | null,
  action: string,
  reason?: string | null
) {
  const existing = await getDriverOrThrow(driverId);
  const updated = await prisma.fleetDriver.update({
    where: { id: driverId },
    data: { status },
  });
  await writeFleetAuditLog({
    entityType: "FleetDriver",
    entityId: driverId,
    action,
    oldValue: existing.status,
    newValue: updated.status,
    reason: reason ?? null,
    userId,
  });
  return updated;
}

export function buildDriverListWhere(query: {
  status?: string;
  unit?: string;
  costCenter?: string;
  search?: string;
  cnhFilter?: string;
}): Prisma.FleetDriverWhereInput {
  const where: Prisma.FleetDriverWhereInput = {};
  if (query.status) where.status = query.status as FleetDriverStatus;
  if (query.unit) where.unit = { contains: query.unit, mode: "insensitive" };
  if (query.costCenter) where.costCenter = { contains: query.costCenter, mode: "insensitive" };
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { cpf: { contains: query.search.replace(/\D/g, "") } },
    ];
  }
  return where;
}

export async function filterDriversByCnh(
  drivers: FleetDriver[],
  cnhFilter: string
): Promise<FleetDriver[]> {
  if (!cnhFilter) return drivers;
  const settings = await loadFleetSettings();
  const alertDays = Number(settings.diasAlertaCnh ?? "30") || 30;
  return drivers.filter((d) => {
    const st = computeCnhStatus(d.cnhExpirationDate, alertDays);
    if (cnhFilter === "expired") return st === "EXPIRED";
    if (cnhFilter === "expiring") return st === "EXPIRING";
    if (cnhFilter === "valid") return st === "VALID";
    return true;
  });
}
