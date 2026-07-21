/**
 * Organograma RH — árvore visual a partir de Diretoria → Departamento → Pessoas.
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
  leader: HrOrgChartPerson | null;
  departments: HrOrgChartDepartmentNode[];
  peopleCount: number;
};

export type HrOrgChartRoot = {
  kind: "organization";
  name: string;
  generatedAt: string;
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
    if (emp.departmentId) {
      const list = employeesByDepartment.get(emp.departmentId) ?? [];
      list.push(emp);
      employeesByDepartment.set(emp.departmentId, list);
    } else {
      const person = toPerson(emp, false);
      if (person) unassigned.push(person);
    }
  }

  const directorates: HrOrgChartDirectorateNode[] = activeDirectorates
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((dir) => {
      const deptInputs = (departmentsByDirectorate.get(dir.id) ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

      const departments: HrOrgChartDepartmentNode[] = deptInputs.map((dept) => {
        const leader = toPerson(byId.get(dept.leaderEmployeeId), true);
        const rawMembers = employeesByDepartment.get(dept.id) ?? [];
        const members = rawMembers
          .filter((m) => m.id !== dept.leaderEmployeeId)
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

      return {
        id: dir.id,
        kind: "directorate" as const,
        name: dir.name,
        code: dir.code,
        status: dir.status,
        leader: toPerson(byId.get(dir.leaderEmployeeId), true),
        departments,
        peopleCount,
      };
    });

  const departmentCount = directorates.reduce((s, d) => s + d.departments.length, 0);
  const peopleInTree = directorates.reduce((s, d) => s + d.peopleCount, 0);

  return {
    kind: "organization",
    name: (input.organizationName ?? "Organização").trim() || "Organização",
    generatedAt: new Date().toISOString(),
    directorates,
    unassigned: unassigned.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    totals: {
      directorates: directorates.length,
      departments: departmentCount,
      people: peopleInTree,
      unassigned: unassigned.length,
    },
  };
}
