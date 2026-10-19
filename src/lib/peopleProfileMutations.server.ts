/**
 * Mutações transacionais da ficha funcional.
 * Snapshot Employee + histórico + auditoria no mesmo BEGIN/COMMIT.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { EmployeeRegistrationError, isEmployeeUuid } from "./employeeRegistration.js";
import { logEmployeeHrAudit } from "./employeeHrAudit.js";
import { MAX_WORK_SCHEDULE_LEN } from "./employeeAdminHr.js";
import { computeAdjustmentPercentage } from "./peopleProfileKpis.js";
import {
  diffEmployeeSnapshots,
  diffPayrollComponentAssignments,
  payrollComponentHistoryNote,
  type SnapshotForDiff,
} from "./peopleProfileHistory.js";
import { assertNoManagerCycleCte } from "./peopleProfileHierarchy.server.js";
import { PeopleProfileAccessError } from "./peopleProfileErrors.js";
import { addDaysIso, isIsoDate, isLeaveType, legalLeaveEnd, toIsoDay, validateLeave } from "./employeeLifecycle.js";
import { validateEpiDeliveryInput, validateStatusReason, type EpiDeliveryInput } from "./epi/epiRules.js";
import { saveAppLocalFile, readAppLocalFile, deleteAppLocalFile } from "./appLocalFileStorage.js";
import {
  PEOPLE_CAREER_POST_EVENT_TYPES,
  PEOPLE_PRIMARY_EMERGENCY_CONTACT_ID,
  type PeopleCareerPostEventType,
  type PeopleHistoryLinkedRecordType,
} from "./peopleProfileTypes.js";
import {
  PEOPLE_ADJUSTMENT_MAX_ABS_PERCENTAGE,
  PEOPLE_PROFILE_PHOTO_EXTENSIONS,
  PEOPLE_PROFILE_PHOTO_MAX_BYTES,
  PEOPLE_RECORD_TEXT_LIMITS,
  assertAdjustmentPercentageInRange,
  assertCareerEventEditable,
  assertDateRange,
  buildEmployeePhotoUrl,
  normalizeAbsenceStatus,
  normalizeAbsenceType,
  normalizeNoteCategory,
  normalizeOptionalAmount,
  normalizeOptionalText,
  normalizePriority,
  normalizeQuantity,
  normalizeRequiredAmount,
  normalizeRequiredText,
  normalizeUserCompensationType,
  parseCareerEventPatch,
  parseCompensationAdjustmentPatch,
  parseEmergencyContactPatch,
  parseEmployeeAbsencePatch,
  parseEmployeeDocumentPatch,
  parseEmployeeNotePatch,
  parseEpiDeliveryPatch,
  resolveCareerEventTypeChange,
  sniffImageContentType,
} from "./peopleProfileRecordEdits.js";
export { PEOPLE_CAREER_POST_EVENT_TYPES } from "./peopleProfileTypes.js";

type Db = PrismaClient | Prisma.TransactionClient;

type HistoryRecordLink = { recordType: PeopleHistoryLinkedRecordType; recordId: string };

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Estado atual para o diff do histórico (null = colaborador inexistente). */
export async function loadEmployeeHistorySnapshot(db: Db, employeeId: string): Promise<SnapshotForDiff | null> {
  const exists = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  return exists ? loadSnapshot(db, employeeId) : null;
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
    /** Vínculo com o registro satélite que gerou o evento (benefício, afastamento, EPI, documento, observação). */
    metadata?: HistoryRecordLink | null;
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
      ...(input.metadata
        ? {
            metadata: {
              recordType: input.metadata.recordType,
              recordId: input.metadata.recordId,
            },
          }
        : {}),
    },
  });
}

type LegacyHistoryMatch = {
  eventTypes: readonly string[];
  /** Data exata gravada na criação, ou janela quando o satélite não guarda a data do evento. */
  effectiveDate: Date | { gte: Date; lte: Date };
  notes: string | null;
  reason?: string | null;
  createdByUserId?: string | null;
};

function hasRecordLink(metadata: unknown): boolean {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    typeof (metadata as { recordId?: unknown }).recordId === "string"
  );
}

/** Documento/observação gravam o evento com `new Date()`: casa pela janela em torno do createdAt. */
function legacyCreationWindow(createdAt: Date): { gte: Date; lte: Date } {
  const windowMs = 2 * 60 * 1000;
  return {
    gte: new Date(createdAt.getTime() - windowMs),
    lte: new Date(createdAt.getTime() + windowMs),
  };
}

/**
 * Evento do histórico gerado por um registro satélite. Procura primeiro pelo `metadata`
 * ({ recordType, recordId }); registros antigos não têm vínculo e caem no casamento exato legado
 * (colaborador + tipo + data + observação gravados na criação). Devolve no máximo uma linha.
 */
