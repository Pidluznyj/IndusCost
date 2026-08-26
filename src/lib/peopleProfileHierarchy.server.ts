/**
 * Hierarquia de gestores — CTE PostgreSQL (sem recursão N+1).
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { wouldCreateManagerCycle, type ManagerLink } from "./peopleProfileAccess.js";

type SqlClient = Pick<PrismaClient, "$queryRaw">;

export async function loadDescendantEmployeeIds(
  prisma: SqlClient,
  managerEmployeeId: string
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE tree AS (
      SELECT e.id, e."managerId", 1 AS depth
      FROM "Employee" e
      WHERE e."managerId" = ${managerEmployeeId}::uuid
      UNION ALL
      SELECT child.id, child."managerId", tree.depth + 1
      FROM "Employee" child
      INNER JOIN tree ON child."managerId" = tree.id
      WHERE tree.depth < 50
        AND child.id <> ${managerEmployeeId}::uuid
    )
    SELECT DISTINCT id FROM tree
  `);
  return rows.map((row) => row.id);
}

export async function loadDirectReportIds(
  prisma: PrismaClient,
  managerEmployeeId: string
): Promise<string[]> {
  const rows = await prisma.employee.findMany({
    where: { managerId: managerEmployeeId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
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
