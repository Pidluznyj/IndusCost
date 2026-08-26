/**
 * EPI / Preferências de uniforme, Referência administrativa e Observações.
 * EPI = preferência de tamanho (NÃO estoque/entrega).
 * Admin = salário/jornada/verbas de referência (PayrollComponent oficial).
 * Sem dados bancários no modelo Employee.
 */

import type { PrismaClient } from "@prisma/client";
import { EmployeeRegistrationError, isEmployeeUuid } from "@/src/lib/employeeRegistration.js";
import {
  EPI_GLOVE_SIZE_OPTIONS,
  EPI_PANTS_SIZE_OPTIONS,
  EPI_SHOE_SIZE_OPTIONS,
  EPI_TOP_SIZE_OPTIONS,
} from "@/src/lib/employeeHrUi.js";

export const MAX_EPI_NOTES_LEN = 2000;
export const MAX_PROFESSIONAL_NOTES_LEN = 4000;
export const MAX_ADMIN_NOTES_LEN = 4000;

const TOP = new Set<string>(EPI_TOP_SIZE_OPTIONS);
const PANTS = new Set<string>(EPI_PANTS_SIZE_OPTIONS);
const GLOVE = new Set<string>(EPI_GLOVE_SIZE_OPTIONS);
const SHOE = new Set<string>(EPI_SHOE_SIZE_OPTIONS);

function trimOrNull(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  let t = value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  if (!t) return null;
  if (t.length > maxLen) t = t.slice(0, maxLen);
  return t;
}

export function normalizeEpiSize(
  value: unknown,
  allowed: Set<string>,
  fieldLabel: string,
  opts?: { previous?: string | null; allowLegacy?: boolean }
): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (allowed.has(raw)) return raw;
  const prev = (opts?.previous ?? "").trim();
  if (opts?.allowLegacy && prev && raw === prev) return raw;
  throw new EmployeeRegistrationError(
    "INVALID_EPI_SIZE",
    `${fieldLabel}: selecione um tamanho da lista oficial (preferência, não estoque).`
  );
}

export type EmployeeEpiFields = {
  shirtSize: string | null;
  pantsSize: string | null;
  jacketSize: string | null;
  gloveSize: string | null;
  shoeSize: string | null;
  epiNotes: string | null;
};

export type EmployeeNotesFields = {
  professionalNotes: string | null;
  adminNotes: string | null;
};

export type EmployeeAdminReferenceFields = {
  salary: number;
  monthlyHours: number;
  productivity: number;
};

export type EmployeeEpiPrevious = Partial<EmployeeEpiFields>;

export function prepareEmployeeEpiFields(
  body: Record<string, unknown>,
  opts?: { previous?: EmployeeEpiPrevious | null; allowLegacy?: boolean }
): EmployeeEpiFields {
  const allowLegacy = opts?.allowLegacy === true;
  const prev = opts?.previous ?? null;
  return {
    shirtSize: normalizeEpiSize(body.shirtSize, TOP, "Camiseta / camisa", {
      previous: prev?.shirtSize,
      allowLegacy,
    }),
    pantsSize: normalizeEpiSize(body.pantsSize, PANTS, "Calça", {
      previous: prev?.pantsSize,
      allowLegacy,
    }),
    jacketSize: normalizeEpiSize(body.jacketSize, TOP, "Jaqueta / blusa", {
      previous: prev?.jacketSize,
      allowLegacy,
    }),
    gloveSize: normalizeEpiSize(body.gloveSize, GLOVE, "Luva", {
      previous: prev?.gloveSize,
      allowLegacy,
    }),
    shoeSize: normalizeEpiSize(body.shoeSize, SHOE, "Calçado / bota", {
      previous: prev?.shoeSize,
      allowLegacy,
    }),
    epiNotes: trimOrNull(body.epiNotes, MAX_EPI_NOTES_LEN),
  };
}

export function prepareEmployeeNotesFields(body: Record<string, unknown>): EmployeeNotesFields {
  return {
    professionalNotes: trimOrNull(body.professionalNotes, MAX_PROFESSIONAL_NOTES_LEN),
    adminNotes: trimOrNull(body.adminNotes, MAX_ADMIN_NOTES_LEN),
  };
}

export function prepareEmployeeAdminReferenceFields(body: {
  salary?: unknown;
  monthlyHours?: unknown;
  productivity?: unknown;
}): EmployeeAdminReferenceFields {
  const salary = Number(body.salary);
  const monthlyHours = Number(body.monthlyHours);
  const productivity = Number(body.productivity);

  if (!Number.isFinite(salary) || salary < 0) {
    throw new EmployeeRegistrationError(
      "INVALID_SALARY",
      "Referência salarial inválida (use valor ≥ 0)."
    );
  }
  if (!Number.isFinite(monthlyHours) || monthlyHours <= 0 || monthlyHours > 744) {
    throw new EmployeeRegistrationError(
      "INVALID_MONTHLY_HOURS",
      "Jornada mensal inválida (1 a 744 horas)."
    );
  }
  if (!Number.isFinite(productivity) || productivity < 0 || productivity > 200) {
    throw new EmployeeRegistrationError(
      "INVALID_PRODUCTIVITY",
      "Produtividade inválida (0 a 200%)."
    );
  }

  return {
    salary,
    monthlyHours: Math.round(monthlyHours),
    productivity,
  };
}

