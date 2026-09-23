/**
 * Avaliações de RH — persistência e regras de ciclo.
 * A média, a conclusão e o snapshot dos critérios ficam aqui, não no React.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { logEmployeeHrAudit } from "./employeeHrAudit.js";
import {
  EXPERIENCE_FALLBACK_CONTRACT_DAYS,
  HR_EVALUATION_ACTION_STATUS_LABELS,
  HR_EVALUATION_ACTION_STATUSES,
  HR_EVALUATION_CRITERION_SEEDS,
  HR_EVALUATION_STATUSES,
  HR_EVALUATION_TEMPLATE_SEEDS,
  HR_EVALUATION_TYPES,
  HrEvaluationError,
  addCalendarDays,
  assertPatchableStatus,
  calculateEvaluationAverage,
  compareExperienceEvaluations,
  evaluationAlert,
  evaluationPrintSubtitle,
  evaluationStatusLabel,
  evaluationTypeLabel,
  evaluationTypeShortLabel,
  experienceCycleKey,
  formatAverageLabel,
  formatEvaluationReferenceCode,
  historyNoteForCompletedEvaluation,
  isAllowedEvaluationAttachment,
  isKnownEvaluationType,
  isValidRecommendation,
  isoDateInSaoPaulo,
  isoDateToStoredDate,
  normalizeAnswerScore,
  recommendationLabel,
  scheduleExperienceDates,
  shouldAutoScheduleExperience,
  statusAfterPrint,
  statusAfterTranscription,
  storedDateToIso,
  validateEvaluationCompletion,
  type ComparisonSide,
  type HrEmployeeEvaluationDto,
  type HrEvaluationActionPlanDto,
  type HrEvaluationUpdateInput,
} from "./hrEvaluation.js";
import { saveEmployeeDocument, writeHistoryEvent } from "./peopleProfileMutations.server.js";

type Db = PrismaClient | Prisma.TransactionClient;

let templatesReady = false;

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clip(value: unknown, max: number, label: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new HrEvaluationError("INVALID_FIELD", `${label} inválido.`);
  }
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) {
    throw new HrEvaluationError("INVALID_FIELD", `${label} excede ${max} caracteres.`);
  }
  return text;
}

function parseIsoDate(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HrEvaluationError("INVALID_DATE", `${label} inválida.`);
  }
  return value;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function uniqueTarget(error: unknown): string {
  if (typeof error !== "object" || error === null || !("meta" in error)) return "";
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.join(",");
  return typeof target === "string" ? target : "";
}

async function actorNames(db: Db, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const users = await db.appUser.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((user) => [user.id, user.name]));
}

export async function ensureEvaluationTemplates(prisma: PrismaClient): Promise<void> {
  if (templatesReady) return;
  for (const seed of HR_EVALUATION_TEMPLATE_SEEDS) {
    const template = await prisma.hrEvaluationTemplate.upsert({
      where: { code: seed.code },
      create: {
        code: seed.code,
        name: seed.name,
        description: seed.description,
        evaluationType: seed.evaluationType,
        active: true,
        version: seed.version,
      },
      update: {},
    });
    for (const criterion of HR_EVALUATION_CRITERION_SEEDS) {
      await prisma.hrEvaluationCriterion.upsert({
        where: { templateId_code: { templateId: template.id, code: criterion.code } },
        create: {
          templateId: template.id,
          code: criterion.code,
          name: criterion.name,
          category: criterion.category,
          sortOrder: criterion.sortOrder,
          active: true,
          allowNotApplicable: true,
          weight: new Prisma.Decimal(1),
        },
        update: {},
      });
    }
  }
  templatesReady = true;
}

const evaluationInclude = {
  employee: { select: { id: true, name: true } },
  answers: { orderBy: { sortOrderSnapshot: "asc" as const } },
  actionPlans: { orderBy: { createdAt: "asc" as const } },
  documents: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      displayName: true,
      originalFileName: true,
      mimeType: true,
      fileSize: true,
      createdAt: true,
      uploadedByUserId: true,
    },
  },
  auditEvents: { orderBy: { createdAt: "desc" as const }, take: 30 },
} satisfies Prisma.HrEmployeeEvaluationInclude;

type EvaluationRow = Prisma.HrEmployeeEvaluationGetPayload<{ include: typeof evaluationInclude }>;

function scheduleNote(row: {
  evaluationType: string;
  admissionDateSnapshot: Date | null;
  periodEnd: Date | null;
}): string | null {
  if (row.evaluationType !== "EXPERIENCE_FINAL") return null;
  const admission = storedDateToIso(row.admissionDateSnapshot);
  const end = storedDateToIso(row.periodEnd);
  if (!admission || !end) return null;
  if (end === addCalendarDays(admission, EXPERIENCE_FALLBACK_CONTRACT_DAYS)) {
    return "Término estimado em 90 dias após a admissão. A ficha não possui data de término do contrato de experiência; o RH pode ajustar a data prevista.";
  }
  return null;
}

function mapActionPlan(
  plan: EvaluationRow["actionPlans"][number]
): HrEvaluationActionPlanDto {
  return {
    id: plan.id,
    evaluationId: plan.evaluationId,
    title: plan.title,
    description: plan.description,
    responsibleEmployeeId: plan.responsibleEmployeeId,
    responsibleName: plan.responsibleNameSnapshot,
    dueDate: storedDateToIso(plan.dueDate),
    status: plan.status,
    statusLabel: HR_EVALUATION_ACTION_STATUS_LABELS[plan.status] ?? plan.status,
    completedAt: plan.completedAt ? plan.completedAt.toISOString() : null,
    notes: plan.notes,
  };
}

async function toDto(
  db: Db,
  row: EvaluationRow,
  priorActionPlans: HrEvaluationActionPlanDto[] = []
): Promise<HrEmployeeEvaluationDto> {
  const names = await actorNames(db, [
    row.transcriptionUserId,
    ...row.documents.map((doc) => doc.uploadedByUserId),
    ...row.auditEvents.map((event) => event.actorUserId),
  ]);
  const score = asNumber(row.generalScore);
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: row.employee.name,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    templateName: row.templateNameSnapshot,
    evaluationType: row.evaluationType,
    typeLabel: evaluationTypeLabel(row.evaluationType),
    shortLabel: evaluationTypeShortLabel(row.evaluationType),
    referenceCode: row.referenceCode,
    cycleKey: row.cycleKey,
    status: row.status,
    statusLabel: evaluationStatusLabel(row.status),
    admissionDate: storedDateToIso(row.admissionDateSnapshot),
    roleName: row.roleNameSnapshot,
    department: row.departmentSnapshot,
    registration: row.registrationSnapshot,
    periodStart: storedDateToIso(row.periodStart),
    periodEnd: storedDateToIso(row.periodEnd),
    dueDate: storedDateToIso(row.dueDate),
    evaluationDate: storedDateToIso(row.evaluationDate),
    evaluatorEmployeeId: row.evaluatorEmployeeId,
    evaluatorName: row.evaluatorNameSnapshot,
    evaluatorRole: row.evaluatorRoleSnapshot,
    managerName: row.managerNameSnapshot,
    generalScore: score,
    averageLabel: formatAverageLabel(score),
    recommendation: row.recommendation,
    recommendationLabel: recommendationLabel(row.evaluationType, row.recommendation),
    recommendationNotes: row.recommendationNotes,
    strengths: row.strengths,
    developmentPoints: row.developmentPoints,
    actionGuidance: row.actionGuidance,
    employeeAcknowledged: row.employeeAcknowledged,
    employeeAcknowledgedAt: storedDateToIso(row.employeeAcknowledgedAt),
    employeeAcknowledgementNotes: row.employeeAcknowledgementNotes,
    transcriptionAt: row.transcriptionAt ? row.transcriptionAt.toISOString() : null,
    transcriptionUserName: row.transcriptionUserId ? names.get(row.transcriptionUserId) ?? null : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    printedAt: row.printedAt ? row.printedAt.toISOString() : null,
    scheduleNote: scheduleNote(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    answers: row.answers.map((answer) => ({
      id: answer.id,
      criterionId: answer.criterionId,
      code: answer.criterionCodeSnapshot,
      name: answer.criterionNameSnapshot,
      category: answer.criterionCategorySnapshot,
      sortOrder: answer.sortOrderSnapshot,
      allowNotApplicable: answer.allowNotApplicableSnapshot,
      score: answer.score,
      notApplicable: answer.notApplicable,
      comment: answer.comment,
    })),
    actionPlans: row.actionPlans.map(mapActionPlan),
    priorActionPlans,
    documents: row.documents.map((doc) => {
      const downloadUrl = `/api/employees/${row.employeeId}/documents/${doc.id}/download`;
      return {
        id: doc.id,
        displayName: doc.displayName,
        originalFileName: doc.originalFileName,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        createdAt: doc.createdAt.toISOString(),
        uploadedByName: doc.uploadedByUserId ? names.get(doc.uploadedByUserId) ?? null : null,
        downloadUrl,
        openUrl: `${downloadUrl}?inline=1`,
      };
    }),
    audit: row.auditEvents.map((event) => ({
      id: event.id,
      action: event.action,
      actorUserId: event.actorUserId,
      actorName: event.actorUserId ? names.get(event.actorUserId) ?? null : null,
      createdAt: event.createdAt.toISOString(),
      details:
        event.details && typeof event.details === "object" && !Array.isArray(event.details)
          ? (event.details as Record<string, unknown>)
          : null,
    })),
  };
}

async function loadRow(db: Db, employeeId: string, evaluationId: string): Promise<EvaluationRow> {
  const row = await db.hrEmployeeEvaluation.findFirst({
    where: { id: evaluationId, employeeId },
    include: evaluationInclude,
  });
  if (!row) throw new HrEvaluationError("NOT_FOUND", "Avaliação não encontrada.", 404);
  return row;
}

async function priorPlansFor(
  db: Db,
  row: { id: string; employeeId: string; evaluationType: string; cycleKey: string }
): Promise<HrEvaluationActionPlanDto[]> {
  if (row.evaluationType !== "EXPERIENCE_FINAL") return [];
  const base = row.cycleKey.split("#")[0];
  const source = await db.hrEmployeeEvaluation.findFirst({
    where: {
      employeeId: row.employeeId,
      evaluationType: "EXPERIENCE_45_DAYS",
      status: { not: "CANCELLED" },
      OR: [{ cycleKey: base }, { cycleKey: { startsWith: `${base}#` } }],
    },
    orderBy: { createdAt: "desc" },
    include: { actionPlans: { orderBy: { createdAt: "asc" } } },
  });
  return source?.actionPlans.map(mapActionPlan) ?? [];
}

function sideFromDto(dto: HrEmployeeEvaluationDto): ComparisonSide {
  return {
    evaluationId: dto.id,
    referenceCode: dto.referenceCode,
    generalScore: dto.generalScore,
    answers: dto.answers.map((answer) => ({
      code: answer.code,
      name: answer.name,
      sortOrder: answer.sortOrder,
      score: answer.score,
      notApplicable: answer.notApplicable,
    })),
  };
}

function comparisonFrom(items: HrEmployeeEvaluationDto[]) {
  const active = items.filter((item) => item.status !== "CANCELLED");
  const forty = active.filter((item) => item.evaluationType === "EXPERIENCE_45_DAYS");
  const finals = active.filter((item) => item.evaluationType === "EXPERIENCE_FINAL");
  for (const left of forty) {
    const base = left.cycleKey.split("#")[0];
    const right = finals.find((item) => item.cycleKey.split("#")[0] === base);
    if (right) return compareExperienceEvaluations(sideFromDto(left), sideFromDto(right));
  }
  if (forty[0] && finals[0]) {
    return compareExperienceEvaluations(sideFromDto(forty[0]), sideFromDto(finals[0]));
  }
  return null;
}

async function writeAudit(
  db: Db,
  input: { evaluationId: string; action: string; actorUserId?: string | null; details?: Record<string, unknown> }
) {
  await db.hrEvaluationAuditEvent.create({
    data: {
      evaluationId: input.evaluationId,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      details: (input.details ?? {}) as Prisma.InputJsonValue,
    },
  });
}

async function allocateReferenceCode(db: Db, evaluationType: string): Promise<string> {
  const year = Number(isoDateInSaoPaulo(new Date()).slice(0, 4));
  const prefix = `EXP-${year}-`;
  const rows = await db.hrEmployeeEvaluation.findMany({
    where: { referenceCode: { startsWith: prefix } },
    select: { referenceCode: true },
  });
  let max = 0;
  for (const row of rows) {
    const match = /^EXP-\d{4}-(\d+)-/.exec(row.referenceCode);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return formatEvaluationReferenceCode(year, max + 1, evaluationType);
}

async function loadEmployee(db: Db, employeeId: string) {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      name: true,
      status: true,
      department: true,
      admissionDate: true,
      managerId: true,
      managerName: true,
      personId: true,
      Role: { select: { name: true } },
      orgDepartment: { select: { name: true } },
      manager: { select: { id: true, name: true, Role: { select: { name: true } } } },
    },
  });
  if (!employee) throw new HrEvaluationError("NOT_FOUND", "Colaborador não encontrado.", 404);
  return employee;
}

export async function listEmployeeEvaluations(prisma: PrismaClient, employeeId: string) {
  await ensureEvaluationTemplates(prisma);
  await loadEmployee(prisma, employeeId);
  const rows = await prisma.hrEmployeeEvaluation.findMany({
    where: { employeeId },
    include: evaluationInclude,
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  const items = await Promise.all(rows.map(async (row) => toDto(prisma, row, await priorPlansFor(prisma, row))));
  const todayIso = isoDateInSaoPaulo(new Date());
  const alerts = items
    .map((item) =>
      evaluationAlert({
        id: item.id,
        evaluationType: item.evaluationType,
        status: item.status,
        dueDate: item.dueDate,
        todayIso,
      })
    )
    .filter((alert): alert is NonNullable<typeof alert> => alert != null);
  return {
    items,
    comparison: comparisonFrom(items),
    alerts,
    printSubtitleSample: evaluationPrintSubtitle("EXPERIENCE_45_DAYS"),
  };
}

export async function getEmployeeEvaluation(
  prisma: PrismaClient,
  employeeId: string,
  evaluationId: string
) {
  await ensureEvaluationTemplates(prisma);
  const row = await loadRow(prisma, employeeId, evaluationId);
  return toDto(prisma, row, await priorPlansFor(prisma, row));
}

export async function createEmployeeEvaluation(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    evaluationType: string;
    dueDate?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    confirmDuplicate?: boolean;
    actorUserId?: string | null;
  }
) {
  if (!isKnownEvaluationType(input.evaluationType)) {
    throw new HrEvaluationError("INVALID_TYPE", "Tipo de avaliação inválido.");
  }
  await ensureEvaluationTemplates(prisma);
  const employee = await loadEmployee(prisma, input.employeeId);
  const template = await prisma.hrEvaluationTemplate.findFirst({
    where: { evaluationType: input.evaluationType, active: true },
    orderBy: { version: "desc" },
    include: { criteria: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!template || template.criteria.length === 0) {
    throw new HrEvaluationError("TEMPLATE_MISSING", "Modelo de avaliação não encontrado.", 404);
  }

  const scheduled = scheduleExperienceDates(employee.admissionDate, input.evaluationType);
  const periodStart = parseIsoDate(input.periodStart, "Início do período") ?? scheduled.periodStart;
  const periodEnd = parseIsoDate(input.periodEnd, "Fim do período") ?? scheduled.periodEnd;
  const dueDate = parseIsoDate(input.dueDate, "Data prevista") ?? scheduled.dueDate;
  const baseCycle = experienceCycleKey(employee.admissionDate);
  const cycleKey = input.confirmDuplicate ? `${baseCycle}#${Date.now().toString(36)}` : baseCycle;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const createdId = await prisma.$transaction(async (tx) => {
        if (!input.confirmDuplicate) {
          const duplicate = await tx.hrEmployeeEvaluation.findFirst({
            where: {
              employeeId: input.employeeId,
              evaluationType: input.evaluationType,
              cycleKey: baseCycle,
              status: { not: "CANCELLED" },
            },
            select: { id: true },
          });
          if (duplicate) {
            throw new HrEvaluationError(
              "DUPLICATE_CYCLE",
              "Já existe uma avaliação deste tipo para o mesmo ciclo de admissão. Confirme explicitamente para registrar outra.",
              409
            );
          }
        }
        const referenceCode = await allocateReferenceCode(tx, input.evaluationType);
        const row = await tx.hrEmployeeEvaluation.create({
          data: {
            employeeId: employee.id,
            templateId: template.id,
            templateVersion: template.version,
            templateNameSnapshot: template.name,
            evaluationType: input.evaluationType,
            referenceCode,
            cycleKey,
            status: dueDate ? "READY_TO_PRINT" : "SCHEDULED",
            admissionDateSnapshot: employee.admissionDate,
            roleNameSnapshot: employee.Role?.name ?? null,
            departmentSnapshot: employee.orgDepartment?.name ?? employee.department ?? null,
            registrationSnapshot: null,
            periodStart: periodStart ? isoDateToStoredDate(periodStart) : null,
            periodEnd: periodEnd ? isoDateToStoredDate(periodEnd) : null,
            dueDate: dueDate ? isoDateToStoredDate(dueDate) : null,
            evaluatorEmployeeId: employee.manager?.id ?? employee.managerId,
            evaluatorNameSnapshot: employee.manager?.name ?? employee.managerName,
            evaluatorRoleSnapshot: employee.manager?.Role?.name ?? null,
            managerIdSnapshot: employee.manager?.id ?? employee.managerId,
            managerNameSnapshot: employee.manager?.name ?? employee.managerName,
            createdByUserId: input.actorUserId ?? null,
            updatedByUserId: input.actorUserId ?? null,
            answers: {
              create: template.criteria.map((criterion) => ({
                criterionId: criterion.id,
                criterionCodeSnapshot: criterion.code,
                criterionNameSnapshot: criterion.name,
                criterionCategorySnapshot: criterion.category,
                sortOrderSnapshot: criterion.sortOrder,
                allowNotApplicableSnapshot: criterion.allowNotApplicable,
              })),
            },
          },
          select: { id: true, referenceCode: true },
        });
        await writeAudit(tx, {
          evaluationId: row.id,
          action: "CREATED",
          actorUserId: input.actorUserId,
          details: { referenceCode: row.referenceCode, evaluationType: input.evaluationType },
        });
        return row.id;
      });
      logEmployeeHrAudit({
        event: "employee.evaluation.create",
        actorUserId: input.actorUserId,
        employeeId: input.employeeId,
        details: { evaluationId: createdId, evaluationType: input.evaluationType },
      });
      return getEmployeeEvaluation(prisma, input.employeeId, createdId);
    } catch (error) {
      if (error instanceof HrEvaluationError) throw error;
      if (isUniqueConflict(error) && uniqueTarget(error).includes("referenceCode") && attempt < 4) {
        continue;
      }
      if (isUniqueConflict(error)) {
        throw new HrEvaluationError(
          "DUPLICATE_CYCLE",
          "Já existe uma avaliação deste tipo para o mesmo ciclo de admissão. Confirme explicitamente para registrar outra.",
          409
        );
      }
      throw error;
    }
  }
  throw new HrEvaluationError("DUPLICATE", "Não foi possível gerar o código da avaliação.", 409);
}

export async function ensureExperienceEvaluations(
  prisma: PrismaClient,
  input: { employeeId: string; actorUserId?: string | null }
) {
  const employee = await loadEmployee(prisma, input.employeeId);
  const created: string[] = [];
  if (shouldAutoScheduleExperience(employee.status) && employee.admissionDate) {
    for (const evaluationType of HR_EVALUATION_TYPES) {
      try {
        const row = await createEmployeeEvaluation(prisma, {
          employeeId: input.employeeId,
          evaluationType,
          actorUserId: input.actorUserId,
        });
        created.push(row.id);
      } catch (error) {
        if (error instanceof HrEvaluationError && error.code === "DUPLICATE_CYCLE") continue;
        throw error;
      }
    }
  }
  const list = await listEmployeeEvaluations(prisma, input.employeeId);
  return { ...list, createdIds: created };
}

async function applyUpdate(
  tx: Prisma.TransactionClient,
  row: EvaluationRow,
  input: HrEvaluationUpdateInput,
  actorUserId: string | null,
  options: { allowCompletedEdit: boolean }
) {
  assertPatchableStatus(row.status);
  if (row.status === "COMPLETED" && !options.allowCompletedEdit) {
    throw new HrEvaluationError(
      "COMPLETED_LOCKED",
      "Avaliação concluída só pode ser alterada com permissão de conclusão.",
      403
    );
  }
  const data: Prisma.HrEmployeeEvaluationUncheckedUpdateInput = {
    updatedByUserId: actorUserId,
  };
  if ("dueDate" in input) {
    const due = parseIsoDate(input.dueDate, "Data prevista");
    data.dueDate = due ? isoDateToStoredDate(due) : null;
  }
  if ("periodStart" in input) {
    const value = parseIsoDate(input.periodStart, "Início do período");
    data.periodStart = value ? isoDateToStoredDate(value) : null;
  }
  if ("periodEnd" in input) {
    const value = parseIsoDate(input.periodEnd, "Fim do período");
    data.periodEnd = value ? isoDateToStoredDate(value) : null;
  }
  if ("evaluationDate" in input) {
    const value = parseIsoDate(input.evaluationDate, "Data da avaliação");
    data.evaluationDate = value ? isoDateToStoredDate(value) : null;
  }
  if ("evaluatorName" in input) data.evaluatorNameSnapshot = clip(input.evaluatorName, 160, "Avaliador");
  if ("evaluatorRole" in input) data.evaluatorRoleSnapshot = clip(input.evaluatorRole, 160, "Cargo do avaliador");
  if ("evaluatorEmployeeId" in input) {
    if (input.evaluatorEmployeeId) {
      const leader = await tx.employee.findUnique({
        where: { id: input.evaluatorEmployeeId },
        select: { id: true, name: true, Role: { select: { name: true } } },
      });
      if (!leader) throw new HrEvaluationError("NOT_FOUND", "Avaliador não encontrado.", 404);
      data.evaluatorEmployeeId = leader.id;
      if (!("evaluatorName" in input)) data.evaluatorNameSnapshot = leader.name;
      if (!("evaluatorRole" in input)) data.evaluatorRoleSnapshot = leader.Role?.name ?? null;
    } else {
      data.evaluatorEmployeeId = null;
    }
  }
  if ("recommendation" in input) {
    const code = clip(input.recommendation, 80, "Recomendação");
    if (code && !isValidRecommendation(row.evaluationType, code)) {
      throw new HrEvaluationError("INVALID_RECOMMENDATION", "Recomendação inválida para este tipo.");
    }
    data.recommendation = code;
  }
  if ("recommendationNotes" in input) {
    data.recommendationNotes = clip(input.recommendationNotes, 4000, "Justificativa");
  }
  if ("strengths" in input) data.strengths = clip(input.strengths, 4000, "Pontos fortes");
  if ("developmentPoints" in input) {
    data.developmentPoints = clip(input.developmentPoints, 4000, "Pontos a desenvolver");
  }
  if ("actionGuidance" in input) {
    data.actionGuidance = clip(input.actionGuidance, 4000, "Orientações");
  }
  if ("employeeAcknowledged" in input) data.employeeAcknowledged = input.employeeAcknowledged === true;
  if ("employeeAcknowledgedAt" in input) {
    const value = parseIsoDate(input.employeeAcknowledgedAt, "Data da ciência");
    data.employeeAcknowledgedAt = value ? isoDateToStoredDate(value) : null;
  }
  if ("employeeAcknowledgementNotes" in input) {
    data.employeeAcknowledgementNotes = clip(input.employeeAcknowledgementNotes, 2000, "Observações da ciência");
  }
  if (input.status) {
    if (row.status === "COMPLETED") {
      throw new HrEvaluationError("INVALID_STATUS", "A situação de uma avaliação concluída não muda por esta ação.");
    }
    if (!(HR_EVALUATION_STATUSES as readonly string[]).includes(input.status) || input.status === "COMPLETED" || input.status === "CANCELLED") {
      throw new HrEvaluationError("INVALID_STATUS", "Situação inválida.");
    }
    data.status = input.status;
  }

  let transcribed = false;
  if (input.answers) {
    const byId = new Map(row.answers.map((answer) => [answer.id, answer]));
    for (const answer of input.answers) {
      const current = byId.get(answer.id);
      if (!current) throw new HrEvaluationError("INVALID_ANSWER", "Resposta não pertence a esta avaliação.");
      const normalized = normalizeAnswerScore({
        score: answer.score,
        notApplicable: answer.notApplicable === true,
        allowNotApplicable: current.allowNotApplicableSnapshot,
      });
      await tx.hrEmployeeEvaluationAnswer.update({
        where: { id: current.id },
        data: {
          score: normalized.score,
          notApplicable: normalized.notApplicable,
          comment: clip(answer.comment, 2000, "Comentário"),
        },
      });
    }
    const fresh = await tx.hrEmployeeEvaluationAnswer.findMany({
      where: { evaluationId: row.id },
      select: { score: true, notApplicable: true },
    });
    const average = calculateEvaluationAverage(fresh);
    data.generalScore =
      average.average == null ? null : new Prisma.Decimal(average.average.toFixed(2));
    data.status = statusAfterTranscription(typeof data.status === "string" ? data.status : row.status);
    if (!row.transcriptionUserId) {
      data.transcriptionUserId = actorUserId;
      data.transcriptionAt = new Date();
    }
    transcribed = true;
  }

  await tx.hrEmployeeEvaluation.update({ where: { id: row.id }, data });
  await writeAudit(tx, {
    evaluationId: row.id,
    action: row.status === "COMPLETED" ? "AMENDED" : transcribed ? "TRANSCRIBED" : "UPDATED",
    actorUserId,
    details: {
      fields: Object.keys(input).filter((key) => key !== "answers"),
      answerCount: input.answers?.length ?? 0,
    },
  });
}

export async function updateEmployeeEvaluation(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    evaluationId: string;
    patch: HrEvaluationUpdateInput;
    actorUserId?: string | null;
    allowCompletedEdit: boolean;
  }
) {
  await prisma.$transaction(async (tx) => {
    const row = await loadRow(tx, input.employeeId, input.evaluationId);
    await applyUpdate(tx, row, input.patch, input.actorUserId ?? null, {
      allowCompletedEdit: input.allowCompletedEdit,
    });
  });
  logEmployeeHrAudit({
    event: "employee.evaluation.update",
    actorUserId: input.actorUserId,
    employeeId: input.employeeId,
    details: { evaluationId: input.evaluationId },
  });
  return getEmployeeEvaluation(prisma, input.employeeId, input.evaluationId);
}

export async function completeEmployeeEvaluation(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    evaluationId: string;
    patch?: HrEvaluationUpdateInput;
    actorUserId?: string | null;
  }
) {
  await prisma.$transaction(async (tx) => {
    const row = await loadRow(tx, input.employeeId, input.evaluationId);
    if (row.status === "CANCELLED") {
      throw new HrEvaluationError("CANCELLED", "Avaliação cancelada não pode ser concluída.", 409);
    }
    if (input.patch) {
      await applyUpdate(tx, row, input.patch, input.actorUserId ?? null, { allowCompletedEdit: true });
    }
    const current = await loadRow(tx, input.employeeId, input.evaluationId);
    const errors = validateEvaluationCompletion({
      evaluationDate: storedDateToIso(current.evaluationDate),
      evaluatorName: current.evaluatorNameSnapshot,
      recommendation: current.recommendation,
      evaluationType: current.evaluationType,
      answers: current.answers.map((answer) => ({
        score: answer.score,
        notApplicable: answer.notApplicable,
        criterionName: answer.criterionNameSnapshot,
      })),
    });
    if (errors.length > 0) {
      throw new HrEvaluationError("INCOMPLETE", errors[0], 400);
    }
    const average = calculateEvaluationAverage(
      current.answers.map((answer) => ({ score: answer.score, notApplicable: answer.notApplicable }))
    );
    const alreadyCompleted = current.status === "COMPLETED";
    await tx.hrEmployeeEvaluation.update({
      where: { id: current.id },
      data: {
        status: "COMPLETED",
        completedAt: alreadyCompleted ? current.completedAt : new Date(),
        generalScore: average.average == null ? null : new Prisma.Decimal(average.average.toFixed(2)),
        hrValidatedBy: input.actorUserId ?? null,
        hrValidatedAt: new Date(),
        updatedByUserId: input.actorUserId ?? null,
        transcriptionUserId: current.transcriptionUserId ?? input.actorUserId ?? null,
        transcriptionAt: current.transcriptionAt ?? new Date(),
      },
    });
    await writeAudit(tx, {
      evaluationId: current.id,
      action: "COMPLETED",
      actorUserId: input.actorUserId,
      details: { generalScore: average.average, amended: alreadyCompleted },
    });
    if (!alreadyCompleted) {
      await writeHistoryEvent(tx, {
        employeeId: input.employeeId,
        eventType: "EXPERIENCE_EVALUATION",
        effectiveDate: current.evaluationDate ?? new Date(),
        source: "USER",
        notes: historyNoteForCompletedEvaluation({
          evaluationType: current.evaluationType,
          average: average.average,
        }),
        createdByUserId: input.actorUserId,
      });
    }
  });
  logEmployeeHrAudit({
    event: "employee.evaluation.complete",
    actorUserId: input.actorUserId,
    employeeId: input.employeeId,
    details: { evaluationId: input.evaluationId },
  });
  return getEmployeeEvaluation(prisma, input.employeeId, input.evaluationId);
}

export async function cancelEmployeeEvaluation(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    evaluationId: string;
    reason?: string | null;
    actorUserId?: string | null;
    allowCompletedEdit: boolean;
  }
) {
  await prisma.$transaction(async (tx) => {
    const row = await loadRow(tx, input.employeeId, input.evaluationId);
    if (row.status === "CANCELLED") return;
    if (row.status === "COMPLETED" && !input.allowCompletedEdit) {
      throw new HrEvaluationError(
        "COMPLETED_LOCKED",
        "Avaliação concluída só pode ser cancelada com permissão de conclusão.",
        403
      );
    }
    await tx.hrEmployeeEvaluation.update({
      where: { id: row.id },
      data: { status: "CANCELLED", updatedByUserId: input.actorUserId ?? null },
    });
    await writeAudit(tx, {
      evaluationId: row.id,
      action: "CANCELLED",
      actorUserId: input.actorUserId,
      details: { reason: clip(input.reason, 500, "Motivo") },
    });
  });
  logEmployeeHrAudit({
    event: "employee.evaluation.cancel",
    actorUserId: input.actorUserId,
    employeeId: input.employeeId,
    details: { evaluationId: input.evaluationId },
  });
  return getEmployeeEvaluation(prisma, input.employeeId, input.evaluationId);
}

export async function recordEvaluationPrint(
  prisma: PrismaClient,
  input: { employeeId: string; evaluationId: string; actorUserId?: string | null }
) {
  await prisma.$transaction(async (tx) => {
    const row = await loadRow(tx, input.employeeId, input.evaluationId);
    await tx.hrEmployeeEvaluation.update({
      where: { id: row.id },
      data: {
        status: statusAfterPrint(row.status),
        printedAt: new Date(),
        printedByUserId: input.actorUserId ?? null,
        updatedByUserId: input.actorUserId ?? null,
      },
    });
    await writeAudit(tx, {
      evaluationId: row.id,
      action: "PRINTED",
      actorUserId: input.actorUserId,
      details: { referenceCode: row.referenceCode },
    });
  });
  logEmployeeHrAudit({
    event: "employee.evaluation.print",
    actorUserId: input.actorUserId,
    employeeId: input.employeeId,
    details: { evaluationId: input.evaluationId },
  });
  return getEmployeeEvaluation(prisma, input.employeeId, input.evaluationId);
}

export async function addEvaluationActionPlan(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    evaluationId: string;
    title: string;
    description?: string | null;
    responsibleEmployeeId?: string | null;
    responsibleName?: string | null;
    dueDate?: string | null;
    notes?: string | null;
    actorUserId?: string | null;
    allowCompletedEdit: boolean;
  }
) {
  const title = clip(input.title, 200, "Ação");
  if (!title) throw new HrEvaluationError("INVALID_FIELD", "Informe a ação de acompanhamento.");
  const id = await prisma.$transaction(async (tx) => {
    const row = await loadRow(tx, input.employeeId, input.evaluationId);
    assertPatchableStatus(row.status);
    if (row.status === "COMPLETED" && !input.allowCompletedEdit) {
      throw new HrEvaluationError("COMPLETED_LOCKED", "Avaliação concluída só pode ser alterada com permissão de conclusão.", 403);
    }
    let responsibleName = clip(input.responsibleName, 160, "Responsável");
    if (input.responsibleEmployeeId) {
      const person = await tx.employee.findUnique({
        where: { id: input.responsibleEmployeeId },
        select: { id: true, name: true },
      });
      if (!person) throw new HrEvaluationError("NOT_FOUND", "Responsável não encontrado.", 404);
      responsibleName = responsibleName ?? person.name;
    }
    const due = parseIsoDate(input.dueDate, "Prazo");
    const plan = await tx.hrEvaluationActionPlan.create({
      data: {
        evaluationId: row.id,
        title,
        description: clip(input.description, 2000, "Descrição"),
        responsibleEmployeeId: input.responsibleEmployeeId ?? null,
        responsibleNameSnapshot: responsibleName,
        dueDate: due ? isoDateToStoredDate(due) : null,
        status: "PENDING",
        notes: clip(input.notes, 2000, "Observação"),
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      evaluationId: row.id,
      action: "ACTION_PLAN",
      actorUserId: input.actorUserId,
      details: { planId: plan.id, title },
    });
    return plan.id;
  });
  return { id };
}

export async function updateEvaluationActionPlan(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    evaluationId: string;
    planId: string;
    title?: string | null;
    description?: string | null;
    responsibleName?: string | null;
    dueDate?: string | null;
    status?: string | null;
    notes?: string | null;
    actorUserId?: string | null;
    allowCompletedEdit: boolean;
  }
) {
  await prisma.$transaction(async (tx) => {
    const row = await loadRow(tx, input.employeeId, input.evaluationId);
    assertPatchableStatus(row.status);
    if (row.status === "COMPLETED" && !input.allowCompletedEdit) {
      throw new HrEvaluationError("COMPLETED_LOCKED", "Avaliação concluída só pode ser alterada com permissão de conclusão.", 403);
    }
    const plan = row.actionPlans.find((item) => item.id === input.planId);
    if (!plan) throw new HrEvaluationError("NOT_FOUND", "Ação não encontrada.", 404);
    if (input.status && !(HR_EVALUATION_ACTION_STATUSES as readonly string[]).includes(input.status)) {
      throw new HrEvaluationError("INVALID_STATUS", "Situação da ação inválida.");
    }
    const due = "dueDate" in input ? parseIsoDate(input.dueDate, "Prazo") : undefined;
    await tx.hrEvaluationActionPlan.update({
      where: { id: plan.id },
      data: {
        title: input.title != null ? clip(input.title, 200, "Ação") ?? plan.title : undefined,
        description: "description" in input ? clip(input.description, 2000, "Descrição") : undefined,
        responsibleNameSnapshot:
          "responsibleName" in input ? clip(input.responsibleName, 160, "Responsável") : undefined,
        dueDate: due === undefined ? undefined : due ? isoDateToStoredDate(due) : null,
        status: input.status ?? undefined,
        notes: "notes" in input ? clip(input.notes, 2000, "Notas") : undefined,
        completedAt: input.status === "COMPLETED" ? new Date() : input.status ? null : undefined,
      },
    });
    await writeAudit(tx, {
      evaluationId: row.id,
      action: "ACTION_PLAN",
      actorUserId: input.actorUserId,
      details: { planId: plan.id, status: input.status ?? plan.status },
    });
  });
  return getEmployeeEvaluation(prisma, input.employeeId, input.evaluationId);
}

export async function attachEvaluationDocument(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    evaluationId: string;
    originalFileName: string;
    mimeType: string | null;
    buffer: Buffer;
    actorUserId?: string | null;
    allowCompletedEdit: boolean;
  }
) {
  if (!isAllowedEvaluationAttachment(input.mimeType, input.originalFileName)) {
    throw new HrEvaluationError("INVALID_FILE", "Anexe um PDF, JPG ou PNG.");
  }
  const row = await loadRow(prisma, input.employeeId, input.evaluationId);
  assertPatchableStatus(row.status);
  if (row.status === "COMPLETED" && !input.allowCompletedEdit) {
    throw new HrEvaluationError("COMPLETED_LOCKED", "Avaliação concluída só pode ser alterada com permissão de conclusão.", 403);
  }
  const employee = await loadEmployee(prisma, input.employeeId);
  const saved = await saveEmployeeDocument({
    prisma,
    employeeId: input.employeeId,
    personId: employee.personId,
    documentType: "EXPERIENCE_EVALUATION",
    displayName: `${evaluationTypeShortLabel(row.evaluationType)} — ${row.referenceCode}`,
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    buffer: input.buffer,
    notes: `Formulário digitalizado da avaliação ${row.referenceCode}`,
    actorUserId: input.actorUserId,
    evaluationId: row.id,
  });
  await prisma.hrEvaluationAuditEvent.create({
    data: {
      evaluationId: row.id,
      action: "ATTACHMENT_ADDED",
      actorUserId: input.actorUserId ?? null,
      details: { documentId: saved.id, fileName: input.originalFileName },
    },
  });
  logEmployeeHrAudit({
    event: "employee.evaluation.attachment",
    actorUserId: input.actorUserId,
    employeeId: input.employeeId,
    details: { evaluationId: row.id, documentId: saved.id },
  });
  return getEmployeeEvaluation(prisma, input.employeeId, input.evaluationId);
}

export async function loadOperationalEvaluationSummary(prisma: PrismaClient) {
  await ensureEvaluationTemplates(prisma);
  const todayIso = isoDateInSaoPaulo(new Date());
  const today = isoDateToStoredDate(todayIso);
  const open = { status: { notIn: ["COMPLETED", "CANCELLED"] } };
  const [grouped, overdue, waitingReturn, upcoming] = await Promise.all([
    prisma.hrEmployeeEvaluation.groupBy({
      by: ["evaluationType"],
      where: open,
      _count: { _all: true },
    }),
    prisma.hrEmployeeEvaluation.count({ where: { ...open, dueDate: { lt: today } } }),
    prisma.hrEmployeeEvaluation.count({
      where: { status: { in: ["PRINTED", "WAITING_RETURN"] } },
    }),
    prisma.hrEmployeeEvaluation.findMany({
      where: open,
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: 8,
      select: {
        id: true,
        employeeId: true,
        evaluationType: true,
        status: true,
        dueDate: true,
        employee: { select: { name: true } },
      },
    }),
  ]);
  const countOf = (type: string) =>
    grouped.find((row) => row.evaluationType === type)?._count._all ?? 0;
  return {
    experience45Pending: countOf("EXPERIENCE_45_DAYS"),
    experienceFinalPending: countOf("EXPERIENCE_FINAL"),
    waitingReturn,
    overdue,
    items: upcoming.map((row) => {
      const dueDate = storedDateToIso(row.dueDate);
      const alert = evaluationAlert({
        id: row.id,
        evaluationType: row.evaluationType,
        status: row.status,
        dueDate,
        todayIso,
      });
      return {
        id: row.id,
        employeeId: row.employeeId,
        employeeName: row.employee.name,
        evaluationType: row.evaluationType,
        shortLabel: evaluationTypeShortLabel(row.evaluationType),
        status: row.status,
        statusLabel: evaluationStatusLabel(row.status),
        dueDate,
        message: alert?.message ?? evaluationStatusLabel(row.status),
      };
    }),
  };
}
