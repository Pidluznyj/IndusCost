/**
 * Cadastro de colaborador (Pessoas / RH) — validação e normalização servidor.
 * Sem motor paralelo: reutiliza Role, FinancialCostCenter e vínculo AppUser↔Employee.
 */

import type { PrismaClient } from "@prisma/client";

export const EMPLOYEE_CLASSIFICATIONS = ["DIRETO", "INDIRETO", "APOIO"] as const;
export type EmployeeClassification = (typeof EMPLOYEE_CLASSIFICATIONS)[number];

export const EMPLOYEE_CONTRACT_TYPES = [
  "CLT",
  "PJ",
  "ESTAGIO",
  "TEMPORARIO",
  "APRENDIZ",
  "OUTRO",
] as const;
export type EmployeeContractType = (typeof EMPLOYEE_CONTRACT_TYPES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EmployeeRegistrationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "EmployeeRegistrationError";
    this.code = code;
    this.status = status;
  }
}

export function isEmployeeUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** Trim + lowercase; vazio → null. */
export function normalizeCorporateEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function assertCorporateEmailFormat(email: string | null): void {
  if (email == null) return;
  if (!EMAIL_RE.test(email)) {
    throw new EmployeeRegistrationError(
      "INVALID_CORPORATE_EMAIL",
      "Informe um e-mail corporativo válido."
    );
  }
}

