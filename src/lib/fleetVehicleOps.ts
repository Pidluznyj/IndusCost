import type { FleetVehicle, FleetVehicleOrigin } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  FleetValidationError,
  assertBlockReason,
  assertContractDateRange,
  assertNonNegativeAmount,
  assertNonNegativeKm,
  assertVehicleCanDispose,
  computeDocumentStatus,
  isActiveVehicleStatus,
  isContractExpired,
  isContractExpiringSoon,
  normalizePlate,
  originRequiresContract,
  parseDecimalKm,
  FLEET_ACTIVE_RESERVATION_STATUSES,
} from "@/src/lib/fleetValidation.js";
import {
  loadFleetSettings,
  serializeFleetVehicle,
  writeFleetAuditLog,
} from "@/src/lib/fleetService.js";

export type FleetVehicleAlert = {
  level: "critical" | "warning" | "info";
  code: string;
  message: string;
};

export async function assertNoFutureActiveReservations(vehicleId: string) {
  const now = new Date();
  const count = await prisma.fleetReservation.count({
    where: {
      vehicleId,
      status: { in: FLEET_ACTIVE_RESERVATION_STATUSES },
      endDateTime: { gt: now },
    },
  });
  if (count > 0) {
    throw new FleetValidationError(
      "Veículo possui reserva ativa ou futura. Cancele ou finalize antes de inativar, vender ou devolver."
    );
  }
}

export async function getVehicleOrThrow(id: string) {
  const vehicle = await prisma.fleetVehicle.findUnique({ where: { id } });
  if (!vehicle) throw new FleetValidationError("Veículo não encontrado.");
  return vehicle;
}

export async function buildVehicleAlerts(
  vehicle: Pick<FleetVehicle, "id" | "origin" | "status">,
  options?: { docAlertDays?: number; contractAlertDays?: number }
): Promise<FleetVehicleAlert[]> {
  const settings = await loadFleetSettings();
  const docDays = options?.docAlertDays ?? (Number(settings.diasAlertaDocumento ?? "30") || 30);
  const contractDays =
    options?.contractAlertDays ?? (Number(settings.diasAlertaDocumento ?? "30") || 30);
  const alerts: FleetVehicleAlert[] = [];
  const now = new Date();

  if (originRequiresContract(vehicle.origin)) {
    const activeContract = await prisma.fleetVehicleContract.findFirst({
      where: { vehicleId: vehicle.id, status: "ACTIVE" },
      orderBy: { endDate: "desc" },
    });
    if (!activeContract) {
      alerts.push({
        level: "critical",
        code: "CONTRACT_MISSING",
        message: "Contrato ativo obrigatório para esta origem do veículo.",
      });
    } else if (isContractExpired(activeContract.endDate, now)) {
      alerts.push({
        level: "critical",
        code: "CONTRACT_EXPIRED",
        message: "Contrato vencido.",
      });
    } else if (isContractExpiringSoon(activeContract.endDate, contractDays, now)) {
      alerts.push({
        level: "warning",
        code: "CONTRACT_EXPIRING",
        message: "Contrato próximo do vencimento.",
      });
    }
  }

  const documents = await prisma.fleetVehicleDocument.findMany({
    where: { vehicleId: vehicle.id, status: { not: "REPLACED" } },
    select: { id: true, documentType: true, expirationDate: true, status: true },
  });

  for (const doc of documents) {
    const computed = computeDocumentStatus(doc.expirationDate, docDays, now);
    if (computed === "EXPIRED" || doc.status === "EXPIRED") {
      alerts.push({
        level: "critical",
        code: "DOCUMENT_EXPIRED",
        message: `Documento vencido: ${doc.documentType}`,
      });
    } else if (computed === "EXPIRING" || doc.status === "EXPIRING") {
      alerts.push({
        level: "warning",
        code: "DOCUMENT_EXPIRING",
        message: `Documento vencendo: ${doc.documentType}`,
      });
    }
  }

  const futureRes = await prisma.fleetReservation.count({
    where: {
      vehicleId: vehicle.id,
      status: { in: FLEET_ACTIVE_RESERVATION_STATUSES },
      endDateTime: { gt: now },
    },
  });
  if (futureRes > 0 && ["INACTIVE", "SOLD", "RETURNED"].includes(vehicle.status) === false) {
    alerts.push({
      level: "info",
      code: "RESERVATION_SCHEDULED",
      message: "Reserva futura ou ativa vinculada ao veículo.",
    });
  }

  return alerts;
}

