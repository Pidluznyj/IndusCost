/**
 * Vínculo AppUser ↔ Employee (Pessoas / RH).
 * Novos usuários só podem ser criados a partir de pessoas ativas sem conta.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isEmployeeLinkUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export type EligibleEmployeeRow = {
  id: string;
  name: string;
  socialName: string | null;
  personalEmail: string | null;
  corporateEmail?: string | null;
  department: string;
  status: string | null;
};

export type EligibleEmployeeForUserDto = EligibleEmployeeRow & {
  displayName: string;
  searchText: string;
};

export class EmployeeUserLinkError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EmployeeUserLinkError";
    this.code = code;
  }
}

export function resolveEmployeeDisplayName(
  employee: Pick<EligibleEmployeeRow, "name" | "socialName">
): string {
  const social = employee.socialName?.trim();
  if (social) return social;
  return employee.name.trim();
}

export function toEligibleEmployeeForUserDto(
  employee: EligibleEmployeeRow
): EligibleEmployeeForUserDto {
  const displayName = resolveEmployeeDisplayName(employee);
  const parts = [
    displayName,
    employee.department,
    employee.corporateEmail ?? "",
    employee.personalEmail ?? "",
    employee.name,
    employee.socialName ?? "",
  ];
  return {
    ...employee,
    displayName,
    searchText: parts.filter(Boolean).join(" ").toLowerCase(),
  };
}

export function isEmployeeActiveForUserLink(status: string | null | undefined): boolean {
  const normalized = (status ?? "ACTIVE").trim().toUpperCase();
  return normalized === "ACTIVE";
}

/** Filtra personas elegíveis (ativas e ainda sem usuário vinculado). */
export function filterEligibleEmployeesForUserLink(
  employees: EligibleEmployeeRow[],
  linkedEmployeeIds: ReadonlySet<string>
): EligibleEmployeeForUserDto[] {
  return employees
    .filter((emp) => isEmployeeActiveForUserLink(emp.status))
    .filter((emp) => !linkedEmployeeIds.has(emp.id))
    .map(toEligibleEmployeeForUserDto)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
}

export function assertEmployeeEligibleForUserLink(input: {
  employeeId: unknown;
  employee: EligibleEmployeeRow | null;
  alreadyLinkedUserId?: string | null;
}): EligibleEmployeeRow {
  const id =
    typeof input.employeeId === "string" ? input.employeeId.trim() : "";
  if (!isEmployeeLinkUuid(id)) {
    throw new EmployeeUserLinkError(
      "INVALID_EMPLOYEE_ID",
      "Selecione uma pessoa cadastrada em Pessoas / RH."
    );
  }
  if (!input.employee) {
    throw new EmployeeUserLinkError(
      "EMPLOYEE_NOT_FOUND",
      "Pessoa não encontrada no cadastro de Pessoas / RH."
    );
  }
  if (!isEmployeeActiveForUserLink(input.employee.status)) {
    throw new EmployeeUserLinkError(
      "EMPLOYEE_INACTIVE",
      "Só é possível criar usuário para pessoas com status ACTIVE."
    );
  }
  if (input.alreadyLinkedUserId) {
    throw new EmployeeUserLinkError(
      "EMPLOYEE_ALREADY_LINKED",
      "Esta pessoa já possui usuário de acesso no sistema."
    );
  }
  return input.employee;
}

export function resolveLoginEmailForNewUser(input: {
  requestedEmail: string;
  personalEmail: string | null | undefined;
  corporateEmail?: string | null | undefined;
}): string {
  const requested = input.requestedEmail.trim();
  if (requested) return requested;
  const corporate = (input.corporateEmail ?? "").trim();
  if (corporate) return corporate.toLowerCase();
  return (input.personalEmail ?? "").trim();
}
