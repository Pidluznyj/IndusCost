/**
 * Carrega dados do organograma RH a partir da estrutura oficial.
 */
import type { PrismaClient } from "@prisma/client";
import { buildHrOrgChart, type HrOrgChartRoot } from "@/src/lib/hrOrgChart.js";
import { buildOrgHierarchy } from "@/src/lib/orgHierarchy.js";

type Db = Pick<PrismaClient, "hrDirectorate" | "hrDepartment" | "employee">;

export async function loadHrOrgChart(
  db: Db,
  options?: { includeInactiveUnits?: boolean; organizationName?: string }
): Promise<HrOrgChartRoot> {
  const [directorates, departments, employees] = await Promise.all([
    db.hrDirectorate.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        leaderEmployeeId: true,
        parentDirectorateId: true,
      },
      orderBy: { name: "asc" },
    }),
    db.hrDepartment.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        directorateId: true,
        leaderEmployeeId: true,
        parentDepartmentId: true,
      },
      orderBy: { name: "asc" },
    }),
    db.employee.findMany({
      select: {
        id: true,
        name: true,
        socialName: true,
        status: true,
        departmentId: true,
        managerId: true,
        Role: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Mesma fonte de Pessoas/RH e Desempenho, com as linhas já carregadas (sem nova consulta).
  const hierarchy = buildOrgHierarchy({ employees, directorates, departments });

  return buildHrOrgChart({
    organizationName: options?.organizationName ?? "Lazarios Koppetel",
    includeInactiveUnits: options?.includeInactiveUnits === true,
    superiorOf: (employeeId) => {
      const r = hierarchy.resolve(employeeId);
      if (r.status === "RESOLVED") return { resolved: true, pending: false, name: r.managerName, text: r.message };
      return { resolved: false, pending: r.status !== "TOP", name: null, text: r.message };
    },
    directorates,
    departments,
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
      socialName: e.socialName,
      status: e.status,
      departmentId: e.departmentId,
      roleName: e.Role?.name ?? null,
    })),
  });
}
