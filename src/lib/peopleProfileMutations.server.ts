/**
 * Mutações transacionais da ficha funcional.
 * Snapshot Employee + histórico + auditoria no mesmo BEGIN/COMMIT.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { EmployeeRegistrationError, isEmployeeUuid } from "./employeeRegistration.js";
import { logEmployeeHrAudit } from "./employeeHrAudit.js";
import { computeAdjustmentPercentage } from "./peopleProfileKpis.js";
import {
  diffEmployeeSnapshots,
  type SnapshotForDiff,
} from "./peopleProfileHistory.js";
import { assertNoManagerCycleCte } from "./peopleProfileHierarchy.server.js";
import { PeopleProfileAccessError } from "./peopleProfileErrors.js";
import { saveAppLocalFile, readAppLocalFile } from "./appLocalFileStorage.js";
import type { PeopleCareerPostEventType } from "./peopleProfileTypes.js";
import { officialPayrollBenefitCode } from "./peopleOfficialPayrollCatalog.js";
export { PEOPLE_CAREER_POST_EVENT_TYPES } from "./peopleProfileTypes.js";

type Db = PrismaClient | Prisma.TransactionClient;

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function loadSnapshot(db: Db, employeeId: string): Promise<SnapshotForDiff & { name: string }> {
  const row = await db.employee.findUnique({
    where: { id: employeeId },
    select: {
      name: true,
      roleId: true,
      department: true,
      departmentId: true,
      costCenter: true,
      costCenterId: true,
      managerId: true,
      managerName: true,
      contractType: true,
      workSchedule: true,
      status: true,
      salary: true,
      admissionDate: true,
      terminationDate: true,
      Role: { select: { name: true } },
      manager: { select: { name: true, socialName: true } },
    },
  });
  if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
  return {
    name: row.name,
    roleId: row.roleId,
    roleName: row.Role?.name ?? null,
    departmentId: row.departmentId,
    department: row.department,
    costCenterId: row.costCenterId,
    costCenter: row.costCenter,
    managerId: row.managerId,
    managerName: row.manager
      ? (row.manager.socialName ?? "").trim() || row.manager.name
      : row.managerName,
    contractType: row.contractType,
    workSchedule: row.workSchedule,
    status: row.status,
    salary: asNumber(row.salary),
    admissionDate: row.admissionDate,
    terminationDate: row.terminationDate,
  };
}

export async function writeHistoryEvent(
  db: Db,
  input: {
    employeeId: string;
    eventType: string;
    effectiveDate: Date;
    source?: string;
    reason?: string | null;
    notes?: string | null;
    createdByUserId?: string | null;
    previousRoleId?: string | null;
    newRoleId?: string | null;
    previousRoleName?: string | null;
    newRoleName?: string | null;
    previousDepartmentId?: string | null;
    newDepartmentId?: string | null;
    previousDepartment?: string | null;
    newDepartment?: string | null;
    previousCostCenterId?: string | null;
    newCostCenterId?: string | null;
    previousCostCenter?: string | null;
    newCostCenter?: string | null;
    previousManagerId?: string | null;
    newManagerId?: string | null;
    previousManagerName?: string | null;
    newManagerName?: string | null;
    previousContractType?: string | null;
    newContractType?: string | null;
    previousWorkSchedule?: string | null;
    newWorkSchedule?: string | null;
    previousStatus?: string | null;
    newStatus?: string | null;
  }
) {
  return db.hrEmployeeHistory.create({
    data: {
      employeeId: input.employeeId,
      eventType: input.eventType,
      effectiveDate: input.effectiveDate,
      source: input.source ?? "USER",
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      createdByUserId: input.createdByUserId ?? null,
      previousRoleId: input.previousRoleId ?? null,
      newRoleId: input.newRoleId ?? null,
      previousRoleName: input.previousRoleName ?? null,
      newRoleName: input.newRoleName ?? null,
      previousDepartmentId: input.previousDepartmentId ?? null,
      newDepartmentId: input.newDepartmentId ?? null,
      previousDepartment: input.previousDepartment ?? null,
      newDepartment: input.newDepartment ?? null,
      previousCostCenterId: input.previousCostCenterId ?? null,
      newCostCenterId: input.newCostCenterId ?? null,
      previousCostCenter: input.previousCostCenter ?? null,
      newCostCenter: input.newCostCenter ?? null,
      previousManagerId: input.previousManagerId ?? null,
      newManagerId: input.newManagerId ?? null,
      previousManagerName: input.previousManagerName ?? null,
      newManagerName: input.newManagerName ?? null,
      previousContractType: input.previousContractType ?? null,
      newContractType: input.newContractType ?? null,
      previousWorkSchedule: input.previousWorkSchedule ?? null,
      newWorkSchedule: input.newWorkSchedule ?? null,
      previousStatus: input.previousStatus ?? null,
      newStatus: input.newStatus ?? null,
    },
  });
}

export async function recordSnapshotDiffHistory(
  db: Db,
  input: {
    employeeId: string;
    previous: SnapshotForDiff;
    next: SnapshotForDiff;
    actorUserId?: string | null;
    source?: string;
    effectiveDate?: Date;
  }
): Promise<number> {
  const events = diffEmployeeSnapshots(input.previous, input.next);
  const effectiveDate = input.effectiveDate ?? new Date();
  for (const event of events) {
    if (event.eventType === "COMPENSATION_ADJUSTMENT") {
      const percentage = computeAdjustmentPercentage(event.previousSalary, event.newSalary);
      const history = await writeHistoryEvent(db, {
        employeeId: input.employeeId,
        eventType: "COMPENSATION_ADJUSTMENT",
        effectiveDate,
        source: input.source ?? "USER",
        createdByUserId: input.actorUserId,
      });
      await db.hrCompensationAdjustment.create({
        data: {
          employeeId: input.employeeId,
          effectiveDate,
          registeredAt: new Date(),
          type: "MANUAL_EDIT",
          percentage,
          previousAmount: event.previousSalary ?? null,
          newAmount: event.newSalary ?? null,
          differenceAmount:
            event.previousSalary != null && event.newSalary != null
              ? event.newSalary - event.previousSalary
              : null,
          historyEventId: history.id,
          createdByUserId: input.actorUserId ?? null,
        },
      });
      continue;
    }
    await writeHistoryEvent(db, {
      employeeId: input.employeeId,
      eventType: event.eventType,
      effectiveDate,
      source: input.source ?? "USER",
      createdByUserId: input.actorUserId,
      previousRoleId: event.previousRoleId,
      newRoleId: event.newRoleId,
      previousRoleName: event.previousRoleName,
      newRoleName: event.newRoleName,
      previousDepartmentId: event.previousDepartmentId,
      newDepartmentId: event.newDepartmentId,
      previousDepartment: event.previousDepartment,
      newDepartment: event.newDepartment,
      previousCostCenterId: event.previousCostCenterId,
      newCostCenterId: event.newCostCenterId,
      previousCostCenter: event.previousCostCenter,
      newCostCenter: event.newCostCenter,
      previousManagerId: event.previousManagerId,
      newManagerId: event.newManagerId,
      previousManagerName: event.previousManagerName,
      newManagerName: event.newManagerName,
      previousContractType: event.previousContractType,
      newContractType: event.newContractType,
      previousWorkSchedule: event.previousWorkSchedule,
      newWorkSchedule: event.newWorkSchedule,
      previousStatus: event.previousStatus,
      newStatus: event.newStatus,
    });
  }
  return events.length;
}

export async function recordHistoryAfterEmployeeWrite(
  prisma: Db,
  input: {
    employeeId: string;
    previous: SnapshotForDiff;
    actorUserId?: string | null;
  }
): Promise<void> {
  const next = await loadSnapshot(prisma, input.employeeId);
  await recordSnapshotDiffHistory(prisma, {
    employeeId: input.employeeId,
    previous: input.previous,
    next,
    actorUserId: input.actorUserId,
    source: "USER",
  });
}

export async function loadEmployeeSnapshotForHistory(
  prisma: PrismaClient,
  employeeId: string
): Promise<SnapshotForDiff> {
  return loadSnapshot(prisma, employeeId);
}

export async function applyCompensationAdjustment(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    expectedPreviousAmount: number;
    newAmount: number;
    type: string;
    effectiveDate: Date;
    reason?: string | null;
    notes?: string | null;
    actorUserId?: string | null;
  }
) {
  if (!isEmployeeUuid(input.employeeId)) {
    throw new EmployeeRegistrationError("INVALID_ID", "Colaborador inválido.");
  }
  if (!Number.isFinite(input.newAmount) || input.newAmount < 0) {
    throw new EmployeeRegistrationError("INVALID_SALARY", "Valor do reajuste inválido.");
  }
  if (!Number.isFinite(input.expectedPreviousAmount) || input.expectedPreviousAmount < 0) {
    throw new EmployeeRegistrationError("INVALID_SALARY", "Salário anterior inválido.");
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.employee.findUnique({
      where: { id: input.employeeId },
      select: { id: true, salary: true, roleId: true, Role: { select: { name: true } } },
    });
    if (!current) {
      throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
    }
    const currentSalary = asNumber(current.salary) ?? 0;
    if (Math.abs(currentSalary - input.expectedPreviousAmount) > 0.009) {
      throw new PeopleProfileAccessError(
        "SALARY_CONFLICT",
        "O salário atual mudou. Recarregue a ficha e tente novamente.",
        409
      );
    }

    const updated = await tx.employee.updateMany({
      where: { id: input.employeeId, salary: current.salary },
      data: { salary: input.newAmount },
    });
    if (updated.count !== 1) {
      throw new PeopleProfileAccessError(
        "SALARY_CONFLICT",
        "O salário atual mudou. Recarregue a ficha e tente novamente.",
        409
      );
    }

    const percentage = computeAdjustmentPercentage(currentSalary, input.newAmount);
    const history = await writeHistoryEvent(tx, {
      employeeId: input.employeeId,
      eventType: "COMPENSATION_ADJUSTMENT",
      effectiveDate: input.effectiveDate,
      source: "USER",
      reason: input.reason,
      notes: input.notes,
      createdByUserId: input.actorUserId,
      newRoleId: current.roleId,
      newRoleName: current.Role?.name ?? null,
    });

    const adjustment = await tx.hrCompensationAdjustment.create({
      data: {
        employeeId: input.employeeId,
        effectiveDate: input.effectiveDate,
        registeredAt: new Date(),
        type: input.type,
        percentage,
        previousAmount: currentSalary,
        newAmount: input.newAmount,
        differenceAmount: input.newAmount - currentSalary,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        historyEventId: history.id,
        createdByUserId: input.actorUserId ?? null,
      },
    });

    logEmployeeHrAudit({
      event: "employee.compensation.adjustment",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: {
        type: input.type,
        percentage,
        hasPreviousAmount: true,
        hasNewAmount: true,
      },
    });

    return { adjustmentId: adjustment.id, historyEventId: history.id, percentage };
  });
}

export async function applyCareerMovement(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    eventType: PeopleCareerPostEventType;
    effectiveDate: Date;
    reason?: string | null;
    notes?: string | null;
    actorUserId?: string | null;
    newRoleId?: string | null;
    newDepartmentId?: string | null;
    newDepartment?: string | null;
    newManagerId?: string | null;
    newContractType?: string | null;
    newCostCenterId?: string | null;
    newCostCenter?: string | null;
    newWorkSchedule?: string | null;
  }
) {
  return prisma.$transaction(async (tx) => {
    const previous = await loadSnapshot(tx, input.employeeId);
    const data: Prisma.EmployeeUncheckedUpdateInput = {};
    if (input.newRoleId) data.roleId = input.newRoleId;
    if (input.newDepartmentId !== undefined) data.departmentId = input.newDepartmentId;
    if (input.newDepartment) data.department = input.newDepartment;
    if (input.eventType === "MANAGER_CHANGE") {
      const nextManagerId = input.newManagerId ?? null;
      await assertNoManagerCycleCte(tx, input.employeeId, nextManagerId);
      data.managerId = nextManagerId;
    }
    if (input.newContractType) data.contractType = input.newContractType;
    if (input.newCostCenterId !== undefined && input.newCostCenterId !== null) {
      data.costCenterId = input.newCostCenterId;
    }
    if (input.newCostCenter) data.costCenter = input.newCostCenter;
    if (input.newWorkSchedule) data.workSchedule = input.newWorkSchedule;

    await tx.employee.update({
      where: { id: input.employeeId },
      data,
    });
    const next = await loadSnapshot(tx, input.employeeId);
    const history = await writeHistoryEvent(tx, {
      employeeId: input.employeeId,
      eventType: input.eventType,
      effectiveDate: input.effectiveDate,
      source: "USER",
      reason: input.reason,
      notes: input.notes,
      createdByUserId: input.actorUserId,
      previousRoleId: previous.roleId,
      newRoleId: next.roleId,
      previousRoleName: previous.roleName,
      newRoleName: next.roleName,
      previousDepartmentId: previous.departmentId,
      newDepartmentId: next.departmentId,
      previousDepartment: previous.department,
      newDepartment: next.department,
      previousManagerId: previous.managerId,
      newManagerId: next.managerId,
      previousManagerName: previous.managerName,
      newManagerName: next.managerName,
      previousContractType: previous.contractType,
      newContractType: next.contractType,
      previousCostCenterId: previous.costCenterId,
      newCostCenterId: next.costCenterId,
      previousCostCenter: previous.costCenter,
      newCostCenter: next.costCenter,
      previousWorkSchedule: previous.workSchedule,
      newWorkSchedule: next.workSchedule,
    });

    logEmployeeHrAudit({
      event: input.eventType === "MANAGER_CHANGE" ? "employee.manager.change" : "employee.career.change",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { eventType: input.eventType, historyEventId: history.id },
    });

    return { historyEventId: history.id };
  });
}

export async function createEmployeeBenefit(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    benefitId: string;
    startDate: Date;
    endDate?: Date | null;
    planName?: string | null;
    amount?: number | null;
    notes?: string | null;
    actorUserId?: string | null;
  }
) {
  return prisma.$transaction(async (tx) => {
    const payroll = await tx.payrollComponent.findUnique({
      where: { id: input.benefitId },
      select: { id: true, name: true, type: true, calculationType: true },
    });
    let benefit: { id: string; name: string } | null = null;
    if (payroll) {
      const code = officialPayrollBenefitCode(payroll.id);
      benefit = await tx.hrBenefit.upsert({
        where: { code },
        create: {
          code,
          name: payroll.name,
          category: payroll.type,
          isFinancial: payroll.calculationType === "FIXED",
          status: "ACTIVE",
        },
        update: {
          name: payroll.name,
          category: payroll.type,
          isFinancial: payroll.calculationType === "FIXED",
          status: "ACTIVE",
        },
        select: { id: true, name: true },
      });
    } else {
      benefit = await tx.hrBenefit.findUnique({
        where: { id: input.benefitId },
        select: { id: true, name: true },
      });
    }
    if (!benefit) {
      throw new PeopleProfileAccessError(
        "INVALID_BENEFIT",
        "Selecione um item do cadastro oficial de Encargos e Benefícios.",
        400
      );
    }
    const row = await tx.hrEmployeeBenefit.create({
      data: {
        employeeId: input.employeeId,
        benefitId: benefit.id,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        planName: input.planName ?? null,
        amount: input.amount ?? null,
        notes: input.notes ?? null,
        createdByUserId: input.actorUserId ?? null,
        status: "ACTIVE",
      },
    });
    await writeHistoryEvent(tx, {
      employeeId: input.employeeId,
      eventType: "BENEFIT_CHANGE",
      effectiveDate: input.startDate,
      source: "USER",
      notes: benefit.name,
      createdByUserId: input.actorUserId,
    });
    logEmployeeHrAudit({
      event: "employee.benefit.change",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { benefitId: input.benefitId, action: "create" },
    });
    return row;
  });
}

export async function createEmployeeAbsence(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    type: string;
    startDate: Date;
    endDate?: Date | null;
    expectedReturn?: Date | null;
    status?: string;
    reason?: string | null;
    notes?: string | null;
    actorUserId?: string | null;
  }
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrAbsence.create({
      data: {
        employeeId: input.employeeId,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        expectedReturn: input.expectedReturn ?? null,
        status: input.status ?? "SCHEDULED",
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        createdByUserId: input.actorUserId ?? null,
      },
    });
    const eventType =
      input.type === "VACATION" ? "VACATION_START" : "LEAVE_START";
    await writeHistoryEvent(tx, {
      employeeId: input.employeeId,
      eventType,
      effectiveDate: input.startDate,
      source: "USER",
      reason: input.reason,
      notes: input.notes,
      createdByUserId: input.actorUserId,
    });
    logEmployeeHrAudit({
      event: "employee.absence.change",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { type: input.type, action: "create" },
    });
    return row;
  });
}

export async function createEmployeeNote(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    category: string;
    body: string;
    actorUserId?: string | null;
  }
) {
  const body = input.body.trim();
  if (!body) {
    throw new PeopleProfileAccessError("INVALID_NOTE", "Informe o texto da observação.", 400);
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEmployeeNote.create({
      data: {
        employeeId: input.employeeId,
        category: input.category,
        body,
        visibility: input.category === "RESTRITA" ? "RESTRICTED" : "STANDARD",
        createdByUserId: input.actorUserId ?? null,
      },
    });
    await writeHistoryEvent(tx, {
      employeeId: input.employeeId,
      eventType: "NOTE_ADDED",
      effectiveDate: new Date(),
      source: "USER",
      notes: input.category,
      createdByUserId: input.actorUserId,
    });
    logEmployeeHrAudit({
      event: input.category === "RESTRITA" ? "employee.note.restricted" : "employee.note.create",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { category: input.category, length: body.length },
    });
    return row;
  });
}

export async function createEpiDelivery(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    item: string;
    deliveredAt: Date;
    quantity?: number;
    size?: string | null;
    validUntil?: Date | null;
    responsibleName?: string | null;
    notes?: string | null;
    actorUserId?: string | null;
  }
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEpiDelivery.create({
      data: {
        employeeId: input.employeeId,
        item: input.item.trim(),
        deliveredAt: input.deliveredAt,
        quantity: input.quantity ?? 1,
        size: input.size ?? null,
        validUntil: input.validUntil ?? null,
        responsibleName: input.responsibleName ?? null,
        notes: input.notes ?? null,
        createdByUserId: input.actorUserId ?? null,
      },
    });
    await writeHistoryEvent(tx, {
      employeeId: input.employeeId,
      eventType: "EPI_DELIVERY",
      effectiveDate: input.deliveredAt,
      source: "USER",
      notes: input.item,
      createdByUserId: input.actorUserId,
    });
    logEmployeeHrAudit({
      event: "employee.epi.delivery",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { item: input.item },
    });
    return row;
  });
}

export async function createEmergencyContact(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    name: string;
    phone: string;
    relationship?: string | null;
    alternatePhone?: string | null;
    priority?: number;
    notes?: string | null;
    actorUserId?: string | null;
  }
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEmergencyContact.create({
      data: {
        employeeId: input.employeeId,
        name: input.name.trim(),
        phone: input.phone.trim(),
        relationship: input.relationship ?? null,
        alternatePhone: input.alternatePhone ?? null,
        priority: input.priority ?? 2,
        notes: input.notes ?? null,
      },
    });
    logEmployeeHrAudit({
      event: "employee.emergency.change",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { action: "create", contactId: row.id },
    });
    return row;
  });
}

export async function saveEmployeeDocument(input: {
  prisma: PrismaClient;
  employeeId: string;
  personId?: string | null;
  documentType: string;
  displayName: string;
  originalFileName: string;
  mimeType: string | null;
  buffer: Buffer;
  issuedAt?: Date | null;
  expiresAt?: Date | null;
  notes?: string | null;
  actorUserId?: string | null;
}) {
  const saved = await saveAppLocalFile({
    namespace: "hremployeedocs",
    entityId: input.employeeId,
    originalFileName: input.originalFileName,
    buffer: input.buffer,
  });
  return input.prisma.$transaction(async (tx) => {
    const row = await tx.hrEmployeeDocument.create({
      data: {
        employeeId: input.employeeId,
        personId: input.personId ?? null,
        documentType: input.documentType,
        displayName: input.displayName,
        storageKey: saved.storageKey,
        originalFileName: saved.fileName,
        mimeType: input.mimeType,
        fileSize: saved.fileSize,
        issuedAt: input.issuedAt ?? null,
        expiresAt: input.expiresAt ?? null,
        notes: input.notes ?? null,
        uploadedByUserId: input.actorUserId ?? null,
      },
    });
    await writeHistoryEvent(tx, {
      employeeId: input.employeeId,
      eventType: "DOCUMENT_ADDED",
      effectiveDate: new Date(),
      source: "USER",
      notes: input.displayName,
      createdByUserId: input.actorUserId,
    });
    logEmployeeHrAudit({
      event: "employee.document.upload",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { documentId: row.id, documentType: input.documentType, fileSize: saved.fileSize },
    });
    return row;
  });
}

export async function readEmployeeDocumentFile(
  prisma: PrismaClient,
  input: { employeeId: string; documentId: string }
) {
  const row = await prisma.hrEmployeeDocument.findFirst({
    where: { id: input.documentId, employeeId: input.employeeId },
  });
  if (!row) {
    throw new PeopleProfileAccessError("NOT_FOUND", "Documento não encontrado.", 404);
  }
  const buffer = await readAppLocalFile(row.storageKey);
  return { row, buffer };
}

export async function createHrBenefitCatalogItem(
  prisma: PrismaClient,
  input: { code: string; name: string; category?: string; isFinancial?: boolean }
) {
  return prisma.hrBenefit.create({
    data: {
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      category: input.category ?? "OTHER",
      isFinancial: input.isFinancial === true,
      status: "ACTIVE",
    },
  });
}