export async function findLinkedHistoryEvent(
  db: Db,
  input: {
    employeeId: string;
    recordType: PeopleHistoryLinkedRecordType;
    recordId: string;
    legacy?: LegacyHistoryMatch | null;
  }
): Promise<{ id: string; viaMetadata: boolean } | null> {
  const linked = await db.hrEmployeeHistory.findFirst({
    where: {
      employeeId: input.employeeId,
      AND: [
        { metadata: { path: ["recordType"], equals: input.recordType } },
        { metadata: { path: ["recordId"], equals: input.recordId } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (linked) return { id: linked.id, viaMetadata: true };
  if (!input.legacy) return null;

  const candidates = await db.hrEmployeeHistory.findMany({
    where: {
      employeeId: input.employeeId,
      eventType: { in: [...input.legacy.eventTypes] },
      effectiveDate: input.legacy.effectiveDate,
      notes: input.legacy.notes,
      ...(input.legacy.reason !== undefined ? { reason: input.legacy.reason } : {}),
      ...(input.legacy.createdByUserId !== undefined
        ? { createdByUserId: input.legacy.createdByUserId }
        : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 20,
    select: { id: true, metadata: true },
  });
  // Linha já vinculada a outro registro nunca é reaproveitada pelo casamento legado.
  const legacy = candidates.find((row) => !hasRecordLink(row.metadata));
  return legacy ? { id: legacy.id, viaMetadata: false } : null;
}

async function syncLinkedHistoryEvent(
  db: Db,
  input: {
    employeeId: string;
    link: HistoryRecordLink;
    legacy: LegacyHistoryMatch;
    data: Prisma.HrEmployeeHistoryUncheckedUpdateManyInput;
  }
): Promise<string | null> {
  const linked = await findLinkedHistoryEvent(db, {
    employeeId: input.employeeId,
    recordType: input.link.recordType,
    recordId: input.link.recordId,
    legacy: input.legacy,
  });
  if (!linked) return null;
  await db.hrEmployeeHistory.updateMany({
    where: { id: linked.id, employeeId: input.employeeId },
    data: {
      ...input.data,
      // Linha legada passa a carregar o vínculo: próximas correções não dependem do casamento exato.
      ...(linked.viaMetadata
        ? {}
        : { metadata: { recordType: input.link.recordType, recordId: input.link.recordId } }),
    },
  });
  return linked.id;
}

async function deleteLinkedHistoryEvent(
  db: Db,
  input: { employeeId: string; link: HistoryRecordLink; legacy: LegacyHistoryMatch }
): Promise<string | null> {
  const linked = await findLinkedHistoryEvent(db, {
    employeeId: input.employeeId,
    recordType: input.link.recordType,
    recordId: input.link.recordId,
    legacy: input.legacy,
  });
  if (!linked) return null;
  await db.hrEmployeeHistory.deleteMany({
    where: { id: linked.id, employeeId: input.employeeId },
  });
  return linked.id;
}

function assertRecordIds(employeeId: string, recordId: string): void {
  if (!isEmployeeUuid(employeeId)) {
    throw new PeopleProfileAccessError("INVALID_ID", "Colaborador inválido.", 400);
  }
  if (!isEmployeeUuid(recordId)) {
    throw new PeopleProfileAccessError("INVALID_ID", "Registro inválido.", 400);
  }
}

function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function absenceHistoryEventType(type: string): "VACATION_START" | "LEAVE_START" {
  return type === "VACATION" ? "VACATION_START" : "LEAVE_START";
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
      // Salário anterior ínfimo (ex.: 0,01 → 3.000) estoura a coluna Decimal(10,6): o registro
      // automático fica sem percentual em vez de derrubar o "Salvar alterações" do cadastro.
      const rawPercentage = computeAdjustmentPercentage(event.previousSalary, event.newSalary);
      const percentage =
        rawPercentage != null && Math.abs(rawPercentage) > PEOPLE_ADJUSTMENT_MAX_ABS_PERCENTAGE
          ? null
          : rawPercentage;
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
      // Desligamento vale na data de demissão informada, não no dia em que foi lançado.
      effectiveDate:
        event.eventType === "TERMINATION" && input.next.terminationDate ? new Date(input.next.terminationDate) : effectiveDate,
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

/**
 * Verbas oficiais marcadas/desmarcadas no cadastro (Referência administrativa) entram no
 * histórico como BENEFIT_CHANGE — é a fonte única de encargos e benefícios do colaborador.
 * Registro só (não toca EmployeePayrollComponent, que o PUT já gravou).
 */
export async function recordPayrollComponentHistory(
  db: Db,
  input: {
    employeeId: string;
    previousIds: readonly string[];
    nextIds: readonly string[];
    actorUserId?: string | null;
    effectiveDate?: Date;
  }
): Promise<number> {
  const changes = diffPayrollComponentAssignments(input.previousIds, input.nextIds);
  if (changes.length === 0) return 0;
  const rows = await db.payrollComponent.findMany({
    where: { id: { in: changes.map((c) => c.payrollComponentId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(rows.map((row) => [row.id, row.name]));
  const effectiveDate = input.effectiveDate ?? new Date();
  for (const change of changes) {
    await writeHistoryEvent(db, {
      employeeId: input.employeeId,
      eventType: "BENEFIT_CHANGE",
      effectiveDate,
      source: "USER",
      notes: payrollComponentHistoryNote(
        change.action,
        nameById.get(change.payrollComponentId) ?? change.payrollComponentId
      ),
      createdByUserId: input.actorUserId,
      metadata: { recordType: "payrollComponent", recordId: change.payrollComponentId },
    });
  }
  return changes.length;
}

/**
 * Exclui uma verba do cadastro oficial (Configurações → Estrutura Operacional → Encargos e
 * Benefícios). O banco remove em cascata o vínculo com os colaboradores
 * (EmployeePayrollComponent), o que muda a referência de custo deles; antes disso cada
 * colaborador que tinha a verba ganha um BENEFIT_CHANGE "<verba> removido" no histórico.
 * A regra de quem pode excluir (só SUPER_ADMIN) fica na rota.
 */
export async function deletePayrollComponentWithHistory(
  prisma: PrismaClient,
  input: { payrollComponentId: string; actorUserId?: string | null }
): Promise<{ name: string; affectedEmployees: number }> {
  if (!isEmployeeUuid(input.payrollComponentId)) {
    throw new PeopleProfileAccessError("INVALID_ID", "Encargo ou benefício inválido.", 400);
  }
  return prisma.$transaction(
    async (tx) => {
      const component = await tx.payrollComponent.findUnique({
        where: { id: input.payrollComponentId },
        select: { id: true, name: true },
      });
      if (!component) {
        throw new PeopleProfileAccessError(
          "NOT_FOUND",
          "Encargo ou benefício não encontrado (pode já ter sido excluído).",
          404
        );
      }
      const assigned = await tx.employeePayrollComponent.findMany({
        where: { payrollComponentId: component.id },
        select: { employeeId: true },
      });
      const effectiveDate = new Date();
      for (const { employeeId } of assigned) {
        await writeHistoryEvent(tx, {
          employeeId,
          eventType: "BENEFIT_CHANGE",
          effectiveDate,
          source: "USER",
          reason: "Verba excluída do cadastro oficial",
          notes: payrollComponentHistoryNote("removed", component.name),
          createdByUserId: input.actorUserId,
          metadata: { recordType: "payrollComponent", recordId: component.id },
        });
        logEmployeeHrAudit({
          event: "employee.benefit.change",
          actorUserId: input.actorUserId,
          employeeId,
          details: { payrollComponentId: component.id, action: "catalog_delete" },
        });
      }
      await tx.payrollComponent.delete({ where: { id: component.id } });
      return { name: component.name, affectedEmployees: assigned.length };
    },
    // Um evento de histórico por colaborador afetado: folga além dos 5 s padrão.
    { timeout: 20_000 }
  );
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
    /** Obrigatório no modo padrão (trava otimista contra lost update). */
    expectedPreviousAmount?: number;
    newAmount: number;
    type: string;
    effectiveDate: Date;
    reason?: string | null;
    notes?: string | null;
    actorUserId?: string | null;
    /** Registro retroativo: não compara nem altera Employee.salary. */
    historicalOnly?: boolean;
    /** Só no modo retroativo: valor anterior informado (pode ser desconhecido). */
    previousAmount?: number | null;
  }
) {
  if (!isEmployeeUuid(input.employeeId)) {
    throw new EmployeeRegistrationError("INVALID_ID", "Colaborador inválido.");
  }
  const type = normalizeUserCompensationType(input.type);
  const reason = normalizeOptionalText(input.reason, "Motivo", PEOPLE_RECORD_TEXT_LIMITS.reason);
  const notes = normalizeOptionalText(input.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);

  if (input.historicalOnly === true) {
    const newAmount = normalizeRequiredAmount(input.newAmount, "Novo valor");
    const previousAmount = normalizeOptionalAmount(input.previousAmount, "Valor anterior");
    return prisma.$transaction(async (tx) => {
      // Sem salary no select: o reajuste retroativo não lê nem grava o salário vigente.
      const employee = await tx.employee.findUnique({
        where: { id: input.employeeId },
        select: { id: true },
      });
      if (!employee) {
        throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
      }
      const percentage = assertAdjustmentPercentageInRange(
        computeAdjustmentPercentage(previousAmount, newAmount)
      );
      const history = await writeHistoryEvent(tx, {
        employeeId: input.employeeId,
        eventType: "COMPENSATION_ADJUSTMENT",
        effectiveDate: input.effectiveDate,
        source: "USER",
        reason,
        notes,
        createdByUserId: input.actorUserId,
      });
      const adjustment = await tx.hrCompensationAdjustment.create({
        data: {
          employeeId: input.employeeId,
          effectiveDate: input.effectiveDate,
          registeredAt: new Date(),
          type,
          percentage,
          previousAmount,
          newAmount,
          differenceAmount: previousAmount != null ? newAmount - previousAmount : null,
          reason,
          notes,
          historyEventId: history.id,
          createdByUserId: input.actorUserId ?? null,
        },
      });

      logEmployeeHrAudit({
        event: "employee.compensation.adjustment",
        actorUserId: input.actorUserId,
        employeeId: input.employeeId,
        details: {
          type,
          adjustmentId: adjustment.id,
          historicalOnly: true,
          hasPreviousAmount: previousAmount != null,
          hasNewAmount: true,
        },
      });

      return { adjustmentId: adjustment.id, historyEventId: history.id, percentage };
    });
  }

  if (!Number.isFinite(input.newAmount) || input.newAmount < 0) {
    throw new EmployeeRegistrationError("INVALID_SALARY", "Valor do reajuste inválido.");
  }
  const expectedPreviousAmount = Number(input.expectedPreviousAmount);
  if (!Number.isFinite(expectedPreviousAmount) || expectedPreviousAmount < 0) {
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
    if (Math.abs(currentSalary - expectedPreviousAmount) > 0.009) {
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

    const percentage = assertAdjustmentPercentageInRange(
      computeAdjustmentPercentage(currentSalary, input.newAmount)
    );
    const history = await writeHistoryEvent(tx, {
      employeeId: input.employeeId,
      eventType: "COMPENSATION_ADJUSTMENT",
      effectiveDate: input.effectiveDate,
      source: "USER",
      reason,
      notes,
      createdByUserId: input.actorUserId,
      newRoleId: current.roleId,
      newRoleName: current.Role?.name ?? null,
    });

    const adjustment = await tx.hrCompensationAdjustment.create({
      data: {
        employeeId: input.employeeId,
        effectiveDate: input.effectiveDate,
        registeredAt: new Date(),
        type,
        percentage,
        previousAmount: currentSalary,
        newAmount: input.newAmount,
        differenceAmount: input.newAmount - currentSalary,
        reason,
        notes,
        historyEventId: history.id,
        createdByUserId: input.actorUserId ?? null,
      },
    });

    logEmployeeHrAudit({
      event: "employee.compensation.adjustment",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: {
        type,
        percentage,
        hasPreviousAmount: true,
        hasNewAmount: true,
      },
    });

    return { adjustmentId: adjustment.id, historyEventId: history.id, percentage };
  });
}

/** Correção de um reajuste já registrado. Só o registro: nunca toca Employee.salary. */
export async function updateCompensationAdjustment(
  prisma: PrismaClient,
  input: { employeeId: string; recordId: string; patch: unknown; actorUserId?: string | null }
) {
  assertRecordIds(input.employeeId, input.recordId);
  const patch = parseCompensationAdjustmentPatch(input.patch);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrCompensationAdjustment.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: { id: true, previousAmount: true, newAmount: true, historyEventId: true },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Reajuste não encontrado.", 404);

    const data: Prisma.HrCompensationAdjustmentUncheckedUpdateManyInput = {};
    if (patch.type !== undefined) data.type = patch.type;
    if (patch.effectiveDate !== undefined) data.effectiveDate = patch.effectiveDate;
    if (patch.reason !== undefined) data.reason = patch.reason;
    if (patch.notes !== undefined) data.notes = patch.notes;
    const amountsChanged = patch.previousAmount !== undefined || patch.newAmount !== undefined;
    if (amountsChanged) {
      const previousAmount =
        patch.previousAmount !== undefined ? patch.previousAmount : asNumber(row.previousAmount);
      const newAmount = patch.newAmount !== undefined ? patch.newAmount : asNumber(row.newAmount);
      data.previousAmount = previousAmount;
      data.newAmount = newAmount;
      data.percentage = assertAdjustmentPercentageInRange(
        computeAdjustmentPercentage(previousAmount, newAmount)
      );
      data.differenceAmount =
        previousAmount != null && newAmount != null ? newAmount - previousAmount : null;
    }
    if (Object.keys(data).length > 0) {
      await tx.hrCompensationAdjustment.updateMany({
        where: { id: row.id, employeeId: input.employeeId },
        data,
      });
    }

    // O evento do histórico duplica data/motivo/observação; o tipo não é gravado lá.
    const mirror: Prisma.HrEmployeeHistoryUncheckedUpdateManyInput = {};
    if (patch.effectiveDate !== undefined) mirror.effectiveDate = patch.effectiveDate;
    if (patch.reason !== undefined) mirror.reason = patch.reason;
    if (patch.notes !== undefined) mirror.notes = patch.notes;
    const historyMirrored = Boolean(row.historyEventId) && Object.keys(mirror).length > 0;
    if (row.historyEventId && historyMirrored) {
      await tx.hrEmployeeHistory.updateMany({
        where: {
          id: row.historyEventId,
          employeeId: input.employeeId,
          eventType: "COMPENSATION_ADJUSTMENT",
        },
        data: mirror,
      });
    }

    logEmployeeHrAudit({
      event: "employee.compensation.adjustment.update",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: {
        adjustmentId: row.id,
        fields: Object.keys(patch),
        amountsChanged,
        historyMirrored,
      },
    });

    return { id: row.id };
  });
}

/** Exclui o reajuste e o evento de histórico vinculado. Nunca toca Employee.salary. */
export async function deleteCompensationAdjustment(
  prisma: PrismaClient,
  input: { employeeId: string; recordId: string; actorUserId?: string | null }
) {
  assertRecordIds(input.employeeId, input.recordId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrCompensationAdjustment.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: { id: true, historyEventId: true },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Reajuste não encontrado.", 404);

    await tx.hrCompensationAdjustment.deleteMany({
      where: { id: row.id, employeeId: input.employeeId },
    });
    if (row.historyEventId) {
      await tx.hrEmployeeHistory.deleteMany({
        where: {
          id: row.historyEventId,
          employeeId: input.employeeId,
          eventType: "COMPENSATION_ADJUSTMENT",
        },
      });
    }

    logEmployeeHrAudit({
      event: "employee.compensation.adjustment.delete",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { adjustmentId: row.id, historyDeleted: Boolean(row.historyEventId) },
    });

    return { ok: true as const };
  });
}

type CareerRecordOnlyInput = {
  employeeId: string;
  eventType: PeopleCareerPostEventType;
  previousRoleId?: string | null;
  newRoleId?: string | null;
  previousDepartmentId?: string | null;
  newDepartmentId?: string | null;
  previousDepartment?: string | null;
  newDepartment?: string | null;
  previousManagerId?: string | null;
  newManagerId?: string | null;
  previousContractType?: string | null;
  newContractType?: string | null;
  previousCostCenterId?: string | null;
  newCostCenterId?: string | null;
  previousCostCenter?: string | null;
  newCostCenter?: string | null;
  previousWorkSchedule?: string | null;
  newWorkSchedule?: string | null;
};

function assertLookupId(id: string, label: string): void {
  if (!isEmployeeUuid(id)) {
    throw new PeopleProfileAccessError("INVALID_FIELD", `${label}: valor inválido.`, 400);
  }
}

async function resolveRoleRef(db: Db, roleId: string | null | undefined, label: string) {
  if (!roleId) return { id: null, name: null };
  assertLookupId(roleId, label);
  const role = await db.role.findUnique({ where: { id: roleId }, select: { id: true, name: true } });
  if (!role) throw new PeopleProfileAccessError("INVALID_ROLE", `${label}: cargo não encontrado.`, 400);
  return { id: role.id, name: role.name };
}

async function resolveDepartmentRef(
  db: Db,
  departmentId: string | null | undefined,
  fallbackLabel: string | null | undefined,
  label: string
) {
  if (!departmentId) {
    return {
      id: null,
      name: normalizeOptionalText(fallbackLabel, label, PEOPLE_RECORD_TEXT_LIMITS.careerLabel),
    };
  }
  assertLookupId(departmentId, label);
  const department = await db.hrDepartment.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true },
  });
  if (!department) {
    throw new PeopleProfileAccessError(
      "INVALID_DEPARTMENT",
      `${label}: departamento não encontrado.`,
      400
    );
  }
  return { id: department.id, name: department.name };
}

async function resolveCostCenterRef(
  db: Db,
  costCenterId: string | null | undefined,
  fallbackLabel: string | null | undefined,
  label: string
) {
  if (!costCenterId) {
    return {
      id: null,
      name: normalizeOptionalText(fallbackLabel, label, PEOPLE_RECORD_TEXT_LIMITS.careerLabel),
    };
  }
  assertLookupId(costCenterId, label);
  const costCenter = await db.financialCostCenter.findUnique({
    where: { id: costCenterId },
    select: { id: true, code: true, name: true },
  });
  if (!costCenter) {
    throw new PeopleProfileAccessError(
      "INVALID_COST_CENTER",
      `${label}: centro de custo não encontrado.`,
      400
    );
  }
  // Mesmo rótulo do lookup de centros de custo ("código — nome").
  return { id: costCenter.id, name: `${costCenter.code} — ${costCenter.name}` };
}

async function resolveManagerRef(
  db: Db,
  employeeId: string,
  managerId: string | null | undefined,
  label: string
) {
  if (!managerId) return { id: null, name: null };
  assertLookupId(managerId, label);
  if (managerId === employeeId) {
    throw new PeopleProfileAccessError(
      "INVALID_MANAGER",
      "O colaborador não pode ser gestor de si mesmo.",
      400
    );
  }
  const manager = await db.employee.findUnique({
    where: { id: managerId },
    select: { id: true, name: true, socialName: true },
  });
  if (!manager) {
    throw new PeopleProfileAccessError("INVALID_MANAGER", `${label}: gestor não encontrado.`, 400);
  }
  return { id: manager.id, name: (manager.socialName ?? "").trim() || manager.name };
}

/** Monta as colunas previous/new de um evento retroativo, resolvendo os nomes no servidor. */
async function resolveCareerRecordOnlyFields(db: Db, input: CareerRecordOnlyInput) {
  const previousRole = await resolveRoleRef(db, input.previousRoleId, "Cargo anterior");
  const newRole = await resolveRoleRef(db, input.newRoleId, "Novo cargo");
  const previousDepartment = await resolveDepartmentRef(
    db,
    input.previousDepartmentId,
    input.previousDepartment,
    "Departamento anterior"
  );
  const newDepartment = await resolveDepartmentRef(
    db,
    input.newDepartmentId,
    input.newDepartment,
    "Novo departamento"
  );
  const previousCostCenter = await resolveCostCenterRef(
    db,
    input.previousCostCenterId,
    input.previousCostCenter,
    "Centro de custo anterior"
  );
  const newCostCenter = await resolveCostCenterRef(
    db,
    input.newCostCenterId,
    input.newCostCenter,
    "Novo centro de custo"
  );
  const previousManager = await resolveManagerRef(
    db,
    input.employeeId,
    input.previousManagerId,
    "Gestor anterior"
  );
  const newManager = await resolveManagerRef(db, input.employeeId, input.newManagerId, "Novo gestor");
  const previousContractType = normalizeOptionalText(
    input.previousContractType,
    "Contrato anterior",
    PEOPLE_RECORD_TEXT_LIMITS.careerLabel
  );
  const newContractType = normalizeOptionalText(
    input.newContractType,
    "Novo contrato",
    PEOPLE_RECORD_TEXT_LIMITS.careerLabel
  );
  const previousWorkSchedule = normalizeOptionalText(
    input.previousWorkSchedule,
    "Jornada anterior",
    PEOPLE_RECORD_TEXT_LIMITS.careerLabel
  );
  const newWorkSchedule = normalizeOptionalText(
    input.newWorkSchedule,
    "Nova jornada",
    PEOPLE_RECORD_TEXT_LIMITS.careerLabel
  );

  const required = (present: boolean, label: string) => {
    if (!present) {
      throw new PeopleProfileAccessError("REQUIRED_FIELD", `Campo obrigatório: ${label}.`, 400);
    }
  };
  switch (input.eventType) {
    case "PROMOTION":
    case "ROLE_CHANGE":
      required(Boolean(newRole.id), "Novo cargo");
      break;
    case "DEPARTMENT_CHANGE":
      required(Boolean(newDepartment.name), "Novo departamento");
      break;
    case "COST_CENTER_CHANGE":
      required(Boolean(newCostCenter.name), "Novo centro de custo");
      break;
    case "MANAGER_CHANGE":
      // Novo gestor vazio é válido (ficou sem gestor), desde que o anterior esteja informado.
      required(Boolean(newManager.id || previousManager.id), "Gestor anterior ou novo gestor");
      break;
    case "CONTRACT_CHANGE":
      required(Boolean(newContractType), "Novo contrato");
      break;
    case "WORK_SCHEDULE_CHANGE":
      required(Boolean(newWorkSchedule), "Nova jornada");
      break;
  }

  return {
    previousRoleId: previousRole.id,
    newRoleId: newRole.id,
    previousRoleName: previousRole.name,
    newRoleName: newRole.name,
    previousDepartmentId: previousDepartment.id,
    newDepartmentId: newDepartment.id,
    previousDepartment: previousDepartment.name,
    newDepartment: newDepartment.name,
    previousCostCenterId: previousCostCenter.id,
    newCostCenterId: newCostCenter.id,
    previousCostCenter: previousCostCenter.name,
    newCostCenter: newCostCenter.name,
    previousManagerId: previousManager.id,
    newManagerId: newManager.id,
    previousManagerName: previousManager.name,
    newManagerName: newManager.name,
    previousContractType,
    newContractType,
    previousWorkSchedule,
    newWorkSchedule,
  };
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
    /** Registro retroativo/histórico: grava só o evento, sem alterar o Employee. */
    recordOnly?: boolean;
    previousRoleId?: string | null;
    previousDepartmentId?: string | null;
    previousDepartment?: string | null;
    previousManagerId?: string | null;
    previousContractType?: string | null;
    previousCostCenterId?: string | null;
    previousCostCenter?: string | null;
    previousWorkSchedule?: string | null;
  }
) {
  if (!(PEOPLE_CAREER_POST_EVENT_TYPES as readonly string[]).includes(input.eventType)) {
    throw new PeopleProfileAccessError("INVALID_EVENT_TYPE", "Tipo de evento inválido.", 400);
  }

  if (input.recordOnly === true) {
    const reason = normalizeOptionalText(input.reason, "Motivo", PEOPLE_RECORD_TEXT_LIMITS.reason);
    const notes = normalizeOptionalText(input.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);
    return prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({
        where: { id: input.employeeId },
        select: { id: true },
      });
      if (!employee) {
        throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
      }
      // Nada é atribuído ao colaborador: sem checagem de ciclo de gestor nem employee.update.
      const fields = await resolveCareerRecordOnlyFields(tx, input);
      const history = await writeHistoryEvent(tx, {
        employeeId: input.employeeId,
        eventType: input.eventType,
        effectiveDate: input.effectiveDate,
        source: "USER",
        reason,
        notes,
        createdByUserId: input.actorUserId,
        ...fields,
      });

      logEmployeeHrAudit({
        event: "employee.career.change",
        actorUserId: input.actorUserId,
        employeeId: input.employeeId,
        details: { eventType: input.eventType, historyEventId: history.id, recordOnly: true },
      });

      return { historyEventId: history.id };
    });
  }

  return prisma.$transaction(async (tx) => {
    const previous = await loadSnapshot(tx, input.employeeId);
    const data: Prisma.EmployeeUncheckedUpdateInput = {};
    if (input.newRoleId) data.roleId = input.newRoleId;
    // A rota manda null quando a chave não vem: só troca o departamento com id informado
    // (antes, uma promoção sem departamento zerava Employee.departmentId).
    if (input.newDepartmentId) data.departmentId = input.newDepartmentId;
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
    // Mesmo limite do cadastro (MAX_WORK_SCHEDULE_LEN): acima disso é 400, nunca corte silencioso.
    const newWorkSchedule = normalizeOptionalText(
      input.newWorkSchedule,
      "Nova jornada",
      MAX_WORK_SCHEDULE_LEN
    );
    if (newWorkSchedule) data.workSchedule = newWorkSchedule;

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

/** Correção de data/motivo/observação (e PROMOTION <-> ROLE_CHANGE). Só o registro: nunca toca o Employee. */
export async function updateCareerEvent(
  prisma: PrismaClient,
  input: { employeeId: string; recordId: string; patch: unknown; actorUserId?: string | null }
) {
  assertRecordIds(input.employeeId, input.recordId);
  const patch = parseCareerEventPatch(input.patch);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEmployeeHistory.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: { id: true, eventType: true },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Evento não encontrado.", 404);
    assertCareerEventEditable(row.eventType);

    const data: Prisma.HrEmployeeHistoryUncheckedUpdateManyInput = {};
    const nextEventType =
      patch.eventType !== undefined
        ? resolveCareerEventTypeChange(row.eventType, patch.eventType)
        : row.eventType;
    if (nextEventType !== row.eventType) data.eventType = nextEventType;
    if (patch.effectiveDate !== undefined) data.effectiveDate = patch.effectiveDate;
    if (patch.reason !== undefined) data.reason = patch.reason;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (Object.keys(data).length > 0) {
      await tx.hrEmployeeHistory.updateMany({
        where: { id: row.id, employeeId: input.employeeId },
        data,
      });
    }

    logEmployeeHrAudit({
      event: "employee.history.update",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: {
        historyEventId: row.id,
        eventType: nextEventType,
        reclassified: nextEventType !== row.eventType,
        fields: Object.keys(patch),
      },
    });

    return { id: row.id };
  });
}

/** Exclui o evento de carreira (mesma trava de tipo da correção). Nunca toca o Employee. */
export async function deleteCareerEvent(
  prisma: PrismaClient,
  input: { employeeId: string; recordId: string; actorUserId?: string | null }
) {
  assertRecordIds(input.employeeId, input.recordId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEmployeeHistory.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: { id: true, eventType: true },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Evento não encontrado.", 404);
    assertCareerEventEditable(row.eventType);

    await tx.hrEmployeeHistory.deleteMany({
      where: { id: row.id, employeeId: input.employeeId },
    });

    logEmployeeHrAudit({
      event: "employee.history.delete",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { historyEventId: row.id, eventType: row.eventType },
    });

    return { ok: true as const };
  });
}

export async function deleteEmployeeBenefit(
  prisma: PrismaClient,
  input: { employeeId: string; recordId: string; actorUserId?: string | null }
) {
  assertRecordIds(input.employeeId, input.recordId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEmployeeBenefit.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: { id: true, benefitId: true, startDate: true, benefit: { select: { name: true } } },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Benefício não encontrado.", 404);

    await deleteLinkedHistoryEvent(tx, {
      employeeId: input.employeeId,
      link: { recordType: "benefit", recordId: row.id },
      legacy: {
        eventTypes: ["BENEFIT_CHANGE"],
        effectiveDate: row.startDate,
        notes: row.benefit.name,
      },
    });
    await tx.hrEmployeeBenefit.deleteMany({
      where: { id: row.id, employeeId: input.employeeId },
    });

    logEmployeeHrAudit({
      event: "employee.benefit.change",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { benefitId: row.benefitId, employeeBenefitId: row.id, action: "delete" },
    });
    return { ok: true as const };
  });
}

/**
 * Regras legais do afastamento (justificativa, datas, limites, sobreposição) — ver
 * src/lib/employeeLifecycle.ts. Férias seguem as regras antigas.
 */
async function assertLeaveRules(
  db: Db,
  input: {
    employeeId: string;
    selfId: string | null;
    type: string;
    startDate: Date;
    endDate: Date | null;
    expectedReturn: Date | null;
    actualReturn: Date | null;
    reason: string | null;
    extendedLicense: boolean;
  }
) {
  if (!isLeaveType(input.type)) return;
  const [employee, others] = await Promise.all([
    db.employee.findUnique({
      where: { id: input.employeeId },
      select: { status: true, admissionDate: true, terminationDate: true },
    }),
    db.hrAbsence.findMany({
      where: { employeeId: input.employeeId },
      select: { id: true, type: true, startDate: true, endDate: true, expectedReturn: true, actualReturn: true, status: true },
    }),
  ]);
  if (!employee) throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
  const errors = validateLeave({
    type: input.type,
    startDate: toIsoDay(input.startDate),
    endDate: toIsoDay(input.endDate),
    expectedReturn: toIsoDay(input.expectedReturn),
    actualReturn: toIsoDay(input.actualReturn),
    justification: input.reason,
    extendedLicense: input.extendedLicense,
    employee: {
      status: employee.status,
      admissionDate: toIsoDay(employee.admissionDate),
      terminationDate: toIsoDay(employee.terminationDate),
    },
    others: others.map((o) => ({
      id: o.id,
      type: o.type,
      status: o.status,
      startDate: toIsoDay(o.startDate)!,
      endDate: toIsoDay(o.endDate),
      expectedReturn: toIsoDay(o.expectedReturn),
      actualReturn: toIsoDay(o.actualReturn),
    })),
    selfId: input.selfId,
  });
  if (errors.length > 0) throw new PeopleProfileAccessError("INVALID_LEAVE", errors.join(" "), 400);
}

/** Retorno previsto padrão para afastamentos de prazo legal fixo (maternidade, paternidade…). */
function defaultLeaveReturn(type: string, startDate: Date, extended: boolean): Date | null {
  if (!isLeaveType(type)) return null;
  const start = toIsoDay(startDate);
  const end = start ? legalLeaveEnd(type, start, extended) : null;
  return end ? new Date(`${addDaysIso(end, 1)}T12:00:00.000Z`) : null;
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
    extendedLicense?: boolean;
    inssBenefitNumber?: string | null;
    catNumber?: string | null;
    actorUserId?: string | null;
  }
) {
  const type = normalizeAbsenceType(input.type);
  const extendedLicense = input.extendedLicense === true;
  // Sem status informado: em andamento se já começou, programado se é futuro.
  const status = normalizeAbsenceStatus(
    input.status ?? (toIsoDay(input.startDate)! <= toIsoDay(new Date())! ? "IN_PROGRESS" : "SCHEDULED")
  );
  const reason = normalizeOptionalText(input.reason, "Motivo", PEOPLE_RECORD_TEXT_LIMITS.reason);
  const notes = normalizeOptionalText(input.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);
  const inssBenefitNumber = normalizeOptionalText(input.inssBenefitNumber, "Número do benefício INSS", 40);
  const catNumber = normalizeOptionalText(input.catNumber, "Número da CAT", 40);
  assertDateRange(input.startDate, input.endDate);
  const expectedReturn = input.expectedReturn ?? defaultLeaveReturn(type, input.startDate, extendedLicense);
  return prisma.$transaction(async (tx) => {
    await assertLeaveRules(tx, {
      employeeId: input.employeeId,
      selfId: null,
      type,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      expectedReturn,
      actualReturn: null,
      reason,
      extendedLicense,
    });
    const row = await tx.hrAbsence.create({
      data: {
        employeeId: input.employeeId,
        type,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        expectedReturn,
        status,
        reason,
        notes,
        extendedLicense,
        inssBenefitNumber,
        catNumber,
        createdByUserId: input.actorUserId ?? null,
      },
    });
    await writeHistoryEvent(tx, {
      employeeId: input.employeeId,
      eventType: absenceHistoryEventType(type),
      effectiveDate: input.startDate,
      source: "USER",
      reason,
      notes,
      createdByUserId: input.actorUserId,
      metadata: { recordType: "absence", recordId: row.id },
    });
    logEmployeeHrAudit({
      event: "employee.absence.change",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { type, action: "create" },
    });
    return row;
  });
}

export async function updateEmployeeAbsence(
  prisma: PrismaClient,
  input: { employeeId: string; recordId: string; patch: unknown; actorUserId?: string | null }
) {
  assertRecordIds(input.employeeId, input.recordId);
  const patch = parseEmployeeAbsencePatch(input.patch);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrAbsence.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: {
        id: true,
        type: true,
        startDate: true,
        endDate: true,
        expectedReturn: true,
        actualReturn: true,
        status: true,
        reason: true,
        notes: true,
        extendedLicense: true,
      },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Afastamento não encontrado.", 404);

    const type = patch.type ?? row.type;
    const startDate = patch.startDate ?? row.startDate;
    const endDate = patch.endDate !== undefined ? patch.endDate : row.endDate;
    const reason = patch.reason !== undefined ? patch.reason : row.reason;
    const notes = patch.notes !== undefined ? patch.notes : row.notes;
    if (patch.startDate !== undefined || patch.endDate !== undefined) {
      assertDateRange(startDate, endDate);
    }
    const expectedReturn = patch.expectedReturn !== undefined ? patch.expectedReturn : row.expectedReturn;
    const actualReturn = patch.actualReturn !== undefined ? patch.actualReturn : row.actualReturn;
    const extendedLicense = patch.extendedLicense !== undefined ? patch.extendedLicense : row.extendedLicense;
    await assertLeaveRules(tx, {
      employeeId: input.employeeId,
      selfId: row.id,
      type,
      startDate,
      endDate,
      expectedReturn,
      actualReturn,
      reason,
      extendedLicense,
    });
    // Retorno registrado agora: encerra o afastamento (se o status não veio) e grava no histórico.
    const returnRegistered = patch.actualReturn != null && row.actualReturn == null;
    if (returnRegistered && patch.status === undefined) patch.status = "COMPLETED";

    const data: Prisma.HrAbsenceUncheckedUpdateManyInput = {};
    if (patch.type !== undefined) data.type = patch.type;
    if (patch.startDate !== undefined) data.startDate = patch.startDate;
    if (patch.endDate !== undefined) data.endDate = patch.endDate;
    if (patch.expectedReturn !== undefined) data.expectedReturn = patch.expectedReturn;
    if (patch.actualReturn !== undefined) data.actualReturn = patch.actualReturn;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.reason !== undefined) data.reason = patch.reason;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.extendedLicense !== undefined) data.extendedLicense = patch.extendedLicense;
    if (patch.inssBenefitNumber !== undefined) data.inssBenefitNumber = patch.inssBenefitNumber;
    if (patch.catNumber !== undefined) data.catNumber = patch.catNumber;
    if (Object.keys(data).length > 0) {
      await tx.hrAbsence.updateMany({
        where: { id: row.id, employeeId: input.employeeId },
        data,
      });
    }

    // O evento de início espelha tipo (férias x afastamento), data, motivo e observação.
    const previousEventType = absenceHistoryEventType(row.type);
    const nextEventType = absenceHistoryEventType(type);
    const mirrorChanged =
      previousEventType !== nextEventType ||
      !sameInstant(startDate, row.startDate) ||
      reason !== row.reason ||
      notes !== row.notes;
    if (mirrorChanged) {
      await syncLinkedHistoryEvent(tx, {
        employeeId: input.employeeId,
        link: { recordType: "absence", recordId: row.id },
        legacy: {
          eventTypes: [previousEventType],
          effectiveDate: row.startDate,
          notes: row.notes,
          reason: row.reason,
        },
        data: { eventType: nextEventType, effectiveDate: startDate, reason, notes },
      });
    }

    if (returnRegistered && patch.actualReturn) {
      await writeHistoryEvent(tx, {
        employeeId: input.employeeId,
        eventType: type === "VACATION" ? "VACATION_END" : "RETURN_TO_WORK",
        effectiveDate: patch.actualReturn,
        source: "USER",
        notes: type === "VACATION" ? "Retorno de férias" : "Retorno do afastamento",
        createdByUserId: input.actorUserId,
        metadata: { recordType: "absenceReturn", recordId: row.id },
      });
    }

    logEmployeeHrAudit({
      event: "employee.absence.change",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { absenceId: row.id, type, action: "update", fields: Object.keys(patch) },
    });
    return { id: row.id };
  });
}

