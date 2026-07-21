/**
 * Estrutura organizacional RH — Diretoria → Departamento + líderes.
 * Regras puras (sem Prisma). Visão hierárquica futura consome estes vínculos.
 */

export const HR_ORG_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type HrOrgStatus = (typeof HR_ORG_STATUSES)[number];

export class HrOrgStructureError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "HrOrgStructureError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeHrOrgName(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
}

export function normalizeHrOrgCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return code.length > 0 ? code : null;
}

export function normalizeHrOrgStatus(raw: unknown, fallback: HrOrgStatus = "ACTIVE"): HrOrgStatus {
  const value = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (value === "ACTIVE" || value === "INACTIVE") return value;
  return fallback;
}

export function assertHrOrgLeaderRequired(input: {
  leaderEmployeeId: string | null | undefined;
  status: HrOrgStatus;
  unitLabel: "diretoria" | "departamento";
}): string {
  const id =
    typeof input.leaderEmployeeId === "string" ? input.leaderEmployeeId.trim() : "";
  if (!id) {
    throw new HrOrgStructureError(
      `Toda ${input.unitLabel} precisa de um líder designado.`,
      "LEADER_REQUIRED",
      400
    );
  }
  if (input.status === "ACTIVE" && !id) {
    throw new HrOrgStructureError(
      `Não é possível ativar ${input.unitLabel} sem líder.`,
      "LEADER_REQUIRED_ACTIVE",
      400
    );
  }
  return id;
}

export function assertHrOrgLeaderIsActive(input: {
  leaderStatus: string | null | undefined;
  unitLabel: "diretoria" | "departamento";
}): void {
  const status = (input.leaderStatus ?? "").trim().toUpperCase();
  if (status !== "ACTIVE") {
    throw new HrOrgStructureError(
      `O líder da ${input.unitLabel} precisa ser um colaborador ativo.`,
      "LEADER_MUST_BE_ACTIVE",
      400
    );
  }
}

export function assertHrDirectorateName(name: string): string {
  const clean = normalizeHrOrgName(name);
  if (!clean) {
    throw new HrOrgStructureError("Nome da diretoria é obrigatório.", "NAME_REQUIRED");
  }
  if (clean.length < 2) {
    throw new HrOrgStructureError("Nome da diretoria é muito curto.", "NAME_TOO_SHORT");
  }
  return clean;
}

export function assertHrDepartmentName(name: string): string {
  const clean = normalizeHrOrgName(name);
  if (!clean) {
    throw new HrOrgStructureError("Nome do departamento é obrigatório.", "NAME_REQUIRED");
  }
  if (clean.length < 2) {
    throw new HrOrgStructureError("Nome do departamento é muito curto.", "NAME_TOO_SHORT");
  }
  return clean;
}

/** Escopo hierárquico: líder de diretoria vê departamentos; líder de depto vê membros. */
export function buildHrHierarchicalViewerScope(input: {
  viewerEmployeeId: string;
  ledDirectorateIds: readonly string[];
  ledDepartmentIds: readonly string[];
  departmentIdsInLedDirectorates: readonly string[];
}): {
  viewerEmployeeId: string;
  directorateIds: string[];
  departmentIds: string[];
  isHierarchicalLeader: boolean;
} {
  const directorateIds = [...new Set(input.ledDirectorateIds.filter(Boolean))];
  const departmentIds = [
    ...new Set([
      ...input.ledDepartmentIds.filter(Boolean),
      ...input.departmentIdsInLedDirectorates.filter(Boolean),
    ]),
  ];
  return {
    viewerEmployeeId: input.viewerEmployeeId,
    directorateIds,
    departmentIds,
    isHierarchicalLeader: directorateIds.length > 0 || departmentIds.length > 0,
  };
}

/**
 * Com departamento oficial, o gestor da pessoa é sempre o líder do departamento.
 * Se a própria pessoa é o líder, sobe para o líder da diretoria (quando distinto).
 */
export function resolveForcedManagerFromOrgDepartment(input: {
  employeeId?: string | null;
  departmentLeaderEmployeeId: string | null | undefined;
  departmentLeaderName?: string | null;
  directorateLeaderEmployeeId?: string | null;
  directorateLeaderName?: string | null;
}): { managerId: string | null; managerName: string | null } {
  const employeeId = input.employeeId?.trim() || null;
  const deptLeaderId = input.departmentLeaderEmployeeId?.trim() || null;
  const dirLeaderId = input.directorateLeaderEmployeeId?.trim() || null;

  if (!deptLeaderId) {
    return { managerId: null, managerName: null };
  }

  if (employeeId && employeeId === deptLeaderId) {
    if (dirLeaderId && dirLeaderId !== employeeId) {
      return {
        managerId: dirLeaderId,
        managerName: (input.directorateLeaderName ?? "").trim() || null,
      };
    }
    return { managerId: null, managerName: null };
  }

  return {
    managerId: deptLeaderId,
    managerName: (input.departmentLeaderName ?? "").trim() || null,
  };
}
