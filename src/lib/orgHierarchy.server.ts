/**
 * Carrega a hierarquia efetiva (pessoas + unidades) em três consultas e resolve em memória.
 * Fonte única para equipe direta, descendentes e superior efetivo (ver `orgHierarchy.ts`).
 */
import type { PrismaClient } from "@prisma/client";
import { buildOrgHierarchy, MANAGER_WARNING_LABELS, type EffectiveManagerResolution, type OrgHierarchy } from "./orgHierarchy.js";

export type OrgHierarchyDb = {
  employee: Pick<PrismaClient["employee"], "findMany">;
  hrDirectorate: Pick<PrismaClient["hrDirectorate"], "findMany">;
  hrDepartment: Pick<PrismaClient["hrDepartment"], "findMany">;
};

export async function loadOrgHierarchy(db: OrgHierarchyDb): Promise<OrgHierarchy> {
  const [employees, directorates, departments] = await Promise.all([
    db.employee.findMany({
      select: { id: true, name: true, socialName: true, status: true, departmentId: true, managerId: true },
    }),
    db.hrDirectorate.findMany({
      select: { id: true, name: true, status: true, leaderEmployeeId: true, parentDirectorateId: true },
    }),
    db.hrDepartment.findMany({
      select: { id: true, name: true, status: true, directorateId: true, leaderEmployeeId: true, parentDepartmentId: true },
    }),
  ]);
  return buildOrgHierarchy({ employees, directorates, departments });
}

export async function loadEffectiveManager(db: OrgHierarchyDb, employeeId: string): Promise<EffectiveManagerResolution> {
  return (await loadOrgHierarchy(db)).resolve(employeeId);
}

/**
 * Líder a usar numa atribuição (ex.: avaliação de desempenho). Só resoluções válidas viram
 * líder; topo, pendência, ambiguidade e ciclo ficam sem líder e com o motivo em texto.
 */
export function assignableManager(r: EffectiveManagerResolution): {
  managerId: string | null;
  managerName: string | null;
  fromOrgChart: boolean;
  note: string | null;
} {
  if (r.status === "RESOLVED" && r.managerId && r.managerId !== r.employeeId) {
    return {
      managerId: r.managerId,
      managerName: r.managerName,
      fromOrgChart: r.source !== "EXPLICIT_MANAGER",
      note: r.warnings.length > 0 ? r.warnings.map((w) => MANAGER_WARNING_LABELS[w]).join(" ") : null,
    };
  }
  return { managerId: null, managerName: null, fromOrgChart: false, note: r.message };
}