export async function deleteEmployeeAbsence(
  prisma: PrismaClient,
  input: { employeeId: string; recordId: string; actorUserId?: string | null }
) {
  assertRecordIds(input.employeeId, input.recordId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrAbsence.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: { id: true, type: true, startDate: true, reason: true, notes: true },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Afastamento não encontrado.", 404);

    await deleteLinkedHistoryEvent(tx, {
      employeeId: input.employeeId,
      link: { recordType: "absence", recordId: row.id },
      legacy: {
        eventTypes: [absenceHistoryEventType(row.type)],
        effectiveDate: row.startDate,
        notes: row.notes,
        reason: row.reason,
      },
    });
    // O evento de retorno (se houver) sai junto com o afastamento.
    await tx.hrEmployeeHistory.deleteMany({
      where: {
        employeeId: input.employeeId,
        eventType: { in: ["RETURN_TO_WORK", "VACATION_END"] },
        metadata: { path: ["recordId"], equals: row.id },
      },
    });
    await tx.hrAbsence.deleteMany({ where: { id: row.id, employeeId: input.employeeId } });

    logEmployeeHrAudit({
      event: "employee.absence.change",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { absenceId: row.id, type: row.type, action: "delete" },
    });
    return { ok: true as const };
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
  const category = normalizeNoteCategory(input.category);
  normalizeRequiredText(body, "Texto da observação", PEOPLE_RECORD_TEXT_LIMITS.noteBody);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEmployeeNote.create({
      data: {
        employeeId: input.employeeId,
        category,
        body,
        visibility: noteVisibility(category),
        createdByUserId: input.actorUserId ?? null,
      },
    });
    await writeHistoryEvent(tx, {
      employeeId: input.employeeId,
      eventType: "NOTE_ADDED",
      effectiveDate: new Date(),
      source: "USER",
      notes: category,
      createdByUserId: input.actorUserId,
      metadata: { recordType: "note", recordId: row.id },
    });
    logEmployeeHrAudit({
      event: category === "RESTRITA" ? "employee.note.restricted" : "employee.note.create",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { category, length: body.length },
    });
    return row;
  });
}

