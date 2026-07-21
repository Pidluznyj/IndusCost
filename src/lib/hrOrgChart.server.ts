/**
 * Carrega dados do organograma RH a partir da estrutura oficial.
 */
import type { PrismaClient } from "@prisma/client";
import { buildHrOrgChart, type HrOrgChartRoot } from "@/src/lib/hrOrgChart.js";

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
        Role: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return buildHrOrgChart({
    organizationName: options?.organizationName ?? "Organização",
    includeInactiveUnits: options?.includeInactiveUnits === true,
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
