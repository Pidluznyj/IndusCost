/**
 * Seed idempotente do catálogo relacional de permissões.
 *
 * Uso:
 *   npm run permissions:seed
 *   npm run permissions:seed -- --dry-run
 *   npm run permissions:seed -- --sync-role-defaults
 *   npm run permissions:seed -- --catalog-only
 *   npx tsx scripts/seedPermissionResources.ts
 *
 * - Upsert PermissionResource (sistema).
 * - Garante RolePermission (SUPER_ADMIN sempre full; demais: create-only por padrão).
 * - Nunca apaga RolePermission / UserPermissionOverride / AppUser.permissions.
 * - Não cria usuário; apenas alerta se não houver SUPER_ADMIN ativo.
 * - Não roda migrate.
 * - --catalog-only: valida o catálogo em código e lista o plano, sem tocar no banco.
 */
import "dotenv/config";
import { PrismaClient, type AppUserRole } from "@prisma/client";
import {
  buildRolePermissionSeeds,
  shouldUpdateExistingRolePermission,
  sortPermissionResourcesForInsert,
  validatePermissionResourceCatalog,
  listPermissionResourceKeys,
} from "../src/lib/permissionResourceSeedData.ts";
import { validatePermissionsCatalogSetup } from "../src/lib/security/permissionsSetupValidation.ts";

let prisma: PrismaClient | null = null;

function db(): PrismaClient {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function runCatalogOnly(): void {
  const report = validatePermissionsCatalogSetup();
  const issues = validatePermissionResourceCatalog();
  console.log(
    `seedPermissionResources --catalog-only resources=${listPermissionResourceKeys().length} ok=${report.ok}`
  );
  for (const c of report.checks.filter((x) => x.severity !== "ok")) {
    console.log(`[${c.severity}] ${c.code}: ${c.message}`);
  }
  if (issues.length > 0 || !report.ok) {
    throw new Error(
      `Catálogo inválido: ${(issues.length ? issues : report.checks.filter((c) => c.severity === "error"))
        .map((i) => ("code" in i ? `${i.code}:${i.message}` : String(i)))
        .join("; ")}`
    );
  }
  const sorted = sortPermissionResourcesForInsert();
  console.log(`[plan] PermissionResource upserts: ${sorted.length}`);
  console.log(`[plan] RolePermission seeds: ${buildRolePermissionSeeds().length}`);
  console.log(
    JSON.stringify(
      {
        catalogOnly: true,
        ok: true,
        resourceKeys: sorted.map((r) => r.key),
        note: "Nenhuma escrita no banco. Remova --catalog-only e configure DATABASE_URL para aplicar.",
      },
      null,
      2
    )
  );
}

async function seedResources(dryRun: boolean): Promise<{ created: number; updated: number }> {
  const issues = validatePermissionResourceCatalog();
  if (issues.length > 0) {
    throw new Error(`Catálogo inválido: ${issues.map((i) => `${i.code}:${i.message}`).join("; ")}`);
  }

  let created = 0;
  let updated = 0;
  for (const row of sortPermissionResourcesForInsert()) {
    const existing = await db().permissionResource.findUnique({ where: { key: row.key } });
    const data = {
      label: row.label,
      description: row.description,
      type: row.type,
      parentKey: row.parentKey,
      module: row.module,
      sortOrder: row.sortOrder,
      isSystem: true as const,
      isActive: true,
    };
    if (!existing) {
      if (!dryRun) {
        await db().permissionResource.create({
          data: { key: row.key, ...data },
        });
      }
      created += 1;
      console.log(`[resource] CREATE ${row.key}`);
    } else {
      if (!dryRun) {
        await db().permissionResource.update({
          where: { key: row.key },
          data,
        });
      }
      updated += 1;
      console.log(`[resource] UPDATE ${row.key}`);
    }
  }
  return { created, updated };
}

async function seedRolePermissions(
  dryRun: boolean,
  syncRoleDefaults: boolean
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of buildRolePermissionSeeds()) {
    const existing = await db().rolePermission.findUnique({
      where: {
        role_resourceKey: { role: row.role, resourceKey: row.resourceKey },
      },
    });
    const flags = {
      canView: row.canView,
      canExecute: row.canExecute,
      canManage: row.canManage,
    };

    if (!existing) {
      if (!dryRun) {
        await db().rolePermission.create({
          data: {
            role: row.role,
            resourceKey: row.resourceKey,
            ...flags,
          },
        });
      }
      created += 1;
      console.log(`[role] CREATE ${row.role} ${row.resourceKey}`);
      continue;
    }

    if (
      !shouldUpdateExistingRolePermission({
        role: row.role as AppUserRole,
        syncRoleDefaults,
      })
    ) {
      skipped += 1;
      continue;
    }

    if (!dryRun) {
      await db().rolePermission.update({
        where: { id: existing.id },
        data: flags,
      });
    }
    updated += 1;
    console.log(`[role] UPDATE ${row.role} ${row.resourceKey}`);
  }

  return { created, updated, skipped };
}

async function assertSuperAdminPresence(): Promise<{
  activeSuperAdmins: number;
  totalUsers: number;
}> {
  const [activeSuperAdmins, totalUsers] = await Promise.all([
    db().appUser.count({ where: { role: "SUPER_ADMIN", isActive: true } }),
    db().appUser.count(),
  ]);

  if (activeSuperAdmins === 0) {
    const msg =
      totalUsers === 0
        ? "Nenhum AppUser no banco — crie um SUPER_ADMIN via bootstrap/admin antes de depender do ACL relacional."
        : "Nenhum SUPER_ADMIN ativo encontrado. Corrija manualmente; o seed não cria usuários nem senhas.";
    if (process.env.PERMISSION_SEED_REQUIRE_SUPER_ADMIN === "1") {
      throw new Error(msg);
    }
    console.warn(`[warn] ${msg}`);
  } else {
    console.log(`[ok] SUPER_ADMIN ativos: ${activeSuperAdmins}`);
  }

  return { activeSuperAdmins, totalUsers };
}

async function writeSeedAuditLog(dryRun: boolean, summary: Record<string, unknown>): Promise<void> {
  if (dryRun) return;
  await db().permissionAuditLog.create({
    data: {
      action: "SEED_PERMISSION_RESOURCES",
      resourceKey: null,
      beforeJson: undefined,
      afterJson: summary,
    },
  });
}

async function main(): Promise<void> {
  const dryRun = hasFlag("--dry-run");
  const syncRoleDefaults = hasFlag("--sync-role-defaults");
  const catalogOnly = hasFlag("--catalog-only");

  if (catalogOnly) {
    runCatalogOnly();
    return;
  }

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      "DATABASE_URL ausente. Use `npm run permissions:seed -- --catalog-only` para validar sem banco, ou configure .env."
    );
  }

  console.log(
    `seedPermissionResources dryRun=${dryRun} syncRoleDefaults=${syncRoleDefaults}`
  );

  const resources = await seedResources(dryRun);
  const roles = await seedRolePermissions(dryRun, syncRoleDefaults);
  const superAdmin = await assertSuperAdminPresence();

  const summary = {
    dryRun,
    syncRoleDefaults,
    resources,
    roles,
    superAdmin,
    note: "Não altera AppUser.permissions[], AccessProfile nem UserPermissionOverride.",
  };

  await writeSeedAuditLog(dryRun, summary);
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
