/**
 * Persistência da estrutura organizacional RH (Diretoria / Departamento).
 */
import type { PrismaClient } from "@prisma/client";
import {
  HrOrgStructureError,
  assertHrDepartmentName,
  assertHrDirectorateName,
  assertHrDirectorateParentLink,
  assertHrOrgLeaderIsActive,
  assertHrOrgLeaderRequired,
  normalizeHrOrgCode,
  normalizeHrOrgStatus,
  normalizeOptionalParentDirectorateId,
  resolveForcedManagerFromOrgDepartment,
  buildEmployeeOrgLeadershipSummary,
  type HrOrgStatus,
} from "@/src/lib/hrOrgStructure.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

type Db = Pick<
  PrismaClient,
  "hrDirectorate" | "hrDepartment" | "employee"
>;

const leaderSelect = {
  id: true,
  name: true,
  socialName: true,
  status: true,
  department: true,
} as const;

async function assertLeaderEmployee(db: Db, leaderEmployeeId: string, unitLabel: "diretoria" | "departamento") {
  const leader = await db.employee.findUnique({
    where: { id: leaderEmployeeId },
    select: { id: true, status: true, name: true },
  });
  if (!leader) {
    throw new HrOrgStructureError(
      `Colaborador líder da ${unitLabel} não encontrado.`,
      "LEADER_NOT_FOUND",
      404
    );
  }
  assertHrOrgLeaderIsActive({ leaderStatus: leader.status, unitLabel });
  return leader;
}

export function serializeHrDirectorate(row: {
  id: string;
  code: string | null;
  name: string;
  status: string;
  leaderEmployeeId: string;
  parentDirectorateId?: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  leader?: {
    id: string;
    name: string;
    socialName: string | null;
    status: string | null;
    department: string;
  } | null;
  parentDirectorate?: {
    id: string;
    name: string;
    status: string;
    code: string | null;
  } | null;
  departments?: Array<{ id: string; name: string; status: string }> | null;
  _count?: { departments: number; childDirectorates?: number } | null;
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status as HrOrgStatus,
    leaderEmployeeId: row.leaderEmployeeId,
    parentDirectorateId: row.parentDirectorateId ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    leader: row.leader
      ? {
          id: row.leader.id,
          name: row.leader.name,
          socialName: row.leader.socialName,
          status: row.leader.status,
          department: row.leader.department,
        }
      : null,
    parentDirectorate: row.parentDirectorate
      ? {
          id: row.parentDirectorate.id,
          name: row.parentDirectorate.name,
          status: row.parentDirectorate.status,
          code: row.parentDirectorate.code,
        }
      : null,
    departmentCount: row._count?.departments ?? row.departments?.length ?? 0,
    childDirectorateCount: row._count?.childDirectorates ?? 0,
    departments: (row.departments ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
    })),
  };
}

export function serializeHrDepartment(row: {
  id: string;
  code: string | null;
  name: string;
  status: string;
  directorateId: string;
  leaderEmployeeId: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  leader?: {
    id: string;
    name: string;
    socialName: string | null;
    status: string | null;
    department: string;
  } | null;
  directorate?: {
    id: string;
    name: string;
    status: string;
    code: string | null;
    leaderEmployeeId?: string;
    leader?: { id: string; name: string; socialName: string | null } | null;
  } | null;
  _count?: { employees: number } | null;
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status as HrOrgStatus,
    directorateId: row.directorateId,
    leaderEmployeeId: row.leaderEmployeeId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    leader: row.leader
      ? {
          id: row.leader.id,
          name: row.leader.name,
          socialName: row.leader.socialName,
          status: row.leader.status,
          department: row.leader.department,
        }
      : null,
    directorate: row.directorate
      ? {
          id: row.directorate.id,
          name: row.directorate.name,
          status: row.directorate.status,
          code: row.directorate.code,
          leaderEmployeeId: row.directorate.leaderEmployeeId ?? null,
          leaderName:
            row.directorate.leader?.socialName?.trim() ||
            row.directorate.leader?.name?.trim() ||
            null,
        }
      : null,
    employeeCount: row._count?.employees ?? 0,
  };
}