function noteVisibility(category: string): "RESTRICTED" | "STANDARD" {
  return category === "RESTRITA" ? "RESTRICTED" : "STANDARD";
}

/** Mesma resposta de "não existe" para quem não pode ver observação restrita (sem oráculo de id). */
function assertNoteVisible<T extends { category: string }>(
  row: T | null,
  canViewRestrictedNotes: boolean
): asserts row is T {
  if (!row || (row.category === "RESTRITA" && !canViewRestrictedNotes)) {
    throw new PeopleProfileAccessError("NOT_FOUND", "Observação não encontrada.", 404);
  }
}

export async function updateEmployeeNote(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    recordId: string;
    patch: unknown;
    canViewRestrictedNotes: boolean;
    actorUserId?: string | null;
  }
) {
  assertRecordIds(input.employeeId, input.recordId);
  const patch = parseEmployeeNotePatch(input.patch);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEmployeeNote.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: { id: true, category: true, createdAt: true, createdByUserId: true },
    });
    assertNoteVisible(row, input.canViewRestrictedNotes);
    if (patch.category === "RESTRITA" && !input.canViewRestrictedNotes) {
      throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para observação restrita.");
    }

    const category = patch.category ?? row.category;
    const data: Prisma.HrEmployeeNoteUncheckedUpdateManyInput = {};
    if (patch.category !== undefined) {
      data.category = category;
      data.visibility = noteVisibility(category);
    }
    if (patch.body !== undefined) data.body = patch.body;
    if (Object.keys(data).length > 0) {
      await tx.hrEmployeeNote.updateMany({
        where: { id: row.id, employeeId: input.employeeId },
        data,
      });
    }

    // O evento NOTE_ADDED guarda a categoria como rótulo.
    if (category !== row.category) {
      await syncLinkedHistoryEvent(tx, {
        employeeId: input.employeeId,
        link: { recordType: "note", recordId: row.id },
        legacy: {
          eventTypes: ["NOTE_ADDED"],
          effectiveDate: legacyCreationWindow(row.createdAt),
          notes: row.category,
          createdByUserId: row.createdByUserId,
        },
        data: { notes: category },
      });
    }

    logEmployeeHrAudit({
      event: "employee.note.update",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: {
        noteId: row.id,
        restricted: category === "RESTRITA",
        fields: Object.keys(patch),
      },
    });
    return { id: row.id };
  });
}

