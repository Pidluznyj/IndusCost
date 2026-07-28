/**
 * Seed aditivo e restrito: somente ADMIN × finance.treasury*.
 * Create-only — nunca atualiza/remove RolePermission existente.
 * Sem efeitos colaterais em outros papéis, overrides ou bags individuais.
 */

import type { AppUserRole, PrismaClient } from "@prisma/client";
import {
  getOfficialRolePermissionFlags,
  OFFICIAL_APP_USER_ROLES,
  PERMISSION_RESOURCE_SEEDS,
  type PermissionResourceSeed,
  type RolePermissionFlags,
} from "@/src/lib/permissionResourceSeedData.js";
import { TREASURY_RESOURCE_KEYS } from "@/src/lib/treasury/treasuryAccess.js";

export const TREASURY_ADMIN_SEED_ROLE: AppUserRole = "ADMIN";

export const TREASURY_PERMISSION_KEY_PREFIX = "finance.treasury";

export type TreasuryAdminPermissionSeedErrorCode =
  | "ADMIN_ROLE_UNRESOLVED"
  | "EMPTY_TREASURY_CATALOG"
  | "TRANSACTION_FAILED";

export class TreasuryAdminPermissionSeedError extends Error {
  readonly code: TreasuryAdminPermissionSeedErrorCode;

  constructor(code: TreasuryAdminPermissionSeedErrorCode, message: string) {
    super(message);
    this.name = "TreasuryAdminPermissionSeedError";
    this.code = code;
  }
}

export type TreasuryPermissionResourceRow = {
  key: string;
  label: string;
  description: string;
  type: string;
  parentKey: string | null;
  module: string;
  sortOrder: number;
  isSystem: boolean;
  isActive: boolean;
};

export type TreasuryRolePermissionRow = {
  id: string;
  role: AppUserRole;
  resourceKey: string;
  canView: boolean;
  canExecute: boolean;
  canManage: boolean;
};

export type TreasuryAdminPermissionSeedPort = {
  listPermissionResourcesByKeys(
    keys: readonly string[]
  ): Promise<TreasuryPermissionResourceRow[]>;
  listRolePermissions(input: {
    role: AppUserRole;
    resourceKeys: readonly string[];
  }): Promise<TreasuryRolePermissionRow[]>;
  countRolePermissionsOutsideScope(input: {
    excludeRole: AppUserRole;
    resourceKeys: readonly string[];
  }): Promise<number>;
  countUserPermissionOverrides(resourceKeys: readonly string[]): Promise<number>;
  runInTransaction<T>(fn: (tx: TreasuryAdminPermissionSeedTx) => Promise<T>): Promise<T>;
};

export type TreasuryAdminPermissionSeedTx = {
  createPermissionResource(row: TreasuryPermissionResourceRow): Promise<void>;
  createRolePermission(input: {
    role: AppUserRole;
    resourceKey: string;
    flags: RolePermissionFlags;
  }): Promise<void>;
  createAuditLog(summary: Record<string, unknown>): Promise<void>;
};

export type TreasuryAdminPermissionSeedPlan = {
  role: AppUserRole;
  resourceKeys: string[];
  resourcesFound: string[];
  resourcesToCreate: PermissionResourceSeed[];
  rolePermissionsExisting: Array<{
    resourceKey: string;
    flags: RolePermissionFlags;
  }>;
  rolePermissionsToCreate: Array<{
    resourceKey: string;
    flags: RolePermissionFlags;
  }>;
  rolePermissionsSkippedExisting: string[];
  otherRolesUntouched: true;
  userOverridesUntouched: true;
};

export type TreasuryAdminPermissionSeedReport = {
  dryRun: boolean;
  applied: boolean;
  plan: TreasuryAdminPermissionSeedPlan;
  resourcesCreated: number;
  rolePermissionsCreated: number;
  rolePermissionsSkipped: number;
  auditWritten: boolean;
  note: string;
};

export function isTreasuryPermissionResourceKey(key: string): boolean {
  return (
    key === TREASURY_PERMISSION_KEY_PREFIX ||
    key.startsWith(`${TREASURY_PERMISSION_KEY_PREFIX}.`)
  );
}

export function listOfficialTreasuryPermissionResourceSeeds(): PermissionResourceSeed[] {
  return PERMISSION_RESOURCE_SEEDS.filter((row) =>
    isTreasuryPermissionResourceKey(row.key)
  );
}

export function listOfficialTreasuryResourceKeys(): string[] {
  const fromSeeds = listOfficialTreasuryPermissionResourceSeeds().map((r) => r.key);
  const fromContract = Object.values(TREASURY_RESOURCE_KEYS);
  return [...new Set([...fromSeeds, ...fromContract])].sort((a, b) =>
    a.localeCompare(b)
  );
}