const directorateInclude = {
  leader: { select: leaderSelect },
  parentDirectorate: {
    select: { id: true, name: true, status: true, code: true },
  },
  departments: {
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" as const },
  },
  _count: { select: { departments: true, childDirectorates: true } },
} as const;

async function loadDirectorateParentMap(db: Db): Promise<Map<string, string | null>> {
  const rows = await db.hrDirectorate.findMany({
    select: { id: true, parentDirectorateId: true },
  });
  return new Map(rows.map((r) => [r.id, r.parentDirectorateId ?? null]));
}

async function resolveParentDirectorateId(
  db: Db,
  body: Record<string, unknown>,
  options: { directorateId: string | null; existingParentId?: string | null; bodyHasParentField: boolean }
): Promise<string | null> {
  if (!options.bodyHasParentField) {
    return options.existingParentId ?? null;
  }
  const rawParent = normalizeOptionalParentDirectorateId(body.parentDirectorateId);
  if (rawParent && !isUuid(rawParent)) {
    throw new HrOrgStructureError("Diretoria superior inválida.", "PARENT_INVALID", 400);
  }
  const parentById = await loadDirectorateParentMap(db);
  return assertHrDirectorateParentLink({
    directorateId: options.directorateId,
    parentDirectorateId: rawParent,
    parentById,
  });
}

export async function listHrDirectorates(db: Db) {
  const rows = await db.hrDirectorate.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: directorateInclude,
  });
  return rows.map(serializeHrDirectorate);
}

export async function listHrDepartments(
  db: Db,
  options?: { directorateId?: string | null; status?: HrOrgStatus | null }
) {
  const rows = await db.hrDepartment.findMany({
    where: {
      ...(options?.directorateId && isUuid(options.directorateId)
        ? { directorateId: options.directorateId.trim() }
        : {}),
      ...(options?.status ? { status: options.status } : {}),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      leader: { select: leaderSelect },
      directorate: {
        select: {
          id: true,
          name: true,
          status: true,
          code: true,
          leaderEmployeeId: true,
          leader: { select: { id: true, name: true, socialName: true } },
        },
      },
      _count: { select: { employees: true } },
    },
  });
  return rows.map(serializeHrDepartment);
}

export async function createHrDirectorate(
  db: Db,
  body: Record<string, unknown>
) {
  const name = assertHrDirectorateName(body.name);
  const status = normalizeHrOrgStatus(body.status, "ACTIVE");
  const leaderEmployeeId = assertHrOrgLeaderRequired({
    leaderEmployeeId: typeof body.leaderEmployeeId === "string" ? body.leaderEmployeeId : null,
    status,
    unitLabel: "diretoria",
  });
  if (!isUuid(leaderEmployeeId)) {
    throw new HrOrgStructureError("Líder da diretoria inválido.", "LEADER_INVALID");
  }
  await assertLeaderEmployee(db, leaderEmployeeId, "diretoria");

  const code = normalizeHrOrgCode(body.code);
  const notes =
    typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  const parentDirectorateId = await resolveParentDirectorateId(db, body, {
    directorateId: null,
    bodyHasParentField: Object.prototype.hasOwnProperty.call(body, "parentDirectorateId"),
  });

  try {
    const row = await db.hrDirectorate.create({
      data: {
        name,
        code,
        status,
        leaderEmployeeId,
        parentDirectorateId,
        notes,
      },
      include: directorateInclude,
    });
    await clearEmployeeMemberDepartmentForOrgLeader(db, leaderEmployeeId, name);
    return serializeHrDirectorate(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("HrDirectorate_name_key") || msg.includes("Unique constraint")) {
      throw new HrOrgStructureError("Já existe uma diretoria com este nome.", "NAME_DUPLICATE", 409);
    }
    if (msg.includes("HrDirectorate_code_key")) {
      throw new HrOrgStructureError("Já existe uma diretoria com este código.", "CODE_DUPLICATE", 409);
    }
    throw err;
  }
}