export async function deleteEmployeeNote(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    recordId: string;
    canViewRestrictedNotes: boolean;
    actorUserId?: string | null;
  }
) {
  assertRecordIds(input.employeeId, input.recordId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEmployeeNote.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: { id: true, category: true, createdAt: true, createdByUserId: true },
    });
    assertNoteVisible(row, input.canViewRestrictedNotes);

    await deleteLinkedHistoryEvent(tx, {
      employeeId: input.employeeId,
      link: { recordType: "note", recordId: row.id },
      legacy: {
        eventTypes: ["NOTE_ADDED"],
        effectiveDate: legacyCreationWindow(row.createdAt),
        notes: row.category,
        createdByUserId: row.createdByUserId,
      },
    });
    await tx.hrEmployeeNote.deleteMany({ where: { id: row.id, employeeId: input.employeeId } });

    logEmployeeHrAudit({
      event: "employee.note.delete",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { noteId: row.id, restricted: row.category === "RESTRITA" },
    });
    return { ok: true as const };
  });
}

/** Meio-dia UTC: a data de calendário da entrega não "volta um dia" em nenhum fuso do Brasil. */
function epiDayToDate(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

function epiHistoryLabel(row: { item: string; itemCode?: string | null }): string {
  return row.itemCode ? `${row.itemCode} · ${row.item}` : row.item;
}

async function actorDisplayName(db: Db, actorUserId: string | null | undefined): Promise<string | null> {
  if (!actorUserId || !isEmployeeUuid(actorUserId)) return null;
  const user = await db.appUser.findUnique({ where: { id: actorUserId }, select: { name: true } });
  return user?.name ?? null;
}

/** Itens por evento de entrega (uma ficha). */
export const EPI_EVENT_MAX_ITEMS = 30;

/**
 * Registra um EVENTO de entrega (uma ocasião, uma data) com um ou mais itens do catálogo (só ativos).
 * Cada item guarda o retrato do catálogo e tem prazo, troca e situação próprios. Um item com
 * `replacesDeliveryId` é uma substituição: a entrega anterior vigente passa a "Substituído" na mesma
 * transação. O responsável é o usuário autenticado. Tudo ou nada: um item inválido desfaz o evento.
 */
export async function createEpiDeliveryEvent(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    body: Record<string, unknown>;
    todayIso: string;
    actorUserId?: string | null;
  }
) {
  if (!isEmployeeUuid(input.employeeId)) throw new PeopleProfileAccessError("INVALID_ID", "Registro inválido.", 400);
  const invalid = (message: string): never => {
    throw new PeopleProfileAccessError("INVALID_EPI_DELIVERY", message, 400);
  };
  const rawItems = Array.isArray(input.body.items) ? (input.body.items as unknown[]) : [];
  if (rawItems.length === 0) invalid("Inclua ao menos um EPI / uniforme na entrega.");
  if (rawItems.length > EPI_EVENT_MAX_ITEMS) invalid(`No máximo ${EPI_EVENT_MAX_ITEMS} itens por entrega.`);
  const items = rawItems.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid(`Item ${index + 1}: dados inválidos.`);
    const it = raw as Record<string, unknown>;
    if (typeof it.itemId !== "string" || !isEmployeeUuid(it.itemId)) invalid(`Item ${index + 1}: selecione o EPI / uniforme.`);
    if (it.replacesDeliveryId != null && it.replacesDeliveryId !== "") {
      if (typeof it.replacesDeliveryId !== "string" || !isEmployeeUuid(it.replacesDeliveryId)) invalid(`Item ${index + 1}: substituição inválida.`);
    }
    return it;
  });
  const replaced = items.map((it) => it.replacesDeliveryId).filter((v): v is string => typeof v === "string" && v !== "");
  if (new Set(replaced).size !== replaced.length) invalid("A mesma entrega não pode ser substituída duas vezes na mesma ocasião.");
  const deliveredOn = typeof input.body.deliveredOn === "string" ? input.body.deliveredOn.slice(0, 10) : "";
  if (!isIsoDate(deliveredOn)) invalid("Data da entrega é obrigatória.");
  if (deliveredOn > input.todayIso) invalid("A data da entrega não pode ser futura.");
  const eventNotes = normalizeOptionalText(input.body.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);

  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { status: true } });
    if (!employee) throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
    if ((employee.status ?? "ACTIVE").toUpperCase() === "INACTIVE") {
      throw new PeopleProfileAccessError("EMPLOYEE_TERMINATED", "Colaborador desligado não recebe novas entregas.", 409);
    }
    const responsibleName = await actorDisplayName(tx, input.actorUserId);
    const deliveredAt = epiDayToDate(deliveredOn);
    const event = await tx.hrEpiDeliveryEvent.create({
      data: {
        employeeId: input.employeeId,
        deliveredAt,
        responsibleName,
        notes: eventNotes,
        createdByUserId: input.actorUserId ?? null,
      },
    });

    const created: Array<{ id: string; item: string; itemCode: string | null; replacedDeliveryId: string | null }> = [];
    for (const [index, raw] of items.entries()) {
      const label = `Item ${index + 1}`;
      const item = await tx.hrEpiItem.findUnique({ where: { id: raw.itemId as string } });
      if (!item) throw new PeopleProfileAccessError("NOT_FOUND", `${label}: EPI / uniforme não encontrado.`, 404);
      if (!item.active) {
        throw new PeopleProfileAccessError("EPI_ITEM_INACTIVE", `${label} (${item.description}): item inativo não pode ser usado em novas entregas.`, 400);
      }
      const parsed = validateEpiDeliveryInput(
        { ...raw, deliveredOn },
        { todayIso: input.todayIso, catalogReplacementDays: item.replacementDays }
      );
      if (parsed.ok === false) invalid(`${label} (${item.description}): ${parsed.errors.join(" ")}`);
      const v = (parsed as { ok: true; value: EpiDeliveryInput }).value;

      const replacesId = typeof raw.replacesDeliveryId === "string" && raw.replacesDeliveryId ? raw.replacesDeliveryId : null;
      if (replacesId) {
        const previous = await tx.hrEpiDelivery.findFirst({
          where: { id: replacesId, employeeId: input.employeeId },
          select: { id: true, deliveredAt: true, status: true },
        });
        if (!previous) throw new PeopleProfileAccessError("NOT_FOUND", `${label}: entrega a substituir não encontrada.`, 404);
        if (previous.status !== "ACTIVE") {
          throw new PeopleProfileAccessError("EPI_NOT_ACTIVE", `${label}: só uma entrega vigente pode ser substituída.`, 409);
        }
        if (toIsoDay(previous.deliveredAt)! > deliveredOn) {
          invalid(`${label}: a substituição não pode ter data anterior à entrega substituída.`);
        }
      }

      const row = await tx.hrEpiDelivery.create({
        data: {
          employeeId: input.employeeId,
          eventId: event.id,
          itemId: item.id,
          item: item.description,
          itemCode: item.code,
          itemType: item.type,
          itemCaNumber: item.caNumber,
          itemUnit: item.unit,
          deliveredAt,
          quantity: v.quantity,
          size: v.size,
          notes: v.notes,
          replacementDays: v.replacementDays,
          replacementDueDate: v.replacementDueDate ? epiDayToDate(v.replacementDueDate) : null,
          replacementAdjustReason: v.adjustReason,
          responsibleName,
          createdByUserId: input.actorUserId ?? null,
        },
      });

      if (replacesId) {
        // Guarda de concorrência: só substitui se ainda estiver vigente (outra substituição perde e desfaz tudo).
        const done = await tx.hrEpiDelivery.updateMany({
          where: { id: replacesId, employeeId: input.employeeId, status: "ACTIVE", replacedByDeliveryId: null },
          data: {
            status: "REPLACED",
            replacedByDeliveryId: row.id,
            statusReason: `Substituída pela entrega de ${deliveredOn.split("-").reverse().join("/")}`,
            statusChangedAt: new Date(),
            statusChangedByUserId: input.actorUserId ?? null,
          },
        });
        if (done.count !== 1) {
          throw new PeopleProfileAccessError("EPI_NOT_ACTIVE", `${label}: a entrega já foi substituída ou encerrada por outra operação.`, 409);
        }
      }

      await writeHistoryEvent(tx, {
        employeeId: input.employeeId,
        eventType: "EPI_DELIVERY",
        effectiveDate: deliveredAt,
        source: "USER",
        notes: replacesId ? `${epiHistoryLabel(row)} (substituição)` : epiHistoryLabel(row),
        createdByUserId: input.actorUserId,
        metadata: { recordType: "epiDelivery", recordId: row.id },
      });
      logEmployeeHrAudit({
        event: replacesId ? "employee.epi.replace" : "employee.epi.delivery",
        actorUserId: input.actorUserId,
        employeeId: input.employeeId,
        details: {
          deliveryId: row.id,
          eventId: event.id,
          itemId: item.id,
          itemCode: item.code,
          quantity: v.quantity,
          replacedDeliveryId: replacesId,
          adjusted: v.adjustReason != null,
        },
      });
      created.push({ id: row.id, item: row.item, itemCode: row.itemCode, replacedDeliveryId: replacesId });
    }
    logEmployeeHrAudit({
      event: "employee.epi.event.create",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { eventId: event.id, items: created.length, deliveredOn },
    });
    return { event: { id: event.id, deliveredOn }, deliveries: created };
  });
}

