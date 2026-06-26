/**
 * Serviço server-only de conferência física / inventário.
 * Ajustes sempre via createInventoryMovement — nunca altera saldo diretamente.
 */
import type { PrismaClient } from "@prisma/client";
import { writeInventoryAuditLog } from "./inventoryAudit.server.js";
import { computeCountDifference, hasCountDivergence } from "./inventoryCountMath.js";
import { canApproveInventoryCount } from "./inventoryPermissionChecks.js";
import {
  COUNT_SESSION_LINE_EDITABLE_STATUSES,
  validateCountLineUpdate,
} from "./inventoryCountValidation.js";
import { decimalQuantity } from "./inventoryRepository.server.js";
import { inventoryDec } from "./inventorySerialization.server.js";
import { createInventoryMovement } from "./inventoryService.server.js";
import { InventoryValidationError } from "./inventoryTypes.js";

export type CountSessionContext = {
  userId: string;
  permissions?: readonly string[];
};

function assertCanApprove(permissions: readonly string[] | undefined): void {
  if (canApproveInventoryCount(permissions ?? [])) return;
  throw new InventoryValidationError(
    "Sem permissão para aprovar conferência.",
    "NOT_AUTHORIZED"
  );
}

async function generateSessionCode(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]
): Promise<string> {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `CF-${datePart}`;
  const existing = await tx.inventoryCountSession.count({
    where: { code: { startsWith: prefix } },
  });
  return `${prefix}-${String(existing + 1).padStart(3, "0")}`;
}

export async function createInventoryCountSession(
  prisma: PrismaClient,
  input: { warehouseId: string; notes?: string | null },
  context: CountSessionContext
) {
  return prisma.$transaction(async (tx) => {
    const warehouse = await tx.inventoryWarehouse.findUnique({
      where: { id: input.warehouseId },
      select: { id: true, status: true },
    });
    if (!warehouse) {
      throw new InventoryValidationError("Almoxarifado não encontrado.", "WAREHOUSE_NOT_FOUND");
    }
    if (warehouse.status !== "ACTIVE") {
      throw new InventoryValidationError("Almoxarifado inativo.", "WAREHOUSE_INACTIVE");
    }

    const code = await generateSessionCode(tx);
    const session = await tx.inventoryCountSession.create({
      data: {
        code,
        warehouseId: input.warehouseId,
        status: "OPEN",
        responsibleUserId: context.userId,
        notes: input.notes?.trim() || null,
      },
    });

    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryCountSession",
      entityId: session.id,
      action: "CREATE",
      afterJson: { code: session.code, warehouseId: session.warehouseId },
      userId: context.userId,
    });

    return session;
  });
}

export async function startInventoryCountSession(
  prisma: PrismaClient,
  sessionId: string,
  context: CountSessionContext
) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.inventoryCountSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new InventoryValidationError("Conferência não encontrada.", "SESSION_NOT_FOUND");
    }
    if (session.status !== "OPEN") {
      throw new InventoryValidationError("Conferência não está aberta.", "INVALID_STATUS");
    }

    const balances = await tx.inventoryBalance.findMany({
      where: { warehouseId: session.warehouseId },
      include: { item: { select: { status: true } } },
    });

    for (const balance of balances) {
      if (balance.item.status !== "ACTIVE") continue;
      await tx.inventoryCountLine.create({
        data: {
          sessionId,
          itemId: balance.itemId,
          warehouseId: session.warehouseId,
          locationId: balance.locationId,
          systemQuantity: balance.physicalQuantity,
        },
      });
    }

    const updated = await tx.inventoryCountSession.update({
      where: { id: sessionId },
      data: {
        status: "COUNTING",
        startedAt: new Date(),
        responsibleUserId: context.userId,
      },
    });

    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryCountSession",
      entityId: sessionId,
      action: "START_COUNTING",
      beforeJson: { status: "OPEN" },
      afterJson: { status: "COUNTING", lines: balances.length },
      userId: context.userId,
    });

    return updated;
  });
}

