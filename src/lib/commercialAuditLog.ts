import { prisma } from "@/src/lib/prisma.js";

export async function writeCommercialAuditLog(input: {
  entityType: string;
  entityId: string;
  action: string;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  performedBy?: string | null;
}) {
  await prisma.commercialAuditLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      fieldName: input.fieldName ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      performedBy: input.performedBy ?? null,
    },
  });
}
