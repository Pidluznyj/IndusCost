/**
 * Organograma RH — árvore visual a partir de Diretoria (aninhada) → Departamento → Pessoas.
 */

export type HrOrgChartPerson = {
  id: string;
  name: string;
  socialName: string | null;
  roleName: string | null;
  status: string;
  isLeader: boolean;
};

export type HrOrgChartDepartmentNode = {
  id: string;
  kind: "department";
  name: string;
  code: string | null;
  status: string;
  leader: HrOrgChartPerson | null;
  members: HrOrgChartPerson[];
  memberCount: number;
};

export type HrOrgChartDirectorateNode = {
  id: string;
  kind: "directorate";
  name: string;
  code: string | null;
  status: string;
  parentDirectorateId: string | null;
  leader: HrOrgChartPerson | null;
  departments: HrOrgChartDepartmentNode[];
  childDirectorates: HrOrgChartDirectorateNode[];
  peopleCount: number;
};

export type HrOrgChartRoot = {
  kind: "organization";
  name: string;
  generatedAt: string;
  /** Diretorias raiz (sem vínculo ou cujo superior não está no conjunto ativo). */
  directorates: HrOrgChartDirectorateNode[];
  unassigned: HrOrgChartPerson[];
  totals: {
    directorates: number;
    departments: number;
    people: number;
    unassigned: number;
  };
};

export type HrOrgChartEmployeeInput = {
  id: string;
  name: string;
  socialName: string | null;
  status: string | null;
  departmentId: string | null;
  roleName: string | null;
};

export type HrOrgChartDepartmentInput = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  directorateId: string;
  leaderEmployeeId: string;
};

export type HrOrgChartDirectorateInput = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  leaderEmployeeId: string;
  parentDirectorateId?: string | null;
};

function toPerson(
  row: HrOrgChartEmployeeInput | undefined,
  isLeader: boolean
): HrOrgChartPerson | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    socialName: row.socialName,
    roleName: row.roleName,
    status: (row.status ?? "ACTIVE").toUpperCase(),
    isLeader,
  };
}

function displayName(person: HrOrgChartPerson): string {
  return person.socialName?.trim() || person.name;
}

export function hrOrgChartPersonLabel(person: HrOrgChartPerson): string {
  return displayName(person);
}

function countDirectoratesInTree(nodes: readonly HrOrgChartDirectorateNode[]): number {
  return nodes.reduce(
    (sum, n) => sum + 1 + countDirectoratesInTree(n.childDirectorates),
    0
  );
}

function countDepartmentsInTree(nodes: readonly HrOrgChartDirectorateNode[]): number {
  return nodes.reduce(
    (sum, n) =>
      sum + n.departments.length + countDepartmentsInTree(n.childDirectorates),
    0
  );
}

function countPeopleInTree(nodes: readonly HrOrgChartDirectorateNode[]): number {
  return nodes.reduce(
    (sum, n) => sum + n.peopleCount + countPeopleInTree(n.childDirectorates),
    0
  );
}

export function buildHrOrgChart(input: {
  organizationName?: string;
  directorates: readonly HrOrgChartDirectorateInput[];
  departments: readonly HrOrgChartDepartmentInput[];
  employees: readonly HrOrgChartEmployeeInput[];
  includeInactiveUnits?: boolean;
}): HrOrgChartRoot {
  const includeInactive = input.includeInactiveUnits === true;
  const byId = new Map(input.employees.map((e) => [e.id, e]));

  const activeDirectorates = input.directorates.filter(
    (d) => includeInactive || d.status === "ACTIVE"
  );
  const activeDepartments = input.departments.filter(
    (d) => includeInactive || d.status === "ACTIVE"
  );
  const activeDirIds = new Set(activeDirectorates.map((d) => d.id));

  /** Líderes oficiais já aparecem no organograma — não entram como membro nem em "sem departamento". */
  const orgLeaderIds = new Set<string>();
  for (const dir of activeDirectorates) {
    if (dir.leaderEmployeeId) orgLeaderIds.add(dir.leaderEmployeeId);
  }
  for (const dept of activeDepartments) {
    if (dept.leaderEmployeeId) orgLeaderIds.add(dept.leaderEmployeeId);
  }

  const departmentsByDirectorate = new Map<string, HrOrgChartDepartmentInput[]>();
  for (const dept of activeDepartments) {
    const list = departmentsByDirectorate.get(dept.directorateId) ?? [];
    list.push(dept);
    departmentsByDirectorate.set(dept.directorateId, list);
  }

  const employeesByDepartment = new Map<string, HrOrgChartEmployeeInput[]>();
  const unassigned: HrOrgChartPerson[] = [];
  for (const emp of input.employees) {
    if ((emp.status ?? "ACTIVE").toUpperCase() !== "ACTIVE") continue;
    if (orgLeaderIds.has(emp.id)) continue;
    if (emp.departmentId) {
      const list = employeesByDepartment.get(emp.departmentId) ?? [];
      list.push(emp);
      employeesByDepartment.set(emp.departmentId, list);
    } else {
      const person = toPerson(emp, false);
      if (person) unassigned.push(person);
    }
  }

  const nodeById = new Map<string, HrOrgChartDirectorateNode>();
  for (const dir of activeDirectorates) {
    const deptInputs = (departmentsByDirectorate.get(dir.id) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    const departments: HrOrgChartDepartmentNode[] = deptInputs.map((dept) => {
      const leader = toPerson(byId.get(dept.leaderEmployeeId), true);
      const rawMembers = employeesByDepartment.get(dept.id) ?? [];
      const members = rawMembers
        .filter((m) => m.id !== dept.leaderEmployeeId && !orgLeaderIds.has(m.id))
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        .map((m) => toPerson(m, false)!)
        .filter(Boolean);
      return {
        id: dept.id,
        kind: "department" as const,
        name: dept.name,
        code: dept.code,
        status: dept.status,
        leader,
        members,
        memberCount: members.length + (leader ? 1 : 0),
      };
    });

    const peopleCount = departments.reduce((sum, d) => sum + d.memberCount, 0);
    const parentId = dir.parentDirectorateId?.trim() || null;

    nodeById.set(dir.id, {
      id: dir.id,
      kind: "directorate",
      name: dir.name,
      code: dir.code,
      status: dir.status,
      parentDirectorateId:
        parentId && activeDirIds.has(parentId) ? parentId : null,
      leader: toPerson(byId.get(dir.leaderEmployeeId), true),
      departments,
      childDirectorates: [],
      peopleCount,
    });
  }

  const roots: HrOrgChartDirectorateNode[] = [];
  for (const node of nodeById.values()) {
    const parentId = node.parentDirectorateId;
    if (parentId && nodeById.has(parentId)) {
      nodeById.get(parentId)!.childDirectorates.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortTree = (nodes: HrOrgChartDirectorateNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    for (const n of nodes) sortTree(n.childDirectorates);
  };
  sortTree(roots);

  return {
    kind: "organization",
    name: (input.organizationName ?? "Organização").trim() || "Organização",
    generatedAt: new Date().toISOString(),
    directorates: roots,
    unassigned: unassigned.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    totals: {
      directorates: countDirectoratesInTree(roots),
      departments: countDepartmentsInTree(roots),
      people: countPeopleInTree(roots),
      unassigned: unassigned.length,
    },
  };
}
