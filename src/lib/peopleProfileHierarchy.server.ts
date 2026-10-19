/**
 * Hierarquia de gestores. Equipe e descendentes vêm da hierarquia efetiva (`orgHierarchy`);
 * a checagem de ciclo do gestor explícito continua por CTE PostgreSQL.
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { wouldCreateManagerCycle, type ManagerLink } from "./peopleProfileAccess.js";
import { loadOrgHierarchy, type OrgHierarchyDb } from "./orgHierarchy.server.js";

type SqlClient = Pick<PrismaClient, "$queryRaw">;

/**
 * Toda a árvore abaixo do líder pela hierarquia efetiva (gestor do cadastro + liderança das
 * unidades). Inclui líderes de unidades subordinadas, que têm `managerId` nulo por regra.
 */
export async function loadDescendantEmployeeIds(
  prisma: OrgHierarchyDb,
  managerEmployeeId: string
): Promise<string[]> {
  return (await loadOrgHierarchy(prisma)).descendants(managerEmployeeId);
}

/** Equipe direta pela hierarquia efetiva (mesma regra de `loadDescendantEmployeeIds`). */
export async function loadDirectReportIds(
  prisma: OrgHierarchyDb,
  managerEmployeeId: string
): Promise<string[]> {
  return (await loadOrgHierarchy(prisma)).directReports(managerEmployeeId);
}

export async function loadManagerLinks(prisma: PrismaClient): Promise<ManagerLink[]> {
  const rows = await prisma.employee.findMany({
    select: { id: true, managerId: true },
  });
  return rows.map((row) => ({ id: row.id, managerId: row.managerId }));
}

export async function managerChainContainsEmployee(
  prisma: SqlClient,
  proposedManagerId: string,
  employeeId: string
): Promise<boolean> {
  if (proposedManagerId === employeeId) return true;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE up AS (
      SELECT e.id, e."managerId", 1 AS depth
      FROM "Employee" e
      WHERE e.id = ${proposedManagerId}::uuid
      UNION ALL
      SELECT parent.id, parent."managerId", up.depth + 1
      FROM "Employee" parent
      INNER JOIN up ON parent.id = up."managerId"
      WHERE up.depth < 50
        AND up."managerId" IS NOT NULL
    )
    SELECT id FROM up WHERE id = ${employeeId}::uuid
  `);
  return rows.length > 0;
}

export async function assertNoManagerCycleCte(
  prisma: SqlClient,
  employeeId: string,
  managerId: string | null
): Promise<void> {
  if (!managerId) return;
  if (await managerChainContainsEmployee(prisma, managerId, employeeId)) {
    const err = new Error("Ciclo hierárquico inválido.");
    (err as { code?: string }).code = "MANAGER_CYCLE";
    throw err;
  }
}

/** Fallback testável com grafo já carregado. */
export function assertNoManagerCycleGraph(
  links: readonly ManagerLink[],
  employeeId: string,
  managerId: string | null
): void {
  if (wouldCreateManagerCycle(links, employeeId, managerId)) {
    const err = new Error("Ciclo hierárquico inválido.");
    (err as { code?: string }).code = "MANAGER_CYCLE";
    throw err;
  }
}
