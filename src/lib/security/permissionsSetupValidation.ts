/**
 * Validações operacionais do setup de permissões (código + opcionalmente DB).
 * Browser-safe na parte de catálogo em memória; DB fica no script.
 */

import {
  OFFICIAL_APP_USER_ROLES,
  PERMISSION_RESOURCE_SEEDS,
  getOfficialRolePermissionFlags,
  validatePermissionResourceCatalog,
  type CatalogIntegrityIssue,
} from "../permissionResourceSeedData.js";

/** Abas obrigatórias da Conciliação de Carteira. */
export const REQUIRED_PORTFOLIO_RECONCILIATION_TAB_KEYS = [
  "financeiro.conciliacao_carteira.tab.conciliacao",
  "financeiro.conciliacao_carteira.tab.inteligencia",
  "financeiro.conciliacao_carteira.tab.auditoria_pedido_caixa",
] as const;

export type PermissionsSetupCheck = {
  code: string;
  severity: "error" | "warn" | "ok";
  message: string;
};

export type PermissionsSetupReport = {
  ok: boolean;
  checks: PermissionsSetupCheck[];
  catalogResourceCount: number;
  catalogIssues: CatalogIntegrityIssue[];
};

function push(
  checks: PermissionsSetupCheck[],
  severity: PermissionsSetupCheck["severity"],
  code: string,
  message: string
): void {
  checks.push({ severity, code, message });
}

/** Checagens que não dependem de banco. */
export function validatePermissionsCatalogSetup(): PermissionsSetupReport {
  const checks: PermissionsSetupCheck[] = [];
  const catalogIssues = validatePermissionResourceCatalog();
  const keys = new Set(PERMISSION_RESOURCE_SEEDS.map((r) => r.key));

  if (PERMISSION_RESOURCE_SEEDS.length === 0) {
    push(checks, "error", "CATALOG_EMPTY", "Catálogo PERMISSION_RESOURCE_SEEDS está vazio.");
  } else {
    push(
      checks,
      "ok",
      "CATALOG_LOADED",
      `Catálogo carregado com ${PERMISSION_RESOURCE_SEEDS.length} recurso(s).`
    );
  }

  if (catalogIssues.length > 0) {
    for (const issue of catalogIssues) {
      push(checks, "error", issue.code, issue.message);
    }
  } else {
    push(checks, "ok", "CATALOG_INTEGRITY", "Catálogo sem issues estruturais.");
  }

  for (const tabKey of REQUIRED_PORTFOLIO_RECONCILIATION_TAB_KEYS) {
    if (!keys.has(tabKey)) {
      push(
        checks,
        "error",
        "MISSING_PR_TAB",
        `Aba obrigatória ausente no catálogo: ${tabKey}`
      );
    } else {
      push(checks, "ok", "PR_TAB_PRESENT", `Aba presente: ${tabKey}`);
    }
  }

  // Recursos órfãos (parent inválido) — reforço além do validatePermissionResourceCatalog.
  for (const row of PERMISSION_RESOURCE_SEEDS) {
    if (row.parentKey && !keys.has(row.parentKey)) {
      push(
        checks,
        "error",
        "ORPHAN_RESOURCE",
        `${row.key} aponta para parent inexistente: ${row.parentKey}`
      );
    }
  }

  // SUPER_ADMIN com acesso total no preset oficial.
  let superAdminFull = true;
  for (const row of PERMISSION_RESOURCE_SEEDS) {
    const flags = getOfficialRolePermissionFlags("SUPER_ADMIN", row.key);
    if (!flags.canView || !flags.canExecute || !flags.canManage) {
      superAdminFull = false;
      push(
        checks,
        "error",
        "SUPER_ADMIN_NOT_FULL",
        `SUPER_ADMIN sem acesso total em ${row.key}`
      );
    }
  }
  if (superAdminFull) {
    push(
      checks,
      "ok",
      "SUPER_ADMIN_FULL",
      "SUPER_ADMIN tem view+execute+manage em todos os recursos do catálogo."
    );
  }

  // Permissões mínimas por role (preset oficial).
  const minimumByRole: Record<
    string,
    { resourceKey: string; require: "view" | "manage" }[]
  > = {
    ADMIN: [
      { resourceKey: "dashboard", require: "view" },
      { resourceKey: "admin.usuarios", require: "view" },
    ],
    COMMERCIAL_MANAGER: [{ resourceKey: "dashboard", require: "view" }],
    SELLER: [{ resourceKey: "dashboard", require: "view" }],
    // VIEWER é role técnica fail-closed: sem mínimo automático; acesso via perfil/override.
    VIEWER: [],
  };

  for (const role of OFFICIAL_APP_USER_ROLES) {
    if (role === "SUPER_ADMIN") continue;
    const mins = minimumByRole[role] ?? [{ resourceKey: "dashboard", require: "view" as const }];
    if (mins.length === 0) {
      push(
        checks,
        "ok",
        "ROLE_MINIMUM_OK",
        `Role ${role}: fail-closed sem mínimo obrigatório (perfil/override).`
      );
      continue;
    }
    for (const min of mins) {
      if (!keys.has(min.resourceKey)) {
        push(
          checks,
          "error",
          "MIN_RESOURCE_MISSING",
          `Recurso mínimo ${min.resourceKey} ausente (role ${role}).`
        );
        continue;
      }
      const flags = getOfficialRolePermissionFlags(role, min.resourceKey);
      const ok =
        min.require === "manage"
          ? flags.canManage
          : flags.canView || flags.canExecute || flags.canManage;
      if (!ok) {
        push(
          checks,
          "error",
          "ROLE_MINIMUM_MISSING",
          `Role ${role} sem permissão mínima (${min.require}) em ${min.resourceKey}.`
        );
      } else {
        push(
          checks,
          "ok",
          "ROLE_MINIMUM_OK",
          `Role ${role}: mínimo OK em ${min.resourceKey}.`
        );
      }
    }
  }

  const ok = !checks.some((c) => c.severity === "error");
  return {
    ok,
    checks,
    catalogResourceCount: PERMISSION_RESOURCE_SEEDS.length,
    catalogIssues,
  };
}