export async function updateInventoryCountLine(
  prisma: PrismaClient,
  sessionId: string,
  lineId: string,
  input: { countedQuantity: number; justification?: string | null },
  _context: CountSessionContext
) {
  const session = await prisma.inventoryCountSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new InventoryValidationError("Conferência não encontrada.", "SESSION_NOT_FOUND");
  }
  if (!COUNT_SESSION_LINE_EDITABLE_STATUSES.has(session.status)) {
    throw new InventoryValidationError(
      "Conferência não permite edição de linhas neste status.",
      "SESSION_LOCKED"
    );
  }

  const line = await prisma.inventoryCountLine.findFirst({
    where: { id: lineId, sessionId },
  });
  if (!line) {
    throw new InventoryValidationError("Linha não encontrada.", "LINE_NOT_FOUND");
  }
  if (line.generatedMovementId) {
    throw new InventoryValidationError("Linha já possui ajuste gerado.", "ADJUSTMENT_EXISTS");
  }

  const systemQty = inventoryDec(line.systemQuantity);
  const { differenceQuantity, differencePercent } = validateCountLineUpdate(systemQty, {
    countedQuantity: input.countedQuantity,
    justification: input.justification ?? null,
  });

  return prisma.inventoryCountLine.update({
    where: { id: lineId },
    data: {
      countedQuantity: decimalQuantity(input.countedQuantity),
      differenceQuantity: decimalQuantity(differenceQuantity),
      differencePercent: decimalQuantity(differencePercent),
      justification: input.justification?.trim() || null,
    },
  });
}

export async function finalizeInventoryCountSession(
  prisma: PrismaClient,
  sessionId: string,
  context: CountSessionContext
) {
  const session = await prisma.inventoryCountSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new InventoryValidationError("Conferência não encontrada.", "SESSION_NOT_FOUND");
  }
  if (session.status !== "COUNTING") {
    throw new InventoryValidationError("Conferência não está em contagem.", "INVALID_STATUS");
  }

  const lines = await prisma.inventoryCountLine.findMany({ where: { sessionId } });
  if (lines.length === 0) {
    throw new InventoryValidationError(
      "Conferência sem itens — inicie a contagem primeiro.",
      "NO_LINES"
    );
  }

  for (const line of lines) {
    if (line.countedQuantity == null) {
      throw new InventoryValidationError(
        "Informe saldo contado para todos os itens.",
        "COUNTED_REQUIRED"
      );
    }
    const systemQty = inventoryDec(line.systemQuantity);
    const countedQty = inventoryDec(line.countedQuantity);
    const { differenceQuantity } = computeCountDifference(systemQty, countedQty);
    if (hasCountDivergence(differenceQuantity) && !line.justification?.trim()) {
      throw new InventoryValidationError(
        "Divergência exige justificativa em todas as linhas.",
        "JUSTIFICATION_REQUIRED"
      );
    }
  }

  const hasDivergence = lines.some((line) => {
    const diff =
      line.differenceQuantity != null
        ? inventoryDec(line.differenceQuantity)
        : computeCountDifference(
            inventoryDec(line.systemQuantity),
            inventoryDec(line.countedQuantity)
          ).differenceQuantity;
    return hasCountDivergence(diff);
  });

  const nextStatus = hasDivergence ? "WAITING_APPROVAL" : "APPROVED";

  const updated = await prisma.inventoryCountSession.update({
    where: { id: sessionId },
    data: {
      status: nextStatus,
      finishedAt: new Date(),
      ...(nextStatus === "APPROVED"
        ? { approvedByUserId: context.userId, approvedAt: new Date() }
        : {}),
    },
  });

  await writeInventoryAuditLog(prisma, {
    entityType: "InventoryCountSession",
    entityId: sessionId,
    action: "FINALIZE",
    afterJson: { status: nextStatus, hasDivergence },
    userId: context.userId,
  });

  return updated;
}

export async function approveInventoryCountSession(
  prisma: PrismaClient,
  sessionId: string,
  context: CountSessionContext
) {
  assertCanApprove(context.permissions);

  const session = await prisma.inventoryCountSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new InventoryValidationError("Conferência não encontrada.", "SESSION_NOT_FOUND");
  }
  if (session.status !== "WAITING_APPROVAL") {
    throw new InventoryValidationError("Conferência não aguarda aprovação.", "INVALID_STATUS");
  }

  const updated = await prisma.inventoryCountSession.update({
    where: { id: sessionId },
    data: {
      status: "APPROVED",
      approvedByUserId: context.userId,
      approvedAt: new Date(),
    },
  });

  await writeInventoryAuditLog(prisma, {
    entityType: "InventoryCountSession",
    entityId: sessionId,
    action: "APPROVE",
    userId: context.userId,
  });

  return updated;
}