export async function updateHrDirectorate(
  db: Db,
  id: string,
  body: Record<string, unknown>
) {
  if (!isUuid(id)) {
    throw new HrOrgStructureError("Diretoria inválida.", "INVALID_ID", 400);
  }
  const existing = await db.hrDirectorate.findUnique({ where: { id: id.trim() } });
  if (!existing) {
    throw new HrOrgStructureError("Diretoria não encontrada.", "NOT_FOUND", 404);
  }

  const name =
    body.name !== undefined ? assertHrDirectorateName(body.name) : existing.name;
  const status =
    body.status !== undefined
      ? normalizeHrOrgStatus(body.status, existing.status as HrOrgStatus)
      : (existing.status as HrOrgStatus);
  const leaderEmployeeId = assertHrOrgLeaderRequired({
    leaderEmployeeId:
      body.leaderEmployeeId !== undefined
        ? typeof body.leaderEmployeeId === "string"
          ? body.leaderEmployeeId
          : null
        : existing.leaderEmployeeId,
    status,
    unitLabel: "diretoria",
  });
  if (!isUuid(leaderEmployeeId)) {
    throw new HrOrgStructureError("Líder da diretoria inválido.", "LEADER_INVALID");
  }
  await assertLeaderEmployee(db, leaderEmployeeId, "diretoria");

  const code =
    body.code !== undefined ? normalizeHrOrgCode(body.code) : existing.code;
  const notes =
    body.notes !== undefined
      ? typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim()
        : null
      : existing.notes;
  const parentDirectorateId = await resolveParentDirectorateId(db, body, {
    directorateId: id.trim(),
    existingParentId: existing.parentDirectorateId ?? null,
    bodyHasParentField: Object.prototype.hasOwnProperty.call(body, "parentDirectorateId"),
  });

  try {
    const row = await db.hrDirectorate.update({
      where: { id: id.trim() },
      data: { name, code, status, leaderEmployeeId, parentDirectorateId, notes },
      include: directorateInclude,
    });
    await clearEmployeeMemberDepartmentForOrgLeader(db, leaderEmployeeId, name);
    return serializeHrDirectorate(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("HrDirectorate_name_key") || msg.includes("Unique constraint")) {
      throw new HrOrgStructureError("Já existe uma diretoria com este nome.", "NAME_DUPLICATE", 409);
    }
    if (msg.includes("HrDirectorate_code_key")) {
      throw new HrOrgStructureError("Já existe uma diretoria com este código.", "CODE_DUPLICATE", 409);
    }
    throw err;
  }
}

export async function createHrDepartment(db: Db, body: Record<string, unknown>) {
  const name = assertHrDepartmentName(body.name);
  const status = normalizeHrOrgStatus(body.status, "ACTIVE");
  const directorateId =
    typeof body.directorateId === "string" ? body.directorateId.trim() : "";
  if (!isUuid(directorateId)) {
    throw new HrOrgStructureError(
      "Selecione a diretoria do departamento.",
      "DIRECTORATE_REQUIRED"
    );
  }
  const directorate = await db.hrDirectorate.findUnique({
    where: { id: directorateId },
    select: { id: true, status: true, name: true },
  });
  if (!directorate) {
    throw new HrOrgStructureError("Diretoria não encontrada.", "DIRECTORATE_NOT_FOUND", 404);
  }
  if (status === "ACTIVE" && directorate.status !== "ACTIVE") {
    throw new HrOrgStructureError(
      "Não é possível ativar departamento em diretoria inativa.",
      "DIRECTORATE_INACTIVE",
      400
    );
  }

  const leaderEmployeeId = assertHrOrgLeaderRequired({
    leaderEmployeeId: typeof body.leaderEmployeeId === "string" ? body.leaderEmployeeId : null,
    status,
    unitLabel: "departamento",
  });
  if (!isUuid(leaderEmployeeId)) {
    throw new HrOrgStructureError("Líder do departamento inválido.", "LEADER_INVALID");
  }
  await assertLeaderEmployee(db, leaderEmployeeId, "departamento");

  const code = normalizeHrOrgCode(body.code);
  const notes =
    typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  try {
    const row = await db.hrDepartment.create({
      data: {
        name,
        code,
        status,
        directorateId,
        leaderEmployeeId,
        notes,
      },
      include: {
        leader: { select: leaderSelect },
        directorate: {
          select: {
            id: true,
            name: true,
            status: true,
            code: true,
            leaderEmployeeId: true,
            leader: { select: { id: true, name: true, socialName: true } },
          },
        },
        _count: { select: { employees: true } },
      },
    });
    await clearEmployeeMemberDepartmentForOrgLeader(db, leaderEmployeeId, name);
    return serializeHrDepartment(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("HrDepartment_directorateId_name_key") || msg.includes("Unique constraint")) {
      throw new HrOrgStructureError(
        "Já existe um departamento com este nome nesta diretoria.",
        "NAME_DUPLICATE",
        409
      );
    }
    if (msg.includes("HrDepartment_code_key")) {
      throw new HrOrgStructureError("Já existe um departamento com este código.", "CODE_DUPLICATE", 409);
    }
    throw err;
  }
}

