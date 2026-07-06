/**
 * Auditoria do módulo Estoque — server-only.
 */
import type { PrismaClient } from "@prisma/client";

export type InventoryAuditInput = {
  entityType: string;
  entityId: string;
  action: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  userId?: string | null;
  userName?: string | null;
  reason?: string | null;
};

export async function writeInventoryAuditLog(
  prisma: PrismaClient,
  input: InventoryAuditInput
): Promise<void> {
  await prisma.inventoryAuditLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeJson: input.beforeJson ?? undefined,
      afterJson: input.afterJson ?? undefined,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      reason: input.reason ?? null,
    },
  });
}