/**
 * Entrega de um único item (ex.: "Substituir" na linha do item): um evento de 1 item.
 * Corpo como o de um item, com `deliveredOn` e, opcionalmente, `replacesDeliveryId`.
 */
export async function createEpiDelivery(
  prisma: PrismaClient,
  input: { employeeId: string; body: Record<string, unknown>; todayIso: string; actorUserId?: string | null }
) {
  const { deliveredOn, ...item } = input.body;
  const result = await createEpiDeliveryEvent(prisma, {
    employeeId: input.employeeId,
    todayIso: input.todayIso,
    actorUserId: input.actorUserId,
    body: { deliveredOn, items: [item] },
  });
  return { id: result.deliveries[0].id, eventId: result.event.id };
}

/**
 * Retificação auditável de um item. Itens do catálogo: quantidade, tamanho, observações e prazo/data de troca
 * (com justificativa); a data só aqui quando o evento tem um único item (senão, corrija a entrega/evento).
 * O item não muda: cancele e registre outro. Entregas antigas (texto livre) seguem a edição de antes.
 */
export async function updateEpiDelivery(
  prisma: PrismaClient,
  input: { employeeId: string; recordId: string; patch: unknown; todayIso: string; actorUserId?: string | null }
) {
  assertRecordIds(input.employeeId, input.recordId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEpiDelivery.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: {
        id: true,
        eventId: true,
        item: true,
        itemCode: true,
        itemId: true,
        deliveredAt: true,
        quantity: true,
        size: true,
        notes: true,
        status: true,
        replacementDays: true,
        replacementDueDate: true,
        replacementAdjustReason: true,
        catalogItem: { select: { replacementDays: true } },
      },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Entrega de EPI não encontrada.", 404);
    if (row.status === "CANCELLED") {
      throw new PeopleProfileAccessError("EPI_CANCELLED", "Entrega cancelada não pode ser alterada.", 409);
    }
    const body = (input.patch && typeof input.patch === "object" && !Array.isArray(input.patch) ? input.patch : {}) as Record<
      string,
      unknown
    >;
    /** Data do item = data do evento: só muda aqui quando o evento tem um único item. */
    const syncEventDate = async (deliveredAt: Date) => {
      const siblings = await tx.hrEpiDelivery.count({ where: { eventId: row.eventId } });
      if (siblings > 1) {
        throw new PeopleProfileAccessError(
          "EPI_EVENT_DATE",
          "Esta entrega tem vários itens: corrija a data na própria entrega (vale para todos os itens).",
          400
        );
      }
      await tx.hrEpiDeliveryEvent.updateMany({ where: { id: row.eventId, employeeId: input.employeeId }, data: { deliveredAt } });
    };

    if (!row.itemId) {
      const patch = parseEpiDeliveryPatch(body);
      const item = patch.item ?? row.item;
      const deliveredAt = patch.deliveredAt ?? row.deliveredAt;
      if (!sameInstant(deliveredAt, row.deliveredAt)) await syncEventDate(deliveredAt);
      const data: Prisma.HrEpiDeliveryUncheckedUpdateManyInput = {};
      if (patch.item !== undefined) data.item = patch.item;
      if (patch.deliveredAt !== undefined) data.deliveredAt = patch.deliveredAt;
      if (patch.quantity !== undefined) data.quantity = patch.quantity;
      if (patch.size !== undefined) data.size = patch.size;
      if (patch.validUntil !== undefined) data.validUntil = patch.validUntil;
      if (patch.returnedAt !== undefined) data.returnedAt = patch.returnedAt;
      if (patch.responsibleName !== undefined) data.responsibleName = patch.responsibleName;
      if (patch.notes !== undefined) data.notes = patch.notes;
      if (Object.keys(data).length > 0) {
        await tx.hrEpiDelivery.updateMany({ where: { id: row.id, employeeId: input.employeeId }, data });
      }
      if (item !== row.item || !sameInstant(deliveredAt, row.deliveredAt)) {
        await syncLinkedHistoryEvent(tx, {
          employeeId: input.employeeId,
          link: { recordType: "epiDelivery", recordId: row.id },
          legacy: { eventTypes: ["EPI_DELIVERY"], effectiveDate: row.deliveredAt, notes: row.item },
          data: { effectiveDate: deliveredAt, notes: item },
        });
      }
      logEmployeeHrAudit({
        event: "employee.epi.update",
        actorUserId: input.actorUserId,
        employeeId: input.employeeId,
        details: { deliveryId: row.id, fields: Object.keys(patch) },
      });
      return { id: row.id };
    }

    if (Object.prototype.hasOwnProperty.call(body, "itemId") && body.itemId !== row.itemId) {
      throw new PeopleProfileAccessError(
        "EPI_ITEM_IMMUTABLE",
        "O item de uma entrega não muda: cancele esta entrega e registre a correta.",
        400
      );
    }
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
    const currentDue = toIsoDay(row.replacementDueDate);
    const merged: Record<string, unknown> = {
      itemId: row.itemId,
      deliveredOn: has("deliveredOn") ? body.deliveredOn : toIsoDay(row.deliveredAt),
      quantity: has("quantity") ? body.quantity : row.quantity,
      size: has("size") ? body.size : row.size,
      notes: has("notes") ? body.notes : row.notes,
      replacementDays: has("replacementDays") ? body.replacementDays : row.replacementDays,
      // Ajuste já justificado continua valendo quando a correção não mexe no prazo.
      adjustReason: has("adjustReason") ? body.adjustReason : row.replacementAdjustReason,
    };
    // Data prevista: a informada agora; senão a gravada (se o prazo e a data da entrega não mudaram).
    if (has("replacementDueDate")) merged.replacementDueDate = body.replacementDueDate;
    else if (!has("replacementDays") && !has("deliveredOn")) merged.replacementDueDate = currentDue;
    const parsed = validateEpiDeliveryInput(merged, {
      todayIso: input.todayIso,
      catalogReplacementDays: row.catalogItem?.replacementDays ?? null,
    });
    if (parsed.ok === false) throw new PeopleProfileAccessError("INVALID_EPI_DELIVERY", parsed.errors.join(" "), 400);
    const v = parsed.value;

    const deliveredAt = epiDayToDate(v.deliveredOn);
    const next = {
      deliveredOn: v.deliveredOn,
      quantity: v.quantity,
      size: v.size,
      notes: v.notes,
      replacementDays: v.replacementDays,
      replacementDueDate: v.replacementDueDate,
    };
    const prev = {
      deliveredOn: toIsoDay(row.deliveredAt),
      quantity: row.quantity,
      size: row.size,
      notes: row.notes,
      replacementDays: row.replacementDays,
      replacementDueDate: currentDue,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== prev[k]);
    if (changed.length === 0) return { id: row.id };
    if (changed.includes("deliveredOn")) await syncEventDate(deliveredAt);
    await tx.hrEpiDelivery.updateMany({
      where: { id: row.id, employeeId: input.employeeId },
      data: {
        deliveredAt,
        quantity: v.quantity,
        size: v.size,
        notes: v.notes,
        replacementDays: v.replacementDays,
        replacementDueDate: v.replacementDueDate ? epiDayToDate(v.replacementDueDate) : null,
        replacementAdjustReason: v.adjustReason,
      },
    });
    if (!sameInstant(deliveredAt, row.deliveredAt)) {
      await syncLinkedHistoryEvent(tx, {
        employeeId: input.employeeId,
        link: { recordType: "epiDelivery", recordId: row.id },
        legacy: { eventTypes: ["EPI_DELIVERY"], effectiveDate: row.deliveredAt, notes: row.item },
        data: { effectiveDate: deliveredAt },
      });
    }
    // Valores anteriores dos campos alterados (sem observações, que podem ser longas/sensíveis).
    const previousValues = Object.fromEntries(changed.filter((k) => k !== "notes").map((k) => [k, prev[k]]));
    logEmployeeHrAudit({
      event: "employee.epi.update",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { deliveryId: row.id, fields: changed, previous: previousValues, adjustReason: v.adjustReason },
    });
    return { id: row.id };
  });
}

