/**
 * Inventário read-only — auth / roles / catálogo / menu / abas PR.
 *
 * Uso:
 *   npx tsx scripts/inspectPermissionsCurrentState.ts
 *
 * Espelho sugerido (gitignore): tmp-audits/inspect-permissions-current-state.ts
 * Não altera banco. Não chama Nomus.
 */
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  type PermissionCatalogEntry,
} from "../src/lib/permissionCatalog.ts";
import { SIDEBAR_MODULE_ORDER, MODULE_LABELS } from "../src/lib/modulePermissions.ts";
import {
  MODULE_MENU_PERMISSION_KEYS,
  NAVIGATION_GROUP_DEFINITIONS,
  getModulePath,
} from "../src/lib/navigationGroups.ts";
import {
  FINANCE_PORTFOLIO_RECONCILIATION_VIEW,
  FINANCE_PORTFOLIO_RECONCILIATION_CONCILIATION_VIEW,
  FINANCE_PORTFOLIO_RECONCILIATION_INTELLIGENCE_VIEW,
  FINANCE_PORTFOLIO_RECONCILIATION_ORDER_TO_CASH_AUDIT_VIEW,
  FINANCE_PORTFOLIO_RECONCILIATION_LEGACY_VIEW_PERMISSIONS,
} from "../src/lib/financePortfolioReconciliationPermissions.ts";
import { APP_USER_ROLE_VALUES } from "../src/lib/appAuthRoles.ts";
import { APP_SESSION_COOKIE_NAME, APP_SESSION_TTL_MS } from "../src/lib/appAuth.ts";

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function countByType(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of PERMISSION_CATALOG as PermissionCatalogEntry[]) {
    const t = e.type ?? "(missing)";
    out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

function staticSchemaHints(): void {
  section("Prisma (leitura estática do schema)");
  const schemaPath = join(process.cwd(), "prisma", "schema.prisma");
  if (!existsSync(schemaPath)) {
    console.log("schema.prisma ausente");
    return;
  }
  const schema = readFileSync(schemaPath, "utf8");
  const models = [
    "AppUser",
    "AppSession",
    "AccessProfile",
    "AppUserRole",
    "UserPermission",
    "Permission",
    "RolePermission",
    "AppUserChangeLog",
  ];
  for (const name of models) {
    const hit =
      schema.includes(`model ${name}`) ||
      schema.includes(`enum ${name}`);
    console.log(`  ${name}: ${hit ? "PRESENT" : "ABSENT"}`);
  }
}

function authConstants(): void {
  section("Auth constants");
  console.log(`  cookie: ${APP_SESSION_COOKIE_NAME}`);
  console.log(`  ttlHours: ${APP_SESSION_TTL_MS / (1000 * 60 * 60)}`);
  console.log(`  roles: ${APP_USER_ROLE_VALUES.join(", ")}`);
}

function catalogSummary(): void {
  section("Permission catalog");
  console.log(`  keys: ${ALL_PERMISSION_KEYS.length}`);
  console.log(`  byType: ${JSON.stringify(countByType())}`);
  const pr = ALL_PERMISSION_KEYS.filter((k) => k.includes("portfolioReconciliation"));
  console.log(`  portfolioReconciliation keys (${pr.length}):`);
  for (const k of pr) console.log(`    - ${k}`);
  console.log(
    `  finance.executiveReport.view in catalog: ${ALL_PERMISSION_KEYS.includes("finance.executiveReport.view")}`
  );
}

function menuSummary(): void {
  section("Sidebar modules");
  console.log(`  count: ${SIDEBAR_MODULE_ORDER.length}`);
  for (const id of SIDEBAR_MODULE_ORDER) {
    const keys = MODULE_MENU_PERMISSION_KEYS[id] ?? [];
    console.log(
      `  - ${id} | ${MODULE_LABELS[id]} | path=${getModulePath(id)} | perms=${keys.length}`
    );
  }
  section("Navigation groups");
  for (const g of NAVIGATION_GROUP_DEFINITIONS) {
    console.log(`  - ${g.id} (${g.label}): [${g.itemIds.join(", ")}]`);
  }
}

function portfolioTabs(): void {
  section("Portfolio reconciliation tab keys");
  console.log(`  module: ${FINANCE_PORTFOLIO_RECONCILIATION_VIEW}`);
  console.log(`  conciliation: ${FINANCE_PORTFOLIO_RECONCILIATION_CONCILIATION_VIEW}`);
  console.log(`  intelligence: ${FINANCE_PORTFOLIO_RECONCILIATION_INTELLIGENCE_VIEW}`);
  console.log(`  orderToCashAudit: ${FINANCE_PORTFOLIO_RECONCILIATION_ORDER_TO_CASH_AUDIT_VIEW}`);
  console.log(
    `  legacy OR: ${FINANCE_PORTFOLIO_RECONCILIATION_LEGACY_VIEW_PERMISSIONS.join(" | ")}`
  );
}

function adminUiHints(): void {
  section("Admin UI files (existência)");
  const files = [
    "src/components/AdminUsersModule.tsx",
    "src/components/AccessProfilesModule.tsx",
    "src/components/admin/PermissionEditor.tsx",
    "src/lib/appAuthMiddleware.ts",
    "src/lib/accessProfilesRoutes.ts",
    "docs/security/permissions-current-inventory.md",
  ];
  for (const f of files) {
    console.log(`  ${f}: ${existsSync(join(process.cwd(), f)) ? "OK" : "MISSING"}`);
  }
}

async function optionalDbCounts(): Promise<void> {
  section("DB live (opcional)");
  if (!process.env.DATABASE_URL) {
    console.log("  SKIP — DATABASE_URL ausente");
    return;
  }
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const [users, sessions, profiles] = await Promise.all([
        prisma.appUser.count(),
        prisma.appSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
        prisma.accessProfile.count(),
      ]);
      console.log(`  AppUser: ${users}`);
      console.log(`  AppSession ativas: ${sessions}`);
      console.log(`  AccessProfile: ${profiles}`);
    } finally {
      await prisma.$disconnect();
    }
  } catch (e) {
    console.log(`  SKIP — ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main(): Promise<void> {
  console.log("inspectPermissionsCurrentState — read-only");
  authConstants();
  staticSchemaHints();
  catalogSummary();
  menuSummary();
  portfolioTabs();
  adminUiHints();
  await optionalDbCounts();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
