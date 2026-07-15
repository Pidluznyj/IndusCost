/**
 * Porta em memória + adapter Prisma para o seed do catálogo.
 */

import type { PrismaClient, PermissionResourceType } from "@prisma/client";
import type {
  CatalogSeedExistingRow,
  CatalogSeedResourceRow,
  PermissionCatalogSeedPort,
} from "./types.ts";

export function createInMemoryPermissionCatalogSeedPort(
  initial: CatalogSeedExistingRow[] = []
): PermissionCatalogSeedPort & { store: Map<string, CatalogSeedExistingRow> } {
  const store = new Map(initial.map((r) => [r.key, { ...r }]));

  const port: PermissionCatalogSeedPort & {
    store: Map<string, CatalogSeedExistingRow>;
  } = {
    store,
    async listResources() {
      return [...store.values()];
    },
    async createResource(row) {
      if (store.has(row.key)) {
        throw new Error(`duplicate create: ${row.key}`);
      }
      if (row.parentKey && !store.has(row.parentKey)) {
        throw new Error(`missing parent: ${row.key} → ${row.parentKey}`);
      }
      store.set(row.key, toExisting(row));
    },
    async updateResource(key, row) {
      if (!store.has(key)) throw new Error(`missing update target: ${key}`);
      if (row.parentKey && row.parentKey !== key && !store.has(row.parentKey)) {
        throw new Error(`missing parent: ${key} → ${row.parentKey}`);
      }
      store.set(key, toExisting(row));
    },
    async writeAudit() {
      /* no-op in memory */
    },
    async transaction(fn) {
      // Snapshot + rollback on error
      const snapshot = new Map(
        [...store.entries()].map(([k, v]) => [k, { ...v }])
      );
      try {
        return await fn(port);
      } catch (e) {
        store.clear();
        for (const [k, v] of snapshot) store.set(k, v);
        throw e;
      }
    },
  };
  return port;
}

function toExisting(row: CatalogSeedResourceRow): CatalogSeedExistingRow {
  return {
    key: row.key,
    label: row.label,
    description: row.description,
    type: row.type,
    parentKey: row.parentKey,
    module: row.module,
    sortOrder: row.sortOrder,
    isSystem: row.isSystem,
    isActive: row.isActive,
  };
}

export function createPrismaPermissionCatalogSeedPort(
  prisma: PrismaClient
): PermissionCatalogSeedPort {
  return {
    async listResources() {
      const rows = await prisma.permissionResource.findMany({
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
        ...r,
        type: r.type as PermissionResourceType,
      }));
    },
    async createResource(row) {
      await prisma.permissionResource.create({
        data: {
          key: row.key,
          label: row.label,
          description: row.description,
          type: row.type,
          parentKey: row.parentKey,
          module: row.module,
          sortOrder: row.sortOrder,
          isSystem: row.isSystem,
          isActive: row.isActive,
        },
      });
    },
    async updateResource(key, row) {
      await prisma.permissionResource.update({
        where: { key },
        data: {
          label: row.label,
          description: row.description,
          type: row.type,
          parentKey: row.parentKey,
          module: row.module,
          sortOrder: row.sortOrder,
          isSystem: row.isSystem,
          isActive: row.isActive,
        },
      });
    },
    async writeAudit(action, payload) {
      await prisma.permissionAuditLog.create({
        data: {
          action,
          resourceKey: null,
          afterJson: payload as object,
        },
      });
    },
    async transaction(fn) {
      return prisma.$transaction(async (tx) => {
        const txPort = createPrismaPermissionCatalogSeedPort(tx as unknown as PrismaClient);
        return fn(txPort);
      });
    },
  };
}