export function serializeContract(
  c: {
    monthlyValue: Prisma.Decimal | null;
    kmFranchise: Prisma.Decimal | null;
    excessKmValue: Prisma.Decimal | null;
    [key: string]: unknown;
  },
  canViewFinancial: boolean
) {
  const base = { ...c };
  if (!canViewFinancial) {
    return {
      ...base,
      monthlyValue: null,
      kmFranchise: null,
      excessKmValue: null,
      financialMasked: true,
    };
  }
  return {
    ...base,
    monthlyValue: c.monthlyValue != null ? Number(c.monthlyValue) : null,
    kmFranchise: c.kmFranchise != null ? Number(c.kmFranchise) : null,
    excessKmValue: c.excessKmValue != null ? Number(c.excessKmValue) : null,
    financialMasked: false,
  };
}

export function parseContractInput(body: Record<string, unknown>) {
  const supplierName = typeof body.supplierName === "string" ? body.supplierName.trim() : "";
  if (!supplierName) throw new FleetValidationError("Fornecedor/locadora é obrigatório.");

  const contractType = typeof body.contractType === "string" ? body.contractType.trim() : "";
  if (!contractType) throw new FleetValidationError("Tipo de contrato é obrigatório.");

  const startDate = new Date(String(body.startDate ?? ""));
  if (Number.isNaN(startDate.getTime())) throw new FleetValidationError("Data inicial inválida.");

  const endDateRaw = body.endDate;
  const endDate =
    endDateRaw != null && endDateRaw !== "" ? new Date(String(endDateRaw)) : null;
  if (endDate && Number.isNaN(endDate.getTime())) {
    throw new FleetValidationError("Data final inválida.");
  }
  assertContractDateRange(startDate, endDate);

  const monthlyValue =
    body.monthlyValue != null && body.monthlyValue !== ""
      ? Number(body.monthlyValue)
      : null;
  const kmFranchise =
    body.kmFranchise != null && body.kmFranchise !== "" ? Number(body.kmFranchise) : null;
  const excessKmValue =
    body.excessKmValue != null && body.excessKmValue !== ""
      ? Number(body.excessKmValue)
      : null;

  if (monthlyValue != null) assertNonNegativeAmount(monthlyValue, "Valor mensal");
  if (kmFranchise != null) assertNonNegativeAmount(kmFranchise, "Franquia km");
  if (excessKmValue != null) assertNonNegativeAmount(excessKmValue, "Valor km excedente");

  const billingDay =
    body.billingDay != null && body.billingDay !== "" ? Number(body.billingDay) : null;
  if (billingDay != null && (billingDay < 1 || billingDay > 31)) {
    throw new FleetValidationError("Dia de cobrança deve estar entre 1 e 31.");
  }

  return {
    supplierName,
    supplierDocument:
      typeof body.supplierDocument === "string" ? body.supplierDocument.trim() || null : null,
    contractNumber:
      typeof body.contractNumber === "string" ? body.contractNumber.trim() || null : null,
    contractType,
    startDate,
    endDate,
    monthlyValue,
    billingDay,
    kmFranchise,
    excessKmValue,
    status: typeof body.status === "string" ? body.status.trim() || "ACTIVE" : "ACTIVE",
    notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
  };
}

export function parseDocumentInput(body: Record<string, unknown>, alertDays: number) {
  const documentType = typeof body.documentType === "string" ? body.documentType.trim() : "";
  if (!documentType) throw new FleetValidationError("Tipo de documento é obrigatório.");

  const issueDateRaw = body.issueDate;
  const issueDate =
    issueDateRaw != null && issueDateRaw !== "" ? new Date(String(issueDateRaw)) : null;
  if (issueDate && Number.isNaN(issueDate.getTime())) {
    throw new FleetValidationError("Data de emissão inválida.");
  }

  const expirationDateRaw = body.expirationDate;
  const expirationDate =
    expirationDateRaw != null && expirationDateRaw !== ""
      ? new Date(String(expirationDateRaw))
      : null;
  if (expirationDate && Number.isNaN(expirationDate.getTime())) {
    throw new FleetValidationError("Data de vencimento inválida.");
  }

  const status = computeDocumentStatus(expirationDate, alertDays);

  return {
    documentType,
    documentNumber:
      typeof body.documentNumber === "string" ? body.documentNumber.trim() || null : null,
    issueDate,
    expirationDate,
    status,
    responsible:
      typeof body.responsible === "string" ? body.responsible.trim() || null : null,
    attachmentUrl:
      typeof body.attachmentUrl === "string" ? body.attachmentUrl.trim() || null : null,
    notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
  };
}

export async function refreshDocumentStatuses(vehicleId: string) {
  const settings = await loadFleetSettings();
  const alertDays = Number(settings.diasAlertaDocumento ?? "30") || 30;
  const docs = await prisma.fleetVehicleDocument.findMany({
    where: { vehicleId, status: { not: "REPLACED" } },
  });
  for (const doc of docs) {
    const next = computeDocumentStatus(doc.expirationDate, alertDays);
    if (doc.status !== "REPLACED" && doc.status !== next) {
      await prisma.fleetVehicleDocument.update({
        where: { id: doc.id },
        data: { status: next },
      });
    }
  }
}