export function assertAdminRoleResolvable(): AppUserRole {
  if (!OFFICIAL_APP_USER_ROLES.includes(TREASURY_ADMIN_SEED_ROLE)) {
    throw new TreasuryAdminPermissionSeedError(
      "ADMIN_ROLE_UNRESOLVED",
      "Papel ADMIN não está no catálogo oficial de roles — abortando seed restrito."
    );
  }
  const probe = getOfficialRolePermissionFlags(
    TREASURY_ADMIN_SEED_ROLE,
    TREASURY_RESOURCE_KEYS.root
  );
  if (!probe.canView) {
    throw new TreasuryAdminPermissionSeedError(
      "ADMIN_ROLE_UNRESOLVED",
      "ROLE_MATRIX.ADMIN não declara finance.treasury.view — abortando seed restrito."
    );
  }
  return TREASURY_ADMIN_SEED_ROLE;
}

export async function buildTreasuryAdminPermissionSeedPlan(
  port: TreasuryAdminPermissionSeedPort
): Promise<TreasuryAdminPermissionSeedPlan> {
  const role = assertAdminRoleResolvable();
  const catalog = listOfficialTreasuryPermissionResourceSeeds();
  if (catalog.length === 0) {
    throw new TreasuryAdminPermissionSeedError(
      "EMPTY_TREASURY_CATALOG",
      "Nenhum PermissionResource finance.treasury* no catálogo oficial."
    );
  }
  const resourceKeys = catalog.map((r) => r.key);
  // Garante que só processamos o prefixo treasury.
  for (const key of resourceKeys) {
    if (!isTreasuryPermissionResourceKey(key)) {
      throw new TreasuryAdminPermissionSeedError(
        "EMPTY_TREASURY_CATALOG",
        `Chave fora do escopo Tesouraria: ${key}`
      );
    }
  }

  const existingResources = await port.listPermissionResourcesByKeys(resourceKeys);
  const existingKeys = new Set(existingResources.map((r) => r.key));
  const resourcesToCreate = catalog.filter((r) => !existingKeys.has(r.key));

  const existingRolePerms = await port.listRolePermissions({
    role,
    resourceKeys,
  });
  const existingByKey = new Map(
    existingRolePerms.map((r) => [r.resourceKey, r] as const)
  );

  const rolePermissionsExisting: TreasuryAdminPermissionSeedPlan["rolePermissionsExisting"] =
    [];
  const rolePermissionsToCreate: TreasuryAdminPermissionSeedPlan["rolePermissionsToCreate"] =
    [];
  const rolePermissionsSkippedExisting: string[] = [];

  for (const key of resourceKeys) {
    const official = getOfficialRolePermissionFlags(role, key);
    const existing = existingByKey.get(key);
    if (existing) {
      rolePermissionsExisting.push({
        resourceKey: key,
        flags: {
          canView: existing.canView,
          canExecute: existing.canExecute,
          canManage: existing.canManage,
        },
      });
      rolePermissionsSkippedExisting.push(key);
      continue;
    }
    // Só cria se o preset oficial concede alguma capacidade (evita NONE ruidoso).
    if (official.canView || official.canExecute || official.canManage) {
      rolePermissionsToCreate.push({ resourceKey: key, flags: { ...official } });
    }
  }

  return {
    role,
    resourceKeys,
    resourcesFound: [...existingKeys].sort(),
    resourcesToCreate,
    rolePermissionsExisting,
    rolePermissionsToCreate,
    rolePermissionsSkippedExisting,
    otherRolesUntouched: true,
    userOverridesUntouched: true,
  };
}