export async function assertPayrollComponentIds(
  prisma: PrismaClient,
  ids: string[]
): Promise<string[]> {
  const unique = [...new Set(ids.filter((id) => isEmployeeUuid(id)))];
  if (unique.length === 0) return [];
  const found = await prisma.payrollComponent.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw new EmployeeRegistrationError(
      "INVALID_PAYROLL_COMPONENT",
      "Uma ou mais verbas/benefícios são inválidos. Use o cadastro oficial de verbas."
    );
  }
  return unique;
}

export function auditEpiAdminNotesSummary(input: {
  epi: EmployeeEpiFields;
  notes: EmployeeNotesFields;
  admin: EmployeeAdminReferenceFields;
  payrollComponentCount: number;
}): {
  hasEpiSize: boolean;
  hasEpiNotes: boolean;
  hasProfessionalNotes: boolean;
  hasAdminNotes: boolean;
  epiNotesLength: number;
  professionalNotesLength: number;
  adminNotesLength: number;
  monthlyHours: number;
  productivity: number;
  /** Nunca expor valor salarial completo em log. */
  hasSalaryReference: boolean;
  payrollComponentCount: number;
} {
  return {
    hasEpiSize: Boolean(
      input.epi.shirtSize ||
        input.epi.pantsSize ||
        input.epi.jacketSize ||
        input.epi.gloveSize ||
        input.epi.shoeSize
    ),
    hasEpiNotes: Boolean(input.epi.epiNotes),
    hasProfessionalNotes: Boolean(input.notes.professionalNotes),
    hasAdminNotes: Boolean(input.notes.adminNotes),
    epiNotesLength: input.epi.epiNotes?.length ?? 0,
    professionalNotesLength: input.notes.professionalNotes?.length ?? 0,
    adminNotesLength: input.notes.adminNotes?.length ?? 0,
    monthlyHours: input.admin.monthlyHours,
    productivity: input.admin.productivity,
    hasSalaryReference: input.admin.salary > 0,
    payrollComponentCount: input.payrollComponentCount,
  };
}

/**
 * Redige referência administrativa (salário, custos, verbas, notas admin).
 * EPI (tamanhos) permanece — não é dado financeiro.
 */
export function redactEmployeeAdminForApi<T extends Record<string, unknown>>(
  employee: T,
  opts: {
    reveal?: boolean;
    revealCompensation?: boolean;
    revealAdminNotes?: boolean;
  }
): T & {
  compensationRedacted: boolean;
  adminNotesRedacted: boolean;
  hasAdminNotes: boolean;
  hasCompensation: boolean;
} {
  const hasAdminNotes = Boolean(employee.adminNotes);
  const salaryNum = Number(employee.salary);
  const hasCompensation =
    (Number.isFinite(salaryNum) && salaryNum > 0) ||
    Boolean(employee.costs) ||
    (Array.isArray(employee.EmployeePayrollComponent) &&
      employee.EmployeePayrollComponent.length > 0);

  const revealCompensation = opts.reveal === true || opts.revealCompensation === true;
  const revealAdminNotes = opts.reveal === true || opts.revealAdminNotes === true;

  if (revealCompensation && revealAdminNotes) {
    return {
      ...employee,
      compensationRedacted: false,
      adminNotesRedacted: false,
      hasAdminNotes,
      hasCompensation,
    };
  }

  const next: Record<string, unknown> = { ...employee };
  if (!revealCompensation) {
    delete next.salary;
    delete next.productivity;
    delete next.costs;
    delete next.EmployeePayrollComponent;
  }
  if (!revealAdminNotes) {
    next.adminNotes = null;
  }

  return {
    ...(next as T),
    compensationRedacted: !revealCompensation,
    adminNotesRedacted: !revealAdminNotes,
    hasAdminNotes,
    hasCompensation,
  };
}

/** Validação FE espelhada (EPI + notas + admin numérico). */
export function validateEmployeeEpiAdminNotesForm(
  input: {
    shirtSize?: string | null;
    pantsSize?: string | null;
    jacketSize?: string | null;
    gloveSize?: string | null;
    shoeSize?: string | null;
    epiNotes?: string | null;
    professionalNotes?: string | null;
    adminNotes?: string | null;
    salary?: unknown;
    monthlyHours?: unknown;
    productivity?: unknown;
  },
  opts?: { previousEpi?: EmployeeEpiPrevious | null; allowLegacyEpi?: boolean }
): string | null {
  try {
    prepareEmployeeEpiFields(
      {
        shirtSize: input.shirtSize ?? "",
        pantsSize: input.pantsSize ?? "",
        jacketSize: input.jacketSize ?? "",
        gloveSize: input.gloveSize ?? "",
        shoeSize: input.shoeSize ?? "",
        epiNotes: input.epiNotes ?? "",
      },
      { previous: opts?.previousEpi, allowLegacy: opts?.allowLegacyEpi === true }
    );
    prepareEmployeeNotesFields({
      professionalNotes: input.professionalNotes ?? "",
      adminNotes: input.adminNotes ?? "",
    });
    prepareEmployeeAdminReferenceFields({
      salary: input.salary,
      monthlyHours: input.monthlyHours,
      productivity: input.productivity,
    });
    return null;
  } catch (err) {
    if (err instanceof EmployeeRegistrationError) return err.message;
    return "Dados administrativos ou de EPI inválidos.";
  }
}
