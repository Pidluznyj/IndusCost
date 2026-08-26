/**
 * Backfill idempotente de baseline histórico da ficha funcional.
 * Não inventa promoção/reajuste. Apenas INITIAL_STATE com o snapshot conhecido.
 *
 * Uso:
 *   npx tsx scripts/backfill-hr-employee-history.ts --dry-run
 *   npx tsx scripts/backfill-hr-employee-history.ts --preview
 *   npx tsx scripts/backfill-hr-employee-history.ts --apply --confirm-apply=HR_EMPLOYEE_HISTORY_INITIAL_STATE
 */

import { prisma } from "../src/lib/prisma.js";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

async function main() {
  const dryRun = hasFlag("--dry-run") || hasFlag("--preview") || !hasFlag("--apply");
  const confirm = argValue("--confirm-apply");
  if (!dryRun && confirm !== "HR_EMPLOYEE_HISTORY_INITIAL_STATE") {
    console.error("Apply exige --confirm-apply=HR_EMPLOYEE_HISTORY_INITIAL_STATE");
    process.exit(1);
  }

  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      roleId: true,
      department: true,
      departmentId: true,
      costCenter: true,
      costCenterId: true,
      managerId: true,
      managerName: true,
      contractType: true,
      workSchedule: true,
      status: true,
      Role: { select: { name: true } },
      manager: { select: { name: true, socialName: true } },
    },
  });

  const existing = await prisma.hrEmployeeHistory.findMany({
    where: { eventType: "INITIAL_STATE" },
    select: { employeeId: true },
  });
  const already = new Set(existing.map((r) => r.employeeId));
  const pending = employees.filter((e) => !already.has(e.id));

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "apply",
        totalEmployees: employees.length,
        alreadyWithInitialState: already.size,
        wouldInsert: pending.length,
      },
      null,
      2
    )
  );

  if (dryRun) return;

  let inserted = 0;
  for (const emp of pending) {
    try {
      await prisma.hrEmployeeHistory.create({
        data: {
          employeeId: emp.id,
          eventType: "INITIAL_STATE",
          effectiveDate: new Date(),
          source: "MIGRATION",
          newRoleId: emp.roleId,
          newRoleName: emp.Role?.name ?? null,
          newDepartmentId: emp.departmentId,
          newDepartment: emp.department,
          newCostCenterId: emp.costCenterId,
          newCostCenter: emp.costCenter,
          newManagerId: emp.managerId,
          newManagerName: emp.manager
            ? (emp.manager.socialName ?? "").trim() || emp.manager.name
            : emp.managerName,
          newContractType: emp.contractType,
          newWorkSchedule: emp.workSchedule,
          newStatus: emp.status,
        },
      });
      inserted += 1;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "P2002") continue;
      throw error;
    }
  }
  console.log(JSON.stringify({ inserted }, null, 2));
}

main()
  .catch((error) => {
    console.error("backfill-hr-employee-history", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