export async function updateHrDepartment(
  db: Db,
  id: string,
  body: Record<string, unknown>
) {
  if (!isUuid(id)) {
    throw new HrOrgStructureError("Departamento inválido.", "INVALID_ID", 400);
  }
  const existing = await db.hrDepartment.findUnique({ where: { id: id.trim() } });
  if (!existing) {
    throw new HrOrgStructureError("Departamento não encontrado.", "NOT_FOUND", 404);
  }

  const name =
    body.name !== undefined ? assertHrDepartmentName(body.name) : existing.name;
  const status =
    body.status !== undefined
      ? normalizeHrOrgStatus(body.status, existing.status as HrOrgStatus)
      : (existing.status as HrOrgStatus);
  const directorateId =
    body.directorateId !== undefined
      ? typeof body.directorateId === "string"
        ? body.directorateId.trim()
        : ""
      : existing.directorateId;
  if (!isUuid(directorateId)) {
    throw new HrOrgStructureError("Diretoria inválida.", "DIRECTORATE_INVALID");
  }
  const directorate = await db.hrDirectorate.findUnique({
    where: { id: directorateId },
    select: { id: true, status: true },
  });
  if (!directorate) {
    throw new HrOrgStructureError("Diretoria não encontrada.", "DIRECTORATE_NOT_FOUND", 404);
  }
  if (status === "ACTIVE" && directorate.status !== "ACTIVE") {
    throw new HrOrgStructureError(
      "Não é possível ativar departamento em diretoria inativa.",
      "DIRECTORATE_INACTIVE",
      400
    );
  }

  const leaderEmployeeId = assertHrOrgLeaderRequired({
    leaderEmployeeId:
      body.leaderEmployeeId !== undefined
        ? typeof body.leaderEmployeeId === "string"
          ? body.leaderEmployeeId
          : null
        : existing.leaderEmployeeId,
    status,
    unitLabel: "departamento",
  });
  if (!isUuid(leaderEmployeeId)) {
    throw new HrOrgStructureError("Líder do departamento inválido.", "LEADER_INVALID");
  }
  await assertLeaderEmployee(db, leaderEmployeeId, "departamento");

  const code =
    body.code !== undefined ? normalizeHrOrgCode(body.code) : existing.code;
  const notes =
    body.notes !== undefined
      ? typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim()
        : null
      : existing.notes;

  try {
    const row = await db.hrDepartment.update({
      where: { id: id.trim() },
      data: { name, code, status, directorateId, leaderEmployeeId, notes },
      include: {
        leader: { select: leaderSelect },
        directorate: {
          select: {
            id: true,
            name: true,
            status: true,
            code: true,
            leaderEmployeeId: true,
            leader: { select: { id: true, name: true, socialName: true } },
          },
        },
        _count: { select: { employees: true } },
      },
    });

    // Mantém rótulo cache e gestor (líder do departamento) nos colaboradores vinculados.
    await db.employee.updateMany({
      where: { departmentId: row.id },
      data: { department: row.name },
    });

    const members = await db.employee.findMany({
      where: { departmentId: row.id },
      select: { id: true },
    });
    const directorate = await db.hrDirectorate.findUnique({
      where: { id: row.directorateId },
      select: {
        leaderEmployeeId: true,
        leader: { select: { name: true, socialName: true } },
      },
    });
    const directorateLeaderName =
      directorate?.leader.socialName?.trim() ||
      directorate?.leader.name.trim() ||
      null;
    const departmentLeaderName =
      row.leader.socialName?.trim() || row.leader.name.trim() || null;

    for (const member of members) {
      const forced = resolveForcedManagerFromOrgDepartment({
        employeeId: member.id,
        departmentLeaderEmployeeId: row.leaderEmployeeId,
        departmentLeaderName,
        directorateLeaderEmployeeId: directorate?.leaderEmployeeId ?? null,
        directorateLeaderName,
      });
      await db.employee.update({
        where: { id: member.id },
        data: {
          managerId: forced.managerId,
          managerName: forced.managerName,
        },
      });
    }

    await clearEmployeeMemberDepartmentForOrgLeader(db, row.leaderEmployeeId, row.name);
    return serializeHrDepartment(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("HrDepartment_directorateId_name_key") || msg.includes("Unique constraint")) {
      throw new HrOrgStructureError(
        "Já existe um departamento com este nome nesta diretoria.",
        "NAME_DUPLICATE",
        409
      );
    }
    if (msg.includes("HrDepartment_code_key")) {
      throw new HrOrgStructureError("Já existe um departamento com este código.", "CODE_DUPLICATE", 409);
    }
    throw err;
  }
}