/**
 * Correção da entrega (evento): data (vale para todos os itens; a próxima troca calculada acompanha,
 * a ajustada com justificativa é mantida) e observações. A ficha emitida não muda: a próxima emissão
 * gera nova revisão.
 */
export async function updateEpiDeliveryEvent(
  prisma: PrismaClient,
  input: { employeeId: string; eventId: string; patch: unknown; todayIso: string; actorUserId?: string | null }
) {
  assertRecordIds(input.employeeId, input.eventId);
  const body = (input.patch && typeof input.patch === "object" && !Array.isArray(input.patch) ? input.patch : {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  return prisma.$transaction(async (tx) => {
    const event = await tx.hrEpiDeliveryEvent.findFirst({
      where: { id: input.eventId, employeeId: input.employeeId },
      select: {
        id: true,
        deliveredAt: true,
        notes: true,
        deliveries: {
          select: { id: true, item: true, deliveredAt: true, status: true, replacementDays: true, replacementDueDate: true, replacementAdjustReason: true },
        },
      },
    });
    if (!event) throw new PeopleProfileAccessError("NOT_FOUND", "Entrega de EPI não encontrada.", 404);
    const fields: string[] = [];
    const data: Prisma.HrEpiDeliveryEventUncheckedUpdateManyInput = {};
    if (has("notes")) {
      const notes = normalizeOptionalText(body.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);
      if (notes !== event.notes) {
        data.notes = notes;
        fields.push("notes");
      }
    }
    const previousOn = toIsoDay(event.deliveredAt)!;
    if (has("deliveredOn")) {
      const on = typeof body.deliveredOn === "string" ? body.deliveredOn.slice(0, 10) : "";
      if (!isIsoDate(on)) throw new PeopleProfileAccessError("INVALID_EPI_DELIVERY", "Data da entrega é obrigatória.", 400);
      if (on > input.todayIso) throw new PeopleProfileAccessError("INVALID_EPI_DELIVERY", "A data da entrega não pode ser futura.", 400);
      if (on !== previousOn) {
        const deliveredAt = epiDayToDate(on);
        data.deliveredAt = deliveredAt;
        fields.push("deliveredOn");
        for (const d of event.deliveries) {
          const ownDue = toIsoDay(d.replacementDueDate);
          const due = d.replacementDays && !d.replacementAdjustReason ? addDaysIso(on, d.replacementDays) : ownDue;
          if (due && due <= on) {
            throw new PeopleProfileAccessError(
              "INVALID_EPI_DELIVERY",
              `${d.item}: a próxima troca ajustada (${due.split("-").reverse().join("/")}) ficaria antes da nova data. Corrija o item antes.`,
              400
            );
          }
          await tx.hrEpiDelivery.updateMany({
            where: { id: d.id, employeeId: input.employeeId },
            data: { deliveredAt, replacementDueDate: due ? epiDayToDate(due) : null },
          });
          await syncLinkedHistoryEvent(tx, {
            employeeId: input.employeeId,
            link: { recordType: "epiDelivery", recordId: d.id },
            legacy: { eventTypes: ["EPI_DELIVERY"], effectiveDate: d.deliveredAt, notes: d.item },
            data: { effectiveDate: deliveredAt },
          });
        }
      }
    }
    if (fields.length === 0) return { id: event.id };
    await tx.hrEpiDeliveryEvent.updateMany({ where: { id: event.id, employeeId: input.employeeId }, data });
    logEmployeeHrAudit({
      event: "employee.epi.event.update",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { eventId: event.id, fields, previousDeliveredOn: fields.includes("deliveredOn") ? previousOn : undefined },
    });
    return { id: event.id };
  });
}

/**
 * Cancelar (lançamento incorreto) ou encerrar (ciclo finalizado sem nova entrega).
 * Ambos só a partir de "Vigente" e com motivo. Cancelar uma substituição devolve
 * a entrega anterior a "Vigente".
 */
export async function setEpiDeliveryStatus(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    recordId: string;
    action: "CANCEL" | "CLOSE";
    reason: unknown;
    actorUserId?: string | null;
  }
) {
  assertRecordIds(input.employeeId, input.recordId);
  const reason = validateStatusReason(input.reason);
  if (reason.ok === false) throw new PeopleProfileAccessError("INVALID_REASON", reason.errors.join(" "), 400);
  const status = input.action === "CANCEL" ? "CANCELLED" : "CLOSED";
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEpiDelivery.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: { id: true, item: true, itemCode: true, deliveredAt: true, status: true, replaces: { select: { id: true } } },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Entrega de EPI não encontrada.", 404);
    const done = await tx.hrEpiDelivery.updateMany({
      where: { id: row.id, employeeId: input.employeeId, status: "ACTIVE" },
      data: {
        status,
        statusReason: reason.value,
        statusChangedAt: new Date(),
        statusChangedByUserId: input.actorUserId ?? null,
      },
    });
    if (done.count !== 1) {
      throw new PeopleProfileAccessError(
        "EPI_NOT_ACTIVE",
        input.action === "CANCEL"
          ? "Só uma entrega vigente pode ser cancelada (cancele antes a entrega que a substituiu)."
          : "Só uma entrega vigente pode ser encerrada.",
        409
      );
    }
    let restoredId: string | null = null;
    if (status === "CANCELLED" && row.replaces) {
      await tx.hrEpiDelivery.updateMany({
        where: { id: row.replaces.id, employeeId: input.employeeId, status: "REPLACED", replacedByDeliveryId: row.id },
        data: {
          status: "ACTIVE",
          replacedByDeliveryId: null,
          statusReason: null,
          statusChangedAt: new Date(),
          statusChangedByUserId: input.actorUserId ?? null,
        },
      });
      restoredId = row.replaces.id;
    }
    if (status === "CANCELLED") {
      await syncLinkedHistoryEvent(tx, {
        employeeId: input.employeeId,
        link: { recordType: "epiDelivery", recordId: row.id },
        legacy: { eventTypes: ["EPI_DELIVERY"], effectiveDate: row.deliveredAt, notes: row.item },
        data: { notes: `${epiHistoryLabel(row)} — cancelada: ${reason.value}` },
      });
    }
    logEmployeeHrAudit({
      event: status === "CANCELLED" ? "employee.epi.cancel" : "employee.epi.close",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { deliveryId: row.id, reason: reason.value, restoredDeliveryId: restoredId },
    });
    return { id: row.id, status, restoredDeliveryId: restoredId };
  });
}

