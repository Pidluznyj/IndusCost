/**
 * Cadastro de colaborador (Pessoas / RH) — validação e normalização servidor.
 * Sem motor paralelo: reutiliza Role, FinancialCostCenter e vínculo AppUser↔Employee.
 */

import type { PrismaClient } from "@prisma/client";
import {
  assertCorporateEmailFormat as assertCorporateEmailFormatPure,
  CorporateEmailError,
  normalizeCorporateEmail,
} from "@/src/lib/employeeCorporateEmail.js";

export { normalizeCorporateEmail } from "@/src/lib/employeeCorporateEmail.js";

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

function rethrowCorporateEmail(err: unknown): never {
  if (err instanceof CorporateEmailError) {
    throw new EmployeeRegistrationError(err.code, err.message, err.status);
  }
  throw err;
}

/** Formato válido; falha como EmployeeRegistrationError (compat API RH). */
export function assertCorporateEmailFormat(email: string | null): void {
  try {
    assertCorporateEmailFormatPure(email);
  } catch (err) {
    rethrowCorporateEmail(err);
  }
}

export function isEmployeeUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
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

export function assertContractType(
  value: string | null,
  opts?: { allowLegacy?: boolean; previousValue?: string | null }
): string | null {
  if (value == null || !value.trim()) return null;
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if ((EMPLOYEE_CONTRACT_TYPES as readonly string[]).includes(upper)) {
    return upper;
  }
  // Preserva valor legado inalterado (sem inventar catálogo paralelo).
  const previous = (opts?.previousValue ?? "").trim();
  if (opts?.allowLegacy && previous && trimmed === previous) {
    return trimmed;
  }
  throw new EmployeeRegistrationError(
    "INVALID_CONTRACT_TYPE",
    "Tipo de contrato inválido. Selecione uma das opções oficiais."
  );
}

export async function assertRoleExists(
  prisma: PrismaClient,
  roleId: string | null | undefined
): Promise<{ id: string; name: string }> {
  if (!roleId || !isEmployeeUuid(roleId)) {
    throw new EmployeeRegistrationError("INVALID_ROLE", "Selecione um cargo válido.");
  }
  const role = await prisma.role.findUnique({
    where: { id: roleId.trim() },
    select: { id: true, name: true },
  });
  if (!role) {
    throw new EmployeeRegistrationError("ROLE_NOT_FOUND", "Cargo não encontrado.", 400);
  }
  return role;
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
    select: { id: true, name: true },
  });
  if (existing) {
    throw new EmployeeRegistrationError(
      "DUPLICATE_CORPORATE_EMAIL",
      `Já existe um colaborador com este e-mail corporativo${existing.name ? ` (“${existing.name}”)` : ""}.`,
      409
    );
  }
}

/**
 * Conflito explícito com login existente:
 * - AppUser com o mesmo e-mail já vinculado a OUTRO colaborador → bloqueia.
 * - AppUser livre ou já vinculado a este colaborador → não bloqueia (não altera login).
 * Nunca cria nem reescreve AppUser.email.
 */
export async function assertCorporateEmailAppUserConflict(
  prisma: PrismaClient,
  email: string | null,
  employeeId?: string | null
): Promise<{
  status: "none" | "linked_here" | "available_match" | "conflict";
  appUserId?: string;
  appUserEmail?: string;
}> {
  if (!email) return { status: "none" };
  const user = await prisma.appUser.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, employeeId: true },
  });
  if (!user) return { status: "none" };

  if (employeeId && user.employeeId === employeeId) {
    return { status: "linked_here", appUserId: user.id, appUserEmail: user.email };
  }
  if (user.employeeId && user.employeeId !== employeeId) {
    throw new EmployeeRegistrationError(
      "CORPORATE_EMAIL_APPUSER_CONFLICT",
      "Este e-mail corporativo já é o login de um usuário vinculado a outro colaborador. Escolha outro e-mail ou resolva o vínculo em Configurações → Usuários. O login não é alterado automaticamente.",
      409
    );
  }
  return {
    status: "available_match",
    appUserId: user.id,
    appUserEmail: user.email,
  };
}