export function normalizeOptionalDateInput(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00.000Z` : trimmed
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function assertAdmissionBeforeTermination(
  admission: Date | null,
  termination: Date | null
): void {
  if (admission && termination && admission.getTime() > termination.getTime()) {
    throw new EmployeeRegistrationError(
      "INVALID_DATE_RANGE",
      "A data de admissão não pode ser posterior à data de desligamento."
    );
  }
}

export function assertStatusTerminationConsistency(input: {
  status: string;
  terminationDate: Date | null;
}): void {
  const status = (input.status || "ACTIVE").toUpperCase();
  if (status === "ACTIVE" && input.terminationDate) {
    throw new EmployeeRegistrationError(
      "ACTIVE_WITH_TERMINATION",
      "Colaborador ativo não deve ter data de desligamento. Altere o status para Inativo ou remova a data."
    );
  }
}

export function assertClassification(value: string): EmployeeClassification {
  const upper = value.trim().toUpperCase();
  if (!(EMPLOYEE_CLASSIFICATIONS as readonly string[]).includes(upper)) {
    throw new EmployeeRegistrationError(
      "INVALID_CLASSIFICATION",
      "Classificação inválida. Use Direto, Indireto ou Apoio."
    );
  }
  return upper as EmployeeClassification;
}

export function assertContractType(value: string | null): string | null {
  if (value == null || !value.trim()) return null;
  const upper = value.trim().toUpperCase();
  if ((EMPLOYEE_CONTRACT_TYPES as readonly string[]).includes(upper)) {
    return upper;
  }
  // Preserva valores legados fora do enum (não inventa catálogo paralelo).
  return value.trim();
}

export type UserLinkStatus =
  | "linked"
  | "available_match"
  | "none"
  | "conflict";

export function resolveUserLinkStatus(input: {
  linkedUser: { id: string; email: string } | null | undefined;
  matchingUserByEmail: { id: string; email: string; employeeId: string | null } | null;
}): {
  status: UserLinkStatus;
  message: string;
  matchedUserId?: string;
  matchedUserEmail?: string;
} {
  if (input.linkedUser) {
    return {
      status: "linked",
      message: "Usuário vinculado",
      matchedUserId: input.linkedUser.id,
      matchedUserEmail: input.linkedUser.email,
    };
  }
  const match = input.matchingUserByEmail;
  if (!match) {
    return { status: "none", message: "Sem usuário" };
  }
  if (match.employeeId) {
    return {
      status: "conflict",
      message: "E-mail já usado por outro usuário vinculado a outra pessoa",
      matchedUserId: match.id,
      matchedUserEmail: match.email,
    };
  }
  return {
    status: "available_match",
    message: "Usuário disponível para vínculo",
    matchedUserId: match.id,
    matchedUserEmail: match.email,
  };
}

export async function assertCorporateEmailUnique(
  prisma: PrismaClient,
  email: string | null,
  excludeEmployeeId?: string | null
): Promise<void> {
  if (!email) return;
  const existing = await prisma.employee.findFirst({
    where: {
      corporateEmail: { equals: email, mode: "insensitive" },
      ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw new EmployeeRegistrationError(
      "DUPLICATE_CORPORATE_EMAIL",
      "Já existe um colaborador com este e-mail corporativo.",
      409
    );
  }
}

export async function resolveFinancialCostCenterLabel(
  prisma: PrismaClient,
  costCenterId: string | null
): Promise<{ id: string; code: string; name: string; label: string; status: string } | null> {
  if (!costCenterId || !isEmployeeUuid(costCenterId)) return null;
  const cc = await prisma.financialCostCenter.findUnique({
    where: { id: costCenterId },
    select: { id: true, code: true, name: true, status: true },
  });
  if (!cc) {
    throw new EmployeeRegistrationError(
      "COST_CENTER_NOT_FOUND",
      "Centro de custo inválido.",
      400
    );
  }
  return {
    ...cc,
    label: `${cc.code} — ${cc.name}`,
  };
}

export async function assertManagerAssignable(
  prisma: PrismaClient,
  input: {
    employeeId?: string | null;
    managerId: string | null;
    /** Mantém gestor inativo já vinculado (histórico) sem forçar troca. */
    preserveManagerId?: string | null;
    requireActive?: boolean;
  }
): Promise<{ id: string; name: string; socialName: string | null; status: string | null } | null> {
  if (!input.managerId) return null;
  if (!isEmployeeUuid(input.managerId)) {
    throw new EmployeeRegistrationError("INVALID_MANAGER_ID", "Gestor inválido.");
  }
  if (input.employeeId && input.managerId === input.employeeId) {
    throw new EmployeeRegistrationError(
      "MANAGER_SELF",
      "O colaborador não pode ser gestor de si mesmo."
    );
  }
  const manager = await prisma.employee.findUnique({
    where: { id: input.managerId },
    select: { id: true, name: true, socialName: true, status: true, managerId: true },
  });
  if (!manager) {
    throw new EmployeeRegistrationError("MANAGER_NOT_FOUND", "Gestor não encontrado.");
  }
  const preservingHistorical =
    Boolean(input.preserveManagerId) && input.preserveManagerId === input.managerId;
  const active = (manager.status ?? "ACTIVE").toUpperCase() === "ACTIVE";
  if (input.requireActive !== false && !active && !preservingHistorical) {
    throw new EmployeeRegistrationError(
      "MANAGER_INACTIVE",
      "Selecione um gestor ativo. Gestores inativos só permanecem em cadastros históricos."
    );
  }
  // Ciclo direto A↔B
  if (input.employeeId && manager.managerId === input.employeeId) {
    throw new EmployeeRegistrationError(
      "MANAGER_CYCLE",
      "Ciclo hierárquico inválido: o gestor selecionado já reporta a este colaborador."
    );
  }
  // Ciclo indireto (até 20 níveis)
  if (input.employeeId) {
    let cursor: string | null = manager.managerId;
    const seen = new Set<string>([input.managerId]);
    let depth = 0;
    while (cursor && depth < 20) {
      if (cursor === input.employeeId) {
        throw new EmployeeRegistrationError(
          "MANAGER_CYCLE",
          "Ciclo hierárquico inválido na cadeia de gestores."
        );
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const parent: { managerId: string | null } | null = await prisma.employee.findUnique({
        where: { id: cursor },
        select: { managerId: true },
      });
      cursor = parent?.managerId ?? null;
      depth += 1;
    }
  }
  return manager;
}

export function formatManagerDisplayName(manager: {
  name: string;
  socialName: string | null;
}): string {
  const social = manager.socialName?.trim();
  return social || manager.name.trim();
}

export async function prepareEmployeePersistedFields(
  prisma: PrismaClient,
  body: Record<string, unknown>,
  options?: { employeeId?: string | null; preserveManagerId?: string | null }
): Promise<{
  corporateEmail: string | null;
  costCenterId: string | null;
  costCenterLabel: string;
  managerId: string | null;
  managerName: string | null;
  classification: EmployeeClassification;
  contractType: string | null;
  admissionDate: Date | null;
  terminationDate: Date | null;
  status: string;
}> {
  const corporateEmail = normalizeCorporateEmail(body.corporateEmail);
  assertCorporateEmailFormat(corporateEmail);
  await assertCorporateEmailUnique(prisma, corporateEmail, options?.employeeId);

  const costCenterIdRaw =
    typeof body.costCenterId === "string" && body.costCenterId.trim()
      ? body.costCenterId.trim()
      : null;
  const cc = await resolveFinancialCostCenterLabel(prisma, costCenterIdRaw);
  const legacyCostCenterText =
    typeof body.costCenter === "string" ? body.costCenter.trim() : "";
  const costCenterLabel = cc?.label ?? legacyCostCenterText;
  if (!costCenterLabel) {
    throw new EmployeeRegistrationError(
      "COST_CENTER_REQUIRED",
      "Selecione um centro de custo."
    );
  }

  const managerIdRaw =
    typeof body.managerId === "string" && body.managerId.trim()
      ? body.managerId.trim()
      : null;
  const manager = await assertManagerAssignable(prisma, {
    employeeId: options?.employeeId,
    managerId: managerIdRaw,
    preserveManagerId: options?.preserveManagerId,
    requireActive: true,
  });
  const managerName = manager
    ? formatManagerDisplayName(manager)
    : typeof body.managerName === "string"
      ? body.managerName.trim() || null
      : null;

  const classification = assertClassification(
    typeof body.classification === "string" ? body.classification : ""
  );
  const contractType = assertContractType(
    typeof body.contractType === "string" ? body.contractType : null
  );

  const admissionDate = normalizeOptionalDateInput(body.admissionDate);
  const terminationDate = normalizeOptionalDateInput(body.terminationDate);
  assertAdmissionBeforeTermination(admissionDate, terminationDate);

  const status =
    (typeof body.status === "string" && body.status.trim().toUpperCase()) || "ACTIVE";
  if (status !== "ACTIVE" && status !== "INACTIVE") {
    throw new EmployeeRegistrationError("INVALID_STATUS", "Status inválido.");
  }
  assertStatusTerminationConsistency({ status, terminationDate });

  return {
    corporateEmail,
    costCenterId: cc?.id ?? null,
    costCenterLabel,
    managerId: manager?.id ?? null,
    managerName,
    classification,
    contractType,
    admissionDate,
    terminationDate,
    status,
  };
}
