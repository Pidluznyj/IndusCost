/**
 * Ciclo de vida do colaborador — leitura no banco (situação, afastamentos e desligamento).
 * Regras puras em `employeeLifecycle.ts`.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  computeEmployeeSituation,
  describeTermination,
  isNoticeType,
  isTerminationReason,
  terminationGuards,
  toIsoDay,
  type EmployeeLifecycleDto,
  type EmployeeSituation,
  type EmployeeTerminationDto,
  type LeaveFacts,
  type TerminationGuard,
  type TerminationReason,
} from "./employeeLifecycle.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type { EmployeeLifecycleDto, EmployeeTerminationDto };

export type LifecycleEmployeeRow = {
  id: string;
  status: string | null;
  admissionDate: Date | null;
  terminationDate: Date | null;
  terminationReason?: string | null;
  terminationNoticeType?: string | null;
  terminationNoticeDate?: Date | null;
  terminationDetails?: string | null;
};

type AbsenceRow = {
  id: string;
  employeeId: string;
  type: string;
  startDate: Date;
  endDate: Date | null;
  expectedReturn: Date | null;
  actualReturn: Date | null;
  status: string;
  extendedLicense?: boolean | null;
  reason?: string | null;
  inssBenefitNumber?: string | null;
  catNumber?: string | null;
};

export const LIFECYCLE_EMPLOYEE_SELECT = {
  id: true,
  status: true,
  admissionDate: true,
  terminationDate: true,
  terminationReason: true,
  terminationNoticeType: true,
  terminationNoticeDate: true,
  terminationDetails: true,
} as const;

export function toLeaveFacts(row: AbsenceRow): LeaveFacts & { id: string } {
  return {
    id: row.id,
    type: row.type,
    startDate: toIsoDay(row.startDate)!,
    endDate: toIsoDay(row.endDate),
    expectedReturn: toIsoDay(row.expectedReturn),
    actualReturn: toIsoDay(row.actualReturn),
    status: row.status,
    extendedLicense: row.extendedLicense ?? false,
    reason: row.reason ?? null,
    inssBenefitNumber: row.inssBenefitNumber ?? null,
    catNumber: row.catNumber ?? null,
  };
}

async function loadAbsences(db: Db, employeeIds: string[]): Promise<AbsenceRow[]> {
  if (employeeIds.length === 0) return [];
  return (await db.hrAbsence.findMany({
    where: { employeeId: { in: employeeIds }, status: { not: "CANCELLED" } },
    select: {
      id: true,
      employeeId: true,
      type: true,
      startDate: true,
      endDate: true,
      expectedReturn: true,
      actualReturn: true,
      status: true,
      extendedLicense: true,
      reason: true,
      inssBenefitNumber: true,
      catNumber: true,
    },
  })) as AbsenceRow[];
}

export function terminationDto(row: LifecycleEmployeeRow): EmployeeTerminationDto | null {
  const terminationDate = toIsoDay(row.terminationDate);
  if ((row.status ?? "ACTIVE").toUpperCase() !== "INACTIVE" || !terminationDate) return null;
  if (!isTerminationReason(row.terminationReason) || !isNoticeType(row.terminationNoticeType)) return null;
  const noticeDate = toIsoDay(row.terminationNoticeDate ?? null);
  return {
    ...describeTermination(
      {
        reason: row.terminationReason,
        noticeType: row.terminationNoticeType,
        noticeDate,
        details: row.terminationDetails ?? null,
        terminationDate,
      },
      toIsoDay(row.admissionDate),
    ),
    terminationDate,
    noticeDate,
    details: row.terminationDetails ?? null,
  };
}

/** Situação + desligamento de um colaborador (ficha / cadastro). */
export async function loadEmployeeLifecycle(db: Db, row: LifecycleEmployeeRow, todayIso: string): Promise<EmployeeLifecycleDto> {
  const absences = (await loadAbsences(db, [row.id])).map(toLeaveFacts);
  return {
    situation: computeEmployeeSituation({
      status: row.status,
      terminationDate: toIsoDay(row.terminationDate),
      absences,
      todayIso,
    }),
    termination: terminationDto(row),
  };
}

/** Situação resumida por colaborador para listagens (uma consulta de afastamentos). */
export async function loadEmployeeSituations(
  db: Db,
  rows: { id: string; status: string | null; terminationDate: Date | null }[],
  todayIso: string,
): Promise<Map<string, { code: EmployeeSituation["code"]; label: string; since: string | null }>> {
  const absences = await loadAbsences(
    db,
    rows.filter((r) => (r.status ?? "ACTIVE").toUpperCase() !== "INACTIVE").map((r) => r.id),
  );
  const byEmployee = new Map<string, (LeaveFacts & { id: string })[]>();
  for (const a of absences) {
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push(toLeaveFacts(a));
    byEmployee.set(a.employeeId, list);
  }
  const out = new Map<string, { code: EmployeeSituation["code"]; label: string; since: string | null }>();
  for (const r of rows) {
    const s = computeEmployeeSituation({
      status: r.status,
      terminationDate: toIsoDay(r.terminationDate),
      absences: byEmployee.get(r.id) ?? [],
      todayIso,
    });
    out.set(r.id, { code: s.code, label: s.label, since: s.since });
  }
  return out;
}

/** Bloqueios e avisos legais do desligamento (afastamento em andamento, estabilidades). */
export async function loadTerminationGuards(
  db: Db,
  employeeId: string,
  reason: TerminationReason,
  terminationDate: string,
): Promise<TerminationGuard> {
  const absences = (await loadAbsences(db, [employeeId])).map(toLeaveFacts);
  return terminationGuards({ reason, terminationDate, leaves: absences });
}

/**
 * Dados sensíveis do ciclo de vida:
 * - descrição do desligamento (ex.: fatos da justa causa) só para quem vê dados administrativos/restritos;
 * - justificativa/nº INSS/CAT do afastamento (pode conter informação médica) só para quem vê afastamentos.
 */
export function redactLifecycle(
  lifecycle: EmployeeLifecycleDto,
  reveal: { terminationDetails: boolean; leaveRecord: boolean },
): EmployeeLifecycleDto {
  let out = lifecycle;
  if (!reveal.terminationDetails && out.termination?.details) {
    out = { ...out, termination: { ...out.termination, details: null } };
  }
  if (!reveal.leaveRecord && out.situation.leave?.record) {
    out = { ...out, situation: { ...out.situation, leave: { ...out.situation.leave, record: null } } };
  }
  return out;
}