/** Pré-visualização (FE) sem lançar — não vincula automaticamente. */
export function describeCorporateEmailAppUserHint(status: {
  status: "none" | "linked_here" | "available_match" | "conflict";
  appUserEmail?: string;
}): string | null {
  if (status.status === "available_match") {
    return "Existe um usuário do sistema com este e-mail, ainda sem vínculo de colaborador. O cadastro não cria nem altera o login; o vínculo é manual na ficha.";
  }
  if (status.status === "linked_here") {
    return "Este e-mail corresponde ao login já vinculado a este colaborador.";
  }
  if (status.status === "conflict") {
    return "Este e-mail é login de um usuário já vinculado a outro colaborador.";
  }
  return null;
}

export async function resolveFinancialCostCenterLabel(
  prisma: PrismaClient,
  costCenterId: string | null,
  opts?: { requireActive?: boolean; preserveId?: string | null }
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
  const preserving = Boolean(opts?.preserveId) && opts?.preserveId === cc.id;
  if (opts?.requireActive && !preserving && cc.status !== "ACTIVE") {
    throw new EmployeeRegistrationError(
      "COST_CENTER_INACTIVE",
      "Selecione um centro de custo ativo do financeiro.",
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
  options?: {
    employeeId?: string | null;
    preserveManagerId?: string | null;
    preserveCostCenterId?: string | null;
    existingCostCenterLabel?: string | null;
    existingContractType?: string | null;
    /** Create: exige costCenterId oficial. Update legado pode manter rótulo sem ID. */
    requireCostCenterId?: boolean;
    /** Update: permite manter contractType legado inalterado. */
    allowLegacyContractType?: boolean;
  }
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
  appUserEmailHint: string | null;
}> {
  const corporateEmail = normalizeCorporateEmail(body.corporateEmail);
  assertCorporateEmailFormat(corporateEmail);
  await assertCorporateEmailUnique(prisma, corporateEmail, options?.employeeId);
  const appUserHint = await assertCorporateEmailAppUserConflict(
    prisma,
    corporateEmail,
    options?.employeeId
  );

  const costCenterIdRaw =
    typeof body.costCenterId === "string" && body.costCenterId.trim()
      ? body.costCenterId.trim()
      : null;
  const legacyCostCenterText =
    typeof body.costCenter === "string" ? body.costCenter.trim() : "";

  if (options?.requireCostCenterId && !costCenterIdRaw) {
    throw new EmployeeRegistrationError(
      "COST_CENTER_ID_REQUIRED",
      "Selecione um centro de custo oficial do financeiro."
    );
  }

  const cc = await resolveFinancialCostCenterLabel(prisma, costCenterIdRaw, {
    requireActive: true,
    preserveId: options?.preserveCostCenterId,
  });

  // Sem ID: só permitido se for legado inalterado (rótulo igual ao persistido).
  if (!cc) {
    const existingLabel = (options?.existingCostCenterLabel ?? "").trim();
    const sameLegacy =
      Boolean(options?.employeeId) &&
      !options?.preserveCostCenterId &&
      Boolean(existingLabel) &&
      legacyCostCenterText === existingLabel;
    if (!sameLegacy) {
      throw new EmployeeRegistrationError(
        "COST_CENTER_ID_REQUIRED",
        "Selecione um centro de custo oficial do financeiro. Texto arbitrário não é aceito."
      );
    }
  }

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
  // Nome do gestor só via cadastro oficial — não aceitar texto solto como gestor.
  const managerName = manager ? formatManagerDisplayName(manager) : null;

  const classification = assertClassification(
    typeof body.classification === "string" ? body.classification : ""
  );
  const contractType = assertContractType(
    typeof body.contractType === "string" ? body.contractType : null,
    {
      allowLegacy: options?.allowLegacyContractType === true,
      previousValue: options?.existingContractType,
    }
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
    appUserEmailHint: describeCorporateEmailAppUserHint(appUserHint),
  };
}