export async function generateInventoryCountAdjustments(
  prisma: PrismaClient,
  sessionId: string,
  context: CountSessionContext
) {
  const session = await prisma.inventoryCountSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new InventoryValidationError("Conferência não encontrada.", "SESSION_NOT_FOUND");
  }
  if (session.status === "ADJUSTED") {
    throw new InventoryValidationError("Ajustes já foram gerados.", "ALREADY_ADJUSTED");
  }
  if (session.status !== "APPROVED") {
    throw new InventoryValidationError(
      "Conferência deve estar aprovada para gerar ajustes.",
      "INVALID_STATUS"
    );
  }

  const lines = await prisma.inventoryCountLine.findMany({
    where: { sessionId },
    include: { item: { select: { unit: true } } },
  });

  for (const line of lines) {
    if (line.generatedMovementId) {
      throw new InventoryValidationError(
        "Ajuste duplicado detectado — operação abortada.",
        "DUPLICATE_ADJUSTMENT"
      );
    }
  }

  const movementsCreated: string[] = [];

  for (const line of lines) {
    const diff =
      line.differenceQuantity != null
        ? inventoryDec(line.differenceQuantity)
        : line.countedQuantity != null
          ? computeCountDifference(
              inventoryDec(line.systemQuantity),
              inventoryDec(line.countedQuantity)
            ).differenceQuantity
          : 0;

    if (!hasCountDivergence(diff)) continue;

    const movementType = diff > 0 ? "POSITIVE_ADJUSTMENT" : "NEGATIVE_ADJUSTMENT";
    const quantity = Math.abs(diff);
    const reason = line.justification?.trim() || `Ajuste conferência ${session.code}`;

    const result = await createInventoryMovement(
      prisma,
      {
        itemId: line.itemId,
        movementType,
        quantity,
        unit: line.item.unit,
        reason,
        notes: `Conferência física ${session.code}`,
        originType: "COUNT_SESSION",
        originId: line.id,
        ...(diff > 0
          ? {
              destinationWarehouseId: line.warehouseId,
              destinationLocationId: line.locationId,
            }
          : {
              sourceWarehouseId: line.warehouseId,
              sourceLocationId: line.locationId,
            }),
      },
      context
    );

    await prisma.inventoryCountLine.update({
      where: { id: line.id },
      data: { generatedMovementId: result.movement.id },
    });

    movementsCreated.push(result.movement.id);
  }

  const updated = await prisma.inventoryCountSession.update({
    where: { id: sessionId },
    data: { status: "ADJUSTED" },
  });

  await writeInventoryAuditLog(prisma, {
    entityType: "InventoryCountSession",
    entityId: sessionId,
    action: "GENERATE_ADJUSTMENTS",
    afterJson: { movementsCreated: movementsCreated.length },
    userId: context.userId,
  });

  return { session: updated, movementsCreated: movementsCreated.length };
}

export async function cancelInventoryCountSession(
  prisma: PrismaClient,
  sessionId: string,
  context: CountSessionContext
) {
  const session = await prisma.inventoryCountSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new InventoryValidationError("Conferência não encontrada.", "SESSION_NOT_FOUND");
  }
  if (session.status === "ADJUSTED") {
    throw new InventoryValidationError(
      "Conferência ajustada não pode ser cancelada.",
      "SESSION_LOCKED"
    );
  }
  if (session.status === "CANCELED") {
    throw new InventoryValidationError("Conferência já cancelada.", "INVALID_STATUS");
  }

  const updated = await prisma.inventoryCountSession.update({
    where: { id: sessionId },
    data: { status: "CANCELED" },
  });

  await writeInventoryAuditLog(prisma, {
    entityType: "InventoryCountSession",
    entityId: sessionId,
    action: "CANCEL",
    userId: context.userId,
  });

  return updated;
}
