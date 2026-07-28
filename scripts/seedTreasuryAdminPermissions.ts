/**
 * Seed aditivo ADMIN × finance.treasury* (ativação da Tesouraria).
 *
 * Uso:
 *   npm run treasury:permissions:seed              # dry-run (padrão)
 *   npm run treasury:permissions:seed -- --dry-run
 *   npm run treasury:permissions:seed -- --apply
 *
 * - Create-only (não atualiza RolePermission existente).
 * - Não toca outros papéis, UserPermissionOverride, AccessProfile, AppUser.permissions.
 * - Não executar --apply em produção sem revisão do dry-run.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  createPrismaTreasuryAdminPermissionSeedPort,
  formatTreasuryAdminPermissionSeedReport,
  runTreasuryAdminPermissionSeed,
  TreasuryAdminPermissionSeedError,
} from "../src/lib/treasury/treasuryAdminPermissionSeed.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const apply = hasFlag("--apply");
  const forceDry = hasFlag("--dry-run");
  const dryRun = forceDry || !apply;

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      "DATABASE_URL ausente. Configure .env para dry-run/apply com banco, ou use testes unitários do seed restrito."
    );
  }

  const prisma = new PrismaClient();
  try {
    const port = createPrismaTreasuryAdminPermissionSeedPort(prisma);
    const report = await runTreasuryAdminPermissionSeed({ port, dryRun });
    console.log(formatTreasuryAdminPermissionSeedReport(report));
    console.log(
      JSON.stringify(
        {
          dryRun: report.dryRun,
          applied: report.applied,
          role: report.plan.role,
          resourceKeyCount: report.plan.resourceKeys.length,
          resourcesFound: report.plan.resourcesFound,
          resourcesToCreate: report.plan.resourcesToCreate.map((r) => r.key),
          rolePermissionsExisting: report.plan.rolePermissionsExisting.map(
            (r) => r.resourceKey
          ),
          rolePermissionsToCreate: report.plan.rolePermissionsToCreate.map(
            (r) => r.resourceKey
          ),
          resourcesCreated: report.resourcesCreated,
          rolePermissionsCreated: report.rolePermissionsCreated,
          rolePermissionsSkipped: report.rolePermissionsSkipped,
          auditWritten: report.auditWritten,
          otherRolesUntouched: report.plan.otherRolesUntouched,
          userOverridesUntouched: report.plan.userOverridesUntouched,
          note: report.note,
        },
        null,
        2
      )
    );
  } catch (err) {
    if (err instanceof TreasuryAdminPermissionSeedError) {
      console.error(`[treasury:permissions:seed] ${err.code}: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