/** Entregas não são excluídas: o histórico é preservado (cancelar com motivo). */
export async function deleteEpiDelivery(
  _prisma: PrismaClient,
  input: { employeeId: string; recordId: string; actorUserId?: string | null }
): Promise<never> {
  assertRecordIds(input.employeeId, input.recordId);
  throw new PeopleProfileAccessError(
    "EPI_DELETE_NOT_ALLOWED",
    "Entregas de EPI não são excluídas. Use Cancelar (lançamento incorreto) ou Encerrar, informando o motivo.",
    405
  );
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
  const name = normalizeRequiredText(input.name, "Nome", PEOPLE_RECORD_TEXT_LIMITS.contactName);
  const phone = normalizeRequiredText(input.phone, "Telefone", PEOPLE_RECORD_TEXT_LIMITS.phone);
  const relationship = normalizeOptionalText(
    input.relationship,
    "Parentesco",
    PEOPLE_RECORD_TEXT_LIMITS.relationship
  );
  const alternatePhone = normalizeOptionalText(
    input.alternatePhone,
    "Telefone alternativo",
    PEOPLE_RECORD_TEXT_LIMITS.phone
  );
  const priority = normalizePriority(input.priority ?? 2);
  const notes = normalizeOptionalText(input.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEmergencyContact.create({
      data: {
        employeeId: input.employeeId,
        name,
        phone,
        relationship,
        alternatePhone,
        priority,
        notes,
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

/** O contato principal vive nas colunas do Employee: não é um HrEmergencyContact. */
function assertNotPrimaryEmergencyContact(recordId: string): void {
  if (recordId === PEOPLE_PRIMARY_EMERGENCY_CONTACT_ID) {
    throw new PeopleProfileAccessError(
      "PRIMARY_CONTACT",
      "O contato principal é editado no cadastro do colaborador (guia Emergência).",
      400
    );
  }
}

export async function updateEmergencyContact(
  prisma: PrismaClient,
  input: { employeeId: string; recordId: string; patch: unknown; actorUserId?: string | null }
) {
  assertNotPrimaryEmergencyContact(input.recordId);
  assertRecordIds(input.employeeId, input.recordId);
  const patch = parseEmergencyContactPatch(input.patch);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEmergencyContact.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: { id: true },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Contato não encontrado.", 404);

    const data: Prisma.HrEmergencyContactUncheckedUpdateManyInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.phone !== undefined) data.phone = patch.phone;
    if (patch.relationship !== undefined) data.relationship = patch.relationship;
    if (patch.alternatePhone !== undefined) data.alternatePhone = patch.alternatePhone;
    if (patch.priority !== undefined) data.priority = patch.priority;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (Object.keys(data).length > 0) {
      await tx.hrEmergencyContact.updateMany({
        where: { id: row.id, employeeId: input.employeeId },
        data,
      });
    }

    logEmployeeHrAudit({
      event: "employee.emergency.change",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { action: "update", contactId: row.id, fields: Object.keys(patch) },
    });
    return { id: row.id };
  });
}

export async function deleteEmergencyContact(
  prisma: PrismaClient,
  input: { employeeId: string; recordId: string; actorUserId?: string | null }
) {
  assertNotPrimaryEmergencyContact(input.recordId);
  assertRecordIds(input.employeeId, input.recordId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEmergencyContact.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: { id: true },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Contato não encontrado.", 404);

    await tx.hrEmergencyContact.deleteMany({
      where: { id: row.id, employeeId: input.employeeId },
    });

    logEmployeeHrAudit({
      event: "employee.emergency.change",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { action: "delete", contactId: row.id },
    });
    return { ok: true as const };
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
  evaluationId?: string | null;
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
        evaluationId: input.evaluationId ?? null,
      },
    });
    await writeHistoryEvent(tx, {
      employeeId: input.employeeId,
      eventType: "DOCUMENT_ADDED",
      effectiveDate: new Date(),
      source: "USER",
      notes: input.displayName,
      createdByUserId: input.actorUserId,
      metadata: { recordType: "document", recordId: row.id },
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

/** Correção de metadados do documento — o arquivo não muda. */
export async function updateEmployeeDocument(
  prisma: PrismaClient,
  input: { employeeId: string; recordId: string; patch: unknown; actorUserId?: string | null }
) {
  assertRecordIds(input.employeeId, input.recordId);
  const patch = parseEmployeeDocumentPatch(input.patch);
  return prisma.$transaction(async (tx) => {
    const row = await tx.hrEmployeeDocument.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: { id: true, displayName: true, createdAt: true, uploadedByUserId: true },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Documento não encontrado.", 404);

    const data: Prisma.HrEmployeeDocumentUncheckedUpdateManyInput = {};
    if (patch.documentType !== undefined) data.documentType = patch.documentType;
    if (patch.displayName !== undefined) data.displayName = patch.displayName;
    if (patch.issuedAt !== undefined) data.issuedAt = patch.issuedAt;
    if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (Object.keys(data).length > 0) {
      await tx.hrEmployeeDocument.updateMany({
        where: { id: row.id, employeeId: input.employeeId },
        data,
      });
    }

    // O evento DOCUMENT_ADDED guarda o nome de exibição como rótulo.
    if (patch.displayName !== undefined && patch.displayName !== row.displayName) {
      await syncLinkedHistoryEvent(tx, {
        employeeId: input.employeeId,
        link: { recordType: "document", recordId: row.id },
        legacy: {
          eventTypes: ["DOCUMENT_ADDED"],
          effectiveDate: legacyCreationWindow(row.createdAt),
          notes: row.displayName,
          createdByUserId: row.uploadedByUserId,
        },
        data: { notes: patch.displayName },
      });
    }

    logEmployeeHrAudit({
      event: "employee.document.update",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { documentId: row.id, fields: Object.keys(patch) },
    });
    return { id: row.id };
  });
}

/** Remove a linha (e o evento vinculado) no banco; o arquivo só sai depois do COMMIT. */
export async function deleteEmployeeDocument(
  prisma: PrismaClient,
  input: { employeeId: string; recordId: string; actorUserId?: string | null }
) {
  assertRecordIds(input.employeeId, input.recordId);
  const storageKey = await prisma.$transaction(async (tx) => {
    const row = await tx.hrEmployeeDocument.findFirst({
      where: { id: input.recordId, employeeId: input.employeeId },
      select: {
        id: true,
        displayName: true,
        storageKey: true,
        createdAt: true,
        uploadedByUserId: true,
      },
    });
    if (!row) throw new PeopleProfileAccessError("NOT_FOUND", "Documento não encontrado.", 404);
    // Comprovante de entrega de EPI é registro histórico (a FK também impede a exclusão).
    const epiReceipts = await tx.hrEpiDeliveryReceipt.count({ where: { documentId: row.id } });
    if (epiReceipts > 0) {
      throw new PeopleProfileAccessError(
        "DOCUMENT_IN_USE",
        "Este documento é o comprovante de uma entrega de EPI e não pode ser excluído.",
        409
      );
    }

    await deleteLinkedHistoryEvent(tx, {
      employeeId: input.employeeId,
      link: { recordType: "document", recordId: row.id },
      legacy: {
        eventTypes: ["DOCUMENT_ADDED"],
        effectiveDate: legacyCreationWindow(row.createdAt),
        notes: row.displayName,
        createdByUserId: row.uploadedByUserId,
      },
    });
    await tx.hrEmployeeDocument.deleteMany({
      where: { id: row.id, employeeId: input.employeeId },
    });

    logEmployeeHrAudit({
      event: "employee.document.delete",
      actorUserId: input.actorUserId,
      employeeId: input.employeeId,
      details: { documentId: row.id },
    });
    return row.storageKey;
  });
  await deleteAppLocalFile(storageKey).catch(() => undefined);
  return { ok: true as const };
}

/** Foto do colaborador: tipo validado pelos magic bytes; a foto anterior é apagada após o COMMIT. */
export async function saveEmployeePhoto(input: {
  prisma: PrismaClient;
  employeeId: string;
  buffer: Buffer;
  actorUserId?: string | null;
}) {
  if (!isEmployeeUuid(input.employeeId)) {
    throw new PeopleProfileAccessError("INVALID_ID", "Colaborador inválido.", 400);
  }
  const contentType = sniffImageContentType(input.buffer);
  if (!contentType) {
    throw new PeopleProfileAccessError(
      "INVALID_PHOTO",
      "Envie uma imagem JPEG, PNG ou WebP.",
      400
    );
  }
  if (input.buffer.byteLength > PEOPLE_PROFILE_PHOTO_MAX_BYTES) {
    throw new PeopleProfileAccessError("PHOTO_TOO_LARGE", "A foto deve ter no máximo 5 MB.", 400);
  }

  const saved = await saveAppLocalFile({
    namespace: "hremployeephotos",
    entityId: input.employeeId,
    originalFileName: `foto.${PEOPLE_PROFILE_PHOTO_EXTENSIONS[contentType]}`,
    buffer: input.buffer,
  });
  let previousKey: string | null = null;
  try {
    previousKey = await input.prisma.$transaction(async (tx) => {
      const current = await tx.employee.findUnique({
        where: { id: input.employeeId },
        select: { id: true, photoStorageKey: true },
      });
      if (!current) {
        throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
      }
      await tx.employee.update({
        where: { id: input.employeeId },
        data: { photoStorageKey: saved.storageKey },
      });
      return current.photoStorageKey;
    });
  } catch (error) {
    await deleteAppLocalFile(saved.storageKey).catch(() => undefined);
    throw error;
  }
  if (previousKey && previousKey !== saved.storageKey) {
    await deleteAppLocalFile(previousKey).catch(() => undefined);
  }

  logEmployeeHrAudit({
    event: "employee.photo.change",
    actorUserId: input.actorUserId,
    employeeId: input.employeeId,
    details: { action: "upload", replaced: Boolean(previousKey) },
  });
  return { photoUrl: buildEmployeePhotoUrl(input.employeeId, saved.storageKey) };
}

export async function removeEmployeePhoto(
  prisma: PrismaClient,
  input: { employeeId: string; actorUserId?: string | null }
) {
  if (!isEmployeeUuid(input.employeeId)) {
    throw new PeopleProfileAccessError("INVALID_ID", "Colaborador inválido.", 400);
  }
  const previousKey = await prisma.$transaction(async (tx) => {
    const current = await tx.employee.findUnique({
      where: { id: input.employeeId },
      select: { id: true, photoStorageKey: true },
    });
    if (!current) {
      throw new PeopleProfileAccessError("NOT_FOUND", "Colaborador não encontrado.", 404);
    }
    if (current.photoStorageKey) {
      await tx.employee.update({
        where: { id: input.employeeId },
        data: { photoStorageKey: null },
      });
    }
    return current.photoStorageKey;
  });
  if (previousKey) await deleteAppLocalFile(previousKey).catch(() => undefined);

  logEmployeeHrAudit({
    event: "employee.photo.change",
    actorUserId: input.actorUserId,
    employeeId: input.employeeId,
    details: { action: "remove", removed: Boolean(previousKey) },
  });
  return { ok: true as const };
}

/** Lê a foto e devolve o content-type real (magic bytes); null quando não há foto/arquivo. */
export async function readEmployeePhotoFile(
  prisma: PrismaClient,
  input: { employeeId: string }
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const row = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { photoStorageKey: true },
  });
  if (!row?.photoStorageKey) return null;
  let buffer: Buffer;
  try {
    buffer = await readAppLocalFile(row.photoStorageKey);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
  return { buffer, contentType: sniffImageContentType(buffer) ?? "application/octet-stream" };
}
