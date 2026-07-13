/**
 * Validação operacional do setup de permissões.
 *
 * Uso:
 *   npx tsx scripts/validatePermissionsSetup.ts
 *   npx tsx scripts/validatePermissionsSetup.ts --catalog-only
 *   npx tsx scripts/validatePermissionsSetup.ts --audit
 *   npx tsx scripts/validatePermissionsSetup.ts --json
 *
 * Sem DATABASE_URL (ou com --catalog-only): valida só o catálogo em código.
 * Com banco: também confere tabelas relacionais, órfãos e SUPER_ADMIN ativo.
 *
 * Exit 1 se houver severity=error (exceto --audit, que só reporta).
 */
import "dotenv/config";
import {
  validatePermissionsCatalogSetup,
  validatePermissionsDbSnapshot,
  type PermissionsSetupCheck,
} from "../src/lib/security/permissionsSetupValidation.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function printChecks(checks: PermissionsSetupCheck[]): void {
  for (const c of checks) {
    const tag =
      c.severity === "error" ? "ERROR" : c.severity === "warn" ? "WARN" : "OK";
    console.log(`[${tag}] ${c.code}: ${c.message}`);
  }
}

async function loadDbSnapshot(): Promise<{
  ok: true;
  snap: Parameters<typeof validatePermissionsDbSnapshot>[0];
  orphanParents: PermissionsSetupCheck[];
} | { ok: false; reason: string }> {
  if (!process.env.DATABASE_URL?.trim()) {
    return { ok: false, reason: "DATABASE_URL ausente." };
  }

  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const [resources, rolePermissions, overrides, activeSuperAdminCount] =
        await Promise.all([
          prisma.permissionResource.findMany({
            select: { key: true, parentKey: true },
          }),
          prisma.rolePermission.findMany({
            select: { role: true, resourceKey: true },
          }),
          prisma.userPermissionOverride.findMany({
            select: { resourceKey: true },
          }),
          prisma.appUser.count({
            where: { role: "SUPER_ADMIN", isActive: true },
          }),
        ]);

      const dbKeys = new Set(resources.map((r) => r.key));
      const orphanParents: PermissionsSetupCheck[] = [];
      for (const r of resources) {
        if (r.parentKey && !dbKeys.has(r.parentKey)) {
          orphanParents.push({
            severity: "error",
            code: "DB_ORPHAN_RESOURCE",
            message: `${r.key} → parent inválido ${r.parentKey}`,
          });
        }
      }

      // SUPER_ADMIN rows must be full access
      const saRows = await prisma.rolePermission.findMany({
        where: { role: "SUPER_ADMIN" },
      });
      for (const row of saRows) {
        if (!row.canView || !row.canExecute || !row.canManage) {
          orphanParents.push({
            severity: "error",
            code: "DB_SUPER_ADMIN_NOT_FULL",
            message: `RolePermission SUPER_ADMIN incompleto em ${row.resourceKey}`,
          });
        }
      }

      return {
        ok: true,
        snap: {
          resourceKeys: resources.map((r) => r.key),
          rolePermissions: rolePermissions.map((r) => ({
            role: r.role,
            resourceKey: r.resourceKey,
          })),
          overrides: overrides.map((o) => ({ resourceKey: o.resourceKey })),
          activeSuperAdminCount,
        },
        orphanParents,
      };
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Falha ao ler banco: ${msg}` };
  }
}

async function main(): Promise<void> {
  const catalogOnly = hasFlag("--catalog-only");
  const audit = hasFlag("--audit");
  const asJson = hasFlag("--json");

  const catalog = validatePermissionsCatalogSetup();
  const allChecks: PermissionsSetupCheck[] = [...catalog.checks];
  let dbStatus: "skipped" | "ok" | "unavailable" = "skipped";
  let dbReason: string | undefined;

  if (!catalogOnly) {
    const db = await loadDbSnapshot();
    if (!db.ok) {
      dbStatus = "unavailable";
      dbReason = db.reason;
      allChecks.push({
        severity: audit || catalogOnly ? "warn" : "warn",
        code: "DB_SKIPPED",
        message: `${db.reason} Validação de banco ignorada (use DATABASE_URL ou --catalog-only).`,
      });
    } else {
      dbStatus = "ok";
      allChecks.push(...validatePermissionsDbSnapshot(db.snap));
      allChecks.push(...db.orphanParents);
    }
  } else {
    allChecks.push({
      severity: "ok",
      code: "DB_SKIPPED",
      message: "Modo --catalog-only: banco não consultado.",
    });
  }

  const hasError = allChecks.some((c) => c.severity === "error");
  const summary = {
    ok: !hasError,
    mode: catalogOnly ? "catalog-only" : "full",
    audit,
    dbStatus,
    dbReason,
    catalogResourceCount: catalog.catalogResourceCount,
    errorCount: allChecks.filter((c) => c.severity === "error").length,
    warnCount: allChecks.filter((c) => c.severity === "warn").length,
    checks: allChecks,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      `validatePermissionsSetup mode=${summary.mode} db=${dbStatus} ok=${summary.ok}`
    );
    printChecks(allChecks);
    console.log(
      JSON.stringify(
        {
          ok: summary.ok,
          catalogResourceCount: summary.catalogResourceCount,
          errorCount: summary.errorCount,
          warnCount: summary.warnCount,
          dbStatus,
        },
        null,
        2
      )
    );
  }

  // Em --audit, exit 0 para uso em inventário; erros ainda saem no relatório.
  if (hasError && !audit) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