export async function changeVehicleStatus(
  vehicleId: string,
  newStatus: FleetVehicle["status"],
  userId: string | null,
  action: string,
  reason?: string | null
) {
  const existing = await getVehicleOrThrow(vehicleId);
  const updated = await prisma.fleetVehicle.update({
    where: { id: vehicleId },
    data: { status: newStatus, updatedBy: userId },
  });
  await writeFleetAuditLog({
    entityType: "FleetVehicle",
    entityId: vehicleId,
    action,
    oldValue: existing.status,
    newValue: updated.status,
    reason: reason ?? null,
    userId,
  });
  return updated;
}

export async function disposeVehicle(
  vehicleId: string,
  targetStatus: "INACTIVE" | "SOLD" | "RETURNED",
  userId: string | null,
  action: string,
  reason?: string | null
) {
  const existing = await getVehicleOrThrow(vehicleId);
  assertVehicleCanDispose(existing.status);
  await assertNoFutureActiveReservations(vehicleId);
  return changeVehicleStatus(vehicleId, targetStatus, userId, action, reason);
}

export function buildVehicleFormData(body: Record<string, unknown>, existing?: FleetVehicle) {
  const brand =
    body.brand !== undefined
      ? typeof body.brand === "string"
        ? body.brand.trim()
        : ""
      : existing?.brand ?? "";
  const model =
    body.model !== undefined
      ? typeof body.model === "string"
        ? body.model.trim()
        : ""
      : existing?.model ?? "";
  if (!brand || !model) throw new FleetValidationError("Marca e modelo são obrigatórios.");

  const plate =
    body.plate !== undefined ? normalizePlate(body.plate as string) : existing?.plate ?? null;
  const currentKm =
    body.currentKm !== undefined
      ? (parseDecimalKm(body.currentKm) ?? 0)
      : Number(existing?.currentKm ?? 0);
  const initialKm =
    body.initialKm !== undefined
      ? (parseDecimalKm(body.initialKm) ?? 0)
      : Number(existing?.initialKm ?? 0);
  assertNonNegativeKm(currentKm);
  assertNonNegativeKm(initialKm);

  return {
    plate,
    renavam:
      body.renavam !== undefined
        ? (typeof body.renavam === "string" ? body.renavam.trim() || null : null)
        : undefined,
    chassis:
      body.chassis !== undefined
        ? (typeof body.chassis === "string" ? body.chassis.trim() || null : null)
        : undefined,
    brand,
    model,
    modelYear: body.modelYear !== undefined ? Number(body.modelYear) : undefined,
    manufactureYear:
      body.manufactureYear !== undefined ? Number(body.manufactureYear) : undefined,
    color:
      body.color !== undefined
        ? (typeof body.color === "string" ? body.color.trim() || null : null)
        : undefined,
    vehicleType:
      body.vehicleType !== undefined
        ? (typeof body.vehicleType === "string" ? body.vehicleType.trim() || null : null)
        : undefined,
    fuelType:
      body.fuelType !== undefined
        ? (typeof body.fuelType === "string" ? body.fuelType.trim() || null : null)
        : undefined,
    origin: (body.origin as FleetVehicleOrigin | undefined) ?? undefined,
    ownershipType:
      body.ownershipType !== undefined
        ? (typeof body.ownershipType === "string" ? body.ownershipType.trim() || null : null)
        : undefined,
    currentKm,
    initialKm,
    unit:
      body.unit !== undefined
        ? (typeof body.unit === "string" ? body.unit.trim() || null : null)
        : undefined,
    costCenter:
      body.costCenter !== undefined
        ? (typeof body.costCenter === "string" ? body.costCenter.trim() || null : null)
        : undefined,
    responsibleUserId:
      body.responsibleUserId !== undefined
        ? (typeof body.responsibleUserId === "string" && body.responsibleUserId
            ? body.responsibleUserId
            : null)
        : undefined,
    notes:
      body.notes !== undefined
        ? (typeof body.notes === "string" ? body.notes.trim() || null : null)
        : undefined,
  };
}

export async function listVehicleAudit(vehicleId: string, limit = 100) {
  return prisma.fleetAuditLog.findMany({
    where: {
      OR: [{ entityType: "FleetVehicle", entityId: vehicleId }],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function listRelatedVehicleAudit(vehicleId: string, limit = 100) {
  const [contracts, documents] = await Promise.all([
    prisma.fleetVehicleContract.findMany({
      where: { vehicleId },
      select: { id: true },
    }),
    prisma.fleetVehicleDocument.findMany({
      where: { vehicleId },
      select: { id: true },
    }),
  ]);
  const ids = [
    vehicleId,
    ...contracts.map((c) => c.id),
    ...documents.map((d) => d.id),
  ];
  return prisma.fleetAuditLog.findMany({
    where: { entityId: { in: ids } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export { serializeFleetVehicle, isActiveVehicleStatus };