export async function resolveHrDepartmentLabel(
  db: Db,
  departmentId: string | null,
  legacyLabel: string
): Promise<{
  departmentId: string | null;
  department: string;
  leaderEmployeeId: string | null;
  leaderName: string | null;
  directorateLeaderEmployeeId: string | null;
  directorateLeaderName: string | null;
}> {
  const legacy = typeof legacyLabel === "string" ? legacyLabel.trim() : "";
  const empty = {
    departmentId: null as string | null,
    department: legacy,
    leaderEmployeeId: null as string | null,
    leaderName: null as string | null,
    directorateLeaderEmployeeId: null as string | null,
    directorateLeaderName: null as string | null,
  };
  if (!departmentId || !isUuid(departmentId)) {
    return empty;
  }
  const row = await db.hrDepartment.findUnique({
    where: { id: departmentId.trim() },
    select: {
      id: true,
      name: true,
      status: true,
      leaderEmployeeId: true,
      leader: { select: { id: true, name: true, socialName: true } },
      directorate: {
        select: {
          leaderEmployeeId: true,
          leader: { select: { id: true, name: true, socialName: true } },
        },
      },
    },
  });
  if (!row) {
    throw new HrOrgStructureError(
      "Departamento oficial não encontrado.",
      "DEPARTMENT_NOT_FOUND",
      400
    );
  }
  const leaderName =
    row.leader.socialName?.trim() || row.leader.name.trim() || null;
  const directorateLeaderName =
    row.directorate.leader.socialName?.trim() ||
    row.directorate.leader.name.trim() ||
    null;
  return {
    departmentId: row.id,
    department: row.name,
    leaderEmployeeId: row.leaderEmployeeId,
    leaderName,
    directorateLeaderEmployeeId: row.directorate.leaderEmployeeId,
    directorateLeaderName,
  };
}