export async function runTreasuryAdminPermissionSeed(input: {
  port: TreasuryAdminPermissionSeedPort;
  dryRun: boolean;
}): Promise<TreasuryAdminPermissionSeedReport> {
  const plan = await buildTreasuryAdminPermissionSeedPlan(input.port);

  const note =
    "Create-only ADMIN×finance.treasury*. Não atualiza RolePermission existente, não toca outros papéis, overrides nem AppUser.permissions.";

  if (input.dryRun) {
    return {
      dryRun: true,
      applied: false,
      plan,
      resourcesCreated: 0,
      rolePermissionsCreated: 0,
      rolePermissionsSkipped: plan.rolePermissionsSkippedExisting.length,
      auditWritten: false,
      note,
    };
  }

  try {
    const result = await input.port.runInTransaction(async (tx) => {
      let resourcesCreated = 0;
      let rolePermissionsCreated = 0;

      for (const row of plan.resourcesToCreate) {
        await tx.createPermissionResource({
          key: row.key,
          label: row.label,
          description: row.description,
          type: row.type,
          parentKey: row.parentKey,
          module: row.module,
          sortOrder: row.sortOrder,
          isSystem: true,
          isActive: true,
        });
        resourcesCreated += 1;
      }

      for (const row of plan.rolePermissionsToCreate) {
        await tx.createRolePermission({
          role: plan.role,
          resourceKey: row.resourceKey,
          flags: row.flags,
        });
        rolePermissionsCreated += 1;
      }

      const summary = {
        action: "SEED_TREASURY_ADMIN_PERMISSIONS",
        role: plan.role,
        resourcesCreated,
        rolePermissionsCreated,
        rolePermissionsSkipped: plan.rolePermissionsSkippedExisting.length,
        resourceKeys: plan.resourceKeys,
        note,
      };
      await tx.createAuditLog(summary);

      return { resourcesCreated, rolePermissionsCreated };
    });

    return {
      dryRun: false,
      applied: true,
      plan,
      resourcesCreated: result.resourcesCreated,
      rolePermissionsCreated: result.rolePermissionsCreated,
      rolePermissionsSkipped: plan.rolePermissionsSkippedExisting.length,
      auditWritten: true,
      note,
    };
  } catch (err) {
    if (err instanceof TreasuryAdminPermissionSeedError) throw err;
    throw new TreasuryAdminPermissionSeedError(
      "TRANSACTION_FAILED",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function createPrismaTreasuryAdminPermissionSeedPort(
  prisma: PrismaClient
): TreasuryAdminPermissionSeedPort {
  function makeTx(client: {
    permissionResource: PrismaClient["permissionResource"];
    rolePermission: PrismaClient["rolePermission"];
    permissionAuditLog: PrismaClient["permissionAuditLog"];
  }): TreasuryAdminPermissionSeedTx {
    return {
      async createPermissionResource(row) {
        await client.permissionResource.create({
          data: {
            key: row.key,
            label: row.label,
            description: row.description,
            type: row.type as never,
            parentKey: row.parentKey,
            module: row.module,
            sortOrder: row.sortOrder,
            isSystem: true,
            isActive: true,
          },
        });
      },
      async createRolePermission(input) {
        await client.rolePermission.create({
          data: {
            role: input.role,
            resourceKey: input.resourceKey,
            canView: input.flags.canView,
            canExecute: input.flags.canExecute,
            canManage: input.flags.canManage,
          },
        });
      },
      async createAuditLog(summary) {
        await client.permissionAuditLog.create({
          data: {
            action: "SEED_TREASURY_ADMIN_PERMISSIONS",
            resourceKey: "finance.treasury",
            beforeJson: undefined,
            afterJson: summary,
          },
        });
      },
    };
  }

  return {
    async listPermissionResourcesByKeys(keys) {
      if (keys.length === 0) return [];
      const rows = await prisma.permissionResource.findMany({
        where: { key: { in: [...keys] } },
        select: {
          key: true,
          label: true,
          description: true,
          type: true,
          parentKey: true,
          module: true,
          sortOrder: true,
          isSystem: true,
          isActive: true,
        },
      });
      return rows.map((r) => ({
        key: r.key,
        label: r.label,
        description: r.description,
        type: r.type,
        parentKey: r.parentKey,
        module: r.module,
        sortOrder: r.sortOrder,
        isSystem: r.isSystem,
        isActive: r.isActive,
      }));
    },
    async listRolePermissions({ role, resourceKeys }) {
      if (resourceKeys.length === 0) return [];
      return prisma.rolePermission.findMany({
        where: { role, resourceKey: { in: [...resourceKeys] } },
        select: {
          id: true,
          role: true,
          resourceKey: true,
          canView: true,
          canExecute: true,
          canManage: true,
        },
      });
    },
    async countRolePermissionsOutsideScope({ excludeRole, resourceKeys }) {
      return prisma.rolePermission.count({
        where: {
          resourceKey: { in: [...resourceKeys] },
          NOT: { role: excludeRole },
        },
      });
    },
    async countUserPermissionOverrides(resourceKeys) {
      return prisma.userPermissionOverride.count({
        where: { resourceKey: { in: [...resourceKeys] } },
      });
    },
    async runInTransaction(fn) {
      return prisma.$transaction(async (tx) => fn(makeTx(tx)));
    },
  };
}

export function formatTreasuryAdminPermissionSeedReport(
  report: TreasuryAdminPermissionSeedReport
): string {
  const lines = [
    `mode=${report.dryRun ? "dry-run" : "apply"}`,
    `role=${report.plan.role}`,
    `resourceKeys=${report.plan.resourceKeys.length}`,
    `resourcesFound=${report.plan.resourcesFound.length}`,
    `resourcesToCreate=${report.plan.resourcesToCreate.map((r) => r.key).join(",") || "(none)"}`,
    `rolePermissionsExisting=${report.plan.rolePermissionsExisting.length}`,
    `rolePermissionsToCreate=${report.plan.rolePermissionsToCreate.map((r) => r.resourceKey).join(",") || "(none)"}`,
    `rolePermissionsSkipped=${report.rolePermissionsSkipped}`,
    `resourcesCreated=${report.resourcesCreated}`,
    `rolePermissionsCreated=${report.rolePermissionsCreated}`,
    `auditWritten=${report.auditWritten}`,
    `otherRolesUntouched=${report.plan.otherRolesUntouched}`,
    `userOverridesUntouched=${report.plan.userOverridesUntouched}`,
    report.note,
  ];
  return lines.join("\n");
}
