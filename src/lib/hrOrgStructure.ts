/**
 * Estrutura organizacional RH — Diretoria → Departamento + líderes.
 * Hierarquia: diretoria pode responder a outra; departamento pode ficar dentro de outro.
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

/**
 * Normaliza o vínculo opcional Diretoria → Diretoria.
 * Vazio / null / "none" = sem vínculo (raiz).
 */
export function normalizeOptionalParentDirectorateId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.toLowerCase() === "none" || value === "__none__") return null;
  return value;
}

/**
 * Valida vínculo entre diretorias: não pode apontar para si mesma nem criar ciclo.
 * `parentById` deve conter todas as diretorias existentes (id → parentDirectorateId atual).
 */
export function assertHrDirectorateParentLink(input: {
  directorateId: string | null;
  parentDirectorateId: string | null;
  parentById: ReadonlyMap<string, string | null | undefined>;
}): string | null {
  const parentId = input.parentDirectorateId?.trim() || null;
  if (!parentId) return null;

  const selfId = input.directorateId?.trim() || null;
  if (selfId && parentId === selfId) {
    throw new HrOrgStructureError(
      "Uma diretoria não pode se vincular a si mesma.",
      "PARENT_SELF",
      400
    );
  }

  if (!input.parentById.has(parentId)) {
    throw new HrOrgStructureError(
      "Diretoria superior não encontrada.",
      "PARENT_NOT_FOUND",
      404
    );
  }

  let cursor: string | null | undefined = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (selfId && cursor === selfId) {
      throw new HrOrgStructureError(
        "Este vínculo criaria um ciclo entre diretorias.",
        "PARENT_CYCLE",
        400
      );
    }
    if (seen.has(cursor)) {
      throw new HrOrgStructureError(
        "Hierarquia de diretorias inconsistente (ciclo detectado).",
        "PARENT_CYCLE",
        400
      );
    }
    seen.add(cursor);
    cursor = input.parentById.get(cursor) ?? null;
  }

  return parentId;
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

/**
 * Normaliza o vínculo opcional Departamento → Departamento.
 * Vazio / null / "none" = sem vínculo (raiz na diretoria).
 */
export function normalizeOptionalParentDepartmentId(raw: unknown): string | null {
  return normalizeOptionalParentDirectorateId(raw);
}

/**
 * Valida vínculo entre departamentos: mesma diretoria, sem auto-referência nem ciclo.
 * `parentById` = id → parentDepartmentId; `directorateById` = id → directorateId.
 */
export function assertHrDepartmentParentLink(input: {
  departmentId: string | null;
  parentDepartmentId: string | null;
  directorateId: string;
  parentById: ReadonlyMap<string, string | null | undefined>;
  directorateById: ReadonlyMap<string, string | null | undefined>;
}): string | null {
  const parentId = input.parentDepartmentId?.trim() || null;
  if (!parentId) return null;

  const selfId = input.departmentId?.trim() || null;
  if (selfId && parentId === selfId) {
    throw new HrOrgStructureError(
      "Um departamento não pode se vincular a si mesmo.",
      "PARENT_SELF",
      400
    );
  }

  if (!input.parentById.has(parentId)) {
    throw new HrOrgStructureError(
      "Departamento superior não encontrado.",
      "PARENT_NOT_FOUND",
      404
    );
  }

  const parentDirectorateId = (input.directorateById.get(parentId) ?? "").trim();
  const selfDirectorateId = input.directorateId.trim();
  if (!selfDirectorateId || parentDirectorateId !== selfDirectorateId) {
    throw new HrOrgStructureError(
      "O departamento superior precisa pertencer à mesma diretoria.",
      "PARENT_DIRECTORATE_MISMATCH",
      400
    );
  }

  let cursor: string | null | undefined = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (selfId && cursor === selfId) {
      throw new HrOrgStructureError(
        "Este vínculo criaria um ciclo entre departamentos.",
        "PARENT_CYCLE",
        400
      );
    }
    if (seen.has(cursor)) {
      throw new HrOrgStructureError(
        "Hierarquia de departamentos inconsistente (ciclo detectado).",
        "PARENT_CYCLE",
        400
      );
    }
    seen.add(cursor);
    cursor = input.parentById.get(cursor) ?? null;
  }

  return parentId;
}

export type HrOrgLeadershipRole = {
  kind: "directorate" | "department";
  id: string;
  name: string;
};

/** Monta resumo de liderança a partir de listas já carregadas (sem I/O). */
export function buildEmployeeOrgLeadershipSummary(input: {
  employeeId: string;
  ledDirectorates: readonly { id: string; name: string }[];
  ledDepartments: readonly { id: string; name: string }[];
}): {
  isOrgLeader: boolean;
  roles: HrOrgLeadershipRole[];
  label: string | null;
} {
  const roles: HrOrgLeadershipRole[] = [
    ...input.ledDirectorates.map((d) => ({
      kind: "directorate" as const,
      id: d.id,
      name: d.name,
    })),
    ...input.ledDepartments.map((d) => ({
      kind: "department" as const,
      id: d.id,
      name: d.name,
    })),
  ];
  if (roles.length === 0) {
    return { isOrgLeader: false, roles: [], label: null };
  }
  const label = roles
    .map((r) => `${r.name} (${r.kind === "directorate" ? "diretoria" : "departamento"})`)
    .join(", ");
  return { isOrgLeader: true, roles, label };
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
 * Se a própria pessoa é o líder, sobe para o líder do departamento superior
 * (quando houver) e, em seguida, para o líder da diretoria (quando distinto).
 */
export function resolveForcedManagerFromOrgDepartment(input: {
  employeeId?: string | null;
  departmentLeaderEmployeeId: string | null | undefined;
  departmentLeaderName?: string | null;
  parentDepartmentLeaderEmployeeId?: string | null;
  parentDepartmentLeaderName?: string | null;
  directorateLeaderEmployeeId?: string | null;
  directorateLeaderName?: string | null;
}): { managerId: string | null; managerName: string | null } {
  const employeeId = input.employeeId?.trim() || null;
  const deptLeaderId = input.departmentLeaderEmployeeId?.trim() || null;
  const parentDeptLeaderId = input.parentDepartmentLeaderEmployeeId?.trim() || null;
  const dirLeaderId = input.directorateLeaderEmployeeId?.trim() || null;

  if (!deptLeaderId) {
    return { managerId: null, managerName: null };
  }

  if (employeeId && employeeId === deptLeaderId) {
    if (parentDeptLeaderId && parentDeptLeaderId !== employeeId) {
      return {
        managerId: parentDeptLeaderId,
        managerName: (input.parentDepartmentLeaderName ?? "").trim() || null,
      };
    }
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