/** Escopo do colaborador para visão hierárquica (líder de diretoria/departamento). */
export async function loadHrHierarchicalScopeForEmployee(
  db: Db,
  employeeId: string
) {
  if (!isUuid(employeeId)) {
    return {
      viewerEmployeeId: employeeId,
      directorateIds: [] as string[],
      departmentIds: [] as string[],
      isHierarchicalLeader: false,
    };
  }
  const [ledDirectorates, ledDepartments] = await Promise.all([
    db.hrDirectorate.findMany({
      where: { leaderEmployeeId: employeeId.trim(), status: "ACTIVE" },
      select: { id: true },
    }),
    db.hrDepartment.findMany({
      where: { leaderEmployeeId: employeeId.trim(), status: "ACTIVE" },
      select: { id: true },
    }),
  ]);
  const directorateIds = ledDirectorates.map((d) => d.id);
  const departmentsInDirectorates =
    directorateIds.length > 0
      ? await db.hrDepartment.findMany({
          where: { directorateId: { in: directorateIds }, status: "ACTIVE" },
          select: { id: true },
        })
      : [];
  const departmentIds = [
    ...new Set([
      ...ledDepartments.map((d) => d.id),
      ...departmentsInDirectorates.map((d) => d.id),
    ]),
  ];
  return {
    viewerEmployeeId: employeeId.trim(),
    directorateIds,
    departmentIds,
    isHierarchicalLeader: directorateIds.length > 0 || departmentIds.length > 0,
  };
}

/** Unidades ativas que o colaborador lidera (diretoria / departamento). */
export async function loadEmployeeOrgLeadership(
  db: Db,
  employeeId: string | null | undefined
) {
  if (!employeeId || !isUuid(employeeId)) {
    return buildEmployeeOrgLeadershipSummary({
      employeeId: "",
      ledDirectorates: [],
      ledDepartments: [],
    });
  }
  const id = employeeId.trim();
  const [ledDirectorates, ledDepartments] = await Promise.all([
    db.hrDirectorate.findMany({
      where: { leaderEmployeeId: id, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.hrDepartment.findMany({
      where: { leaderEmployeeId: id, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return buildEmployeeOrgLeadershipSummary({
    employeeId: id,
    ledDirectorates,
    ledDepartments,
  });
}

/**
 * Líderes oficiais não ficam alocados como membros de departamento —
 * aparecem só no organograma na posição de liderança.
 */
export async function clearEmployeeMemberDepartmentForOrgLeader(
  db: Db,
  leaderEmployeeId: string,
  unitLabel: string
) {
  if (!isUuid(leaderEmployeeId)) return;
  const label = unitLabel.trim() || "Liderança organizacional";
  await db.employee.updateMany({
    where: { id: leaderEmployeeId.trim() },
    data: {
      departmentId: null,
      department: label,
      managerId: null,
      managerName: null,
    },
  });
}

/** Mapa employeeId → resumo de liderança (lote, para listagens). */
export async function loadOrgLeadershipByEmployeeId(db: Db) {
  const [dirs, depts] = await Promise.all([
    db.hrDirectorate.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, leaderEmployeeId: true },
    }),
    db.hrDepartment.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, leaderEmployeeId: true },
    }),
  ]);
  const byEmployee = new Map<
    string,
    { directorates: { id: string; name: string }[]; departments: { id: string; name: string }[] }
  >();
  for (const d of dirs) {
    const bucket = byEmployee.get(d.leaderEmployeeId) ?? {
      directorates: [],
      departments: [],
    };
    bucket.directorates.push({ id: d.id, name: d.name });
    byEmployee.set(d.leaderEmployeeId, bucket);
  }
  for (const d of depts) {
    const bucket = byEmployee.get(d.leaderEmployeeId) ?? {
      directorates: [],
      departments: [],
    };
    bucket.departments.push({ id: d.id, name: d.name });
    byEmployee.set(d.leaderEmployeeId, bucket);
  }
  const result = new Map<
    string,
    ReturnType<typeof buildEmployeeOrgLeadershipSummary>
  >();
  for (const [employeeId, bucket] of byEmployee) {
    result.set(
      employeeId,
      buildEmployeeOrgLeadershipSummary({
        employeeId,
        ledDirectorates: bucket.directorates,
        ledDepartments: bucket.departments,
      })
    );
  }
  return result;
}