export type DbPermissionsSnapshot = {
  resourceKeys: string[];
  rolePermissions: Array<{ role: string; resourceKey: string }>;
  overrides: Array<{ resourceKey: string }>;
  activeSuperAdminCount: number;
};

/** Checagens contra snapshot do banco (sem Prisma). */
export function validatePermissionsDbSnapshot(
  snap: DbPermissionsSnapshot
): PermissionsSetupCheck[] {
  const checks: PermissionsSetupCheck[] = [];
  const seedKeys = new Set(PERMISSION_RESOURCE_SEEDS.map((r) => r.key));
  const dbKeys = new Set(snap.resourceKeys);

  if (snap.resourceKeys.length === 0) {
    push(
      checks,
      "error",
      "DB_CATALOG_EMPTY",
      "PermissionResource vazio no banco — rode npm run permissions:seed."
    );
  } else {
    push(
      checks,
      "ok",
      "DB_CATALOG_LOADED",
      `Banco com ${snap.resourceKeys.length} PermissionResource(s).`
    );
  }

  for (const tabKey of REQUIRED_PORTFOLIO_RECONCILIATION_TAB_KEYS) {
    if (!dbKeys.has(tabKey)) {
      push(
        checks,
        "error",
        "DB_MISSING_PR_TAB",
        `Aba ausente no banco: ${tabKey}`
      );
    } else {
      push(checks, "ok", "DB_PR_TAB_PRESENT", `Aba no banco: ${tabKey}`);
    }
  }

  // Seed keys missing from DB
  for (const key of seedKeys) {
    if (!dbKeys.has(key)) {
      push(
        checks,
        "warn",
        "DB_MISSING_SEED_KEY",
        `Recurso do seed não está no banco: ${key}`
      );
    }
  }

  // Orphans in DB: parent missing (caller should pass only keys; parent check needs map)
  // Done in script with parentKey field.

  for (const rp of snap.rolePermissions) {
    if (!dbKeys.has(rp.resourceKey) && !seedKeys.has(rp.resourceKey)) {
      push(
        checks,
        "error",
        "ROLE_PERM_UNKNOWN_RESOURCE",
        `RolePermission ${rp.role} → resourceKey inexistente: ${rp.resourceKey}`
      );
    } else if (!dbKeys.has(rp.resourceKey)) {
      push(
        checks,
        "error",
        "ROLE_PERM_UNKNOWN_RESOURCE",
        `RolePermission ${rp.role} → resourceKey não está no banco: ${rp.resourceKey}`
      );
    }
  }

  for (const ov of snap.overrides) {
    if (!dbKeys.has(ov.resourceKey)) {
      push(
        checks,
        "error",
        "OVERRIDE_UNKNOWN_RESOURCE",
        `UserPermissionOverride aponta para resourceKey inexistente: ${ov.resourceKey}`
      );
    }
  }

  if (snap.activeSuperAdminCount < 1) {
    push(
      checks,
      "error",
      "NO_ACTIVE_SUPER_ADMIN",
      "Nenhum SUPER_ADMIN ativo no banco."
    );
  } else {
    push(
      checks,
      "ok",
      "ACTIVE_SUPER_ADMIN",
      `${snap.activeSuperAdminCount} SUPER_ADMIN ativo(s).`
    );
  }

  return checks;
}
