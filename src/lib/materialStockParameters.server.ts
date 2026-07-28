/**
 * Edição dos parâmetros de nível + saldo atual.
 * Não altera custos. Grava auditoria append-only na mesma transação.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { MaterialStockConferenceError } from "./materialStockConferenceRules.js";
import { roundMaterialStockQuantity } from "./materialStockConferenceMath.js";
import { resolveMaterialStockStatus } from "./materialStockLevelRules.js";
import {
  assertMaterialStockMaterialId,
  parseMaterialStockParametersCommand,
  snapshotStockLevels,
} from "./materialStockParametersRules.js";
import { enqueueMaterialStockSpreadsheetMirrorBestEffort } from "./materialStockSpreadsheetMirror/enqueue.server.js";

export type MaterialStockParametersActor = {
  id: string;
  name?: string | null;
  email?: string | null;
};

export type MaterialStockParametersResult = {
  ok: true;
  material: {
    id: string;
    code: string;
    quantity: number;
    contingencyQuantity: number | null;
    minimumQuantity: number | null;
    recommendedQuantity: number | null;
    stockStatus: string;
    stockConferenceVersion: number;
    updatedAt: string | null;
  };
  auditId: string;
};

function toNumber(value: unknown): number {
  const n = roundMaterialStockQuantity(value);
  return Number.isFinite(n) ? n : 0;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export async function updateMaterialStockParameters(
  db: PrismaClient,
  input: {
    materialId: string;
    body: Record<string, unknown>;
    actor: MaterialStockParametersActor;
  }
): Promise<MaterialStockParametersResult> {
  const materialId = assertMaterialStockMaterialId(input.materialId);
  const command = parseMaterialStockParametersCommand(input.body);
  const actorName =
    input.actor.name?.trim() || input.actor.email?.trim() || input.actor.id;

  return db.$transaction(async (tx) => {
    const material = await tx.material.findUnique({
      where: { id: materialId },
      select: {
        id: true,
        code: true,
        quantity: true,
        contingencyQuantity: true,
        minimumQuantity: true,
        recommendedQuantity: true,
        stockConferenceVersion: true,
        updatedAt: true,
        currentCost: true,
        averageCost: true,
        standardCost: true,
        freight: true,
        standardLoss: true,
      },
    });
    if (!material) {
      throw new MaterialStockConferenceError(
        "NOT_FOUND",
        "Matéria-prima não encontrada.",
        "materialId"
      );
    }

    const before = snapshotStockLevels(material);
    const costsBefore = {
      currentCost: toNumber(material.currentCost),
      averageCost: toNumber(material.averageCost),
      standardCost: toNumber(material.standardCost),
      freight: toNumber(material.freight),
      standardLoss: toNumber(material.standardLoss),
    };

    const updated = await tx.material.update({
      where: { id: materialId },
      data: {
        quantity: command.currentQuantity,
        contingencyQuantity: command.contingencyQuantity,
        minimumQuantity: command.minimumQuantity,
        recommendedQuantity: command.recommendedQuantity,
      },
      select: {
        id: true,
        code: true,
        quantity: true,
        contingencyQuantity: true,
        minimumQuantity: true,
        recommendedQuantity: true,
        stockConferenceVersion: true,
        updatedAt: true,
        currentCost: true,
        averageCost: true,
        standardCost: true,
        freight: true,
        standardLoss: true,
      },
    });

    // Invariante: parâmetros não podem alterar custos.
    if (
      toNumber(updated.currentCost) !== costsBefore.currentCost ||
      toNumber(updated.averageCost) !== costsBefore.averageCost ||
      toNumber(updated.standardCost) !== costsBefore.standardCost ||
      toNumber(updated.freight) !== costsBefore.freight ||
      toNumber(updated.standardLoss) !== costsBefore.standardLoss
    ) {
      throw new MaterialStockConferenceError(
        "INVALID_FIELD",
        "Atualização de parâmetros não pode alterar custos.",
        "currentCost"
      );
    }

    const after = snapshotStockLevels(updated);
    const audit = await tx.materialStockLevelAudit.create({
      data: {
        materialId,
        action: "UPDATE_LEVELS",
        beforeJson: before as Prisma.InputJsonValue,
        afterJson: after as Prisma.InputJsonValue,
        userId: input.actor.id,
        userName: actorName,
        reason: command.reason,
      },
    });

    return {
      ok: true as const,
      material: {
        id: updated.id,
        code: updated.code,
        quantity: toNumber(updated.quantity),
        contingencyQuantity: after.contingencyQuantity,
        minimumQuantity: after.minimumQuantity,
        recommendedQuantity: after.recommendedQuantity,
        stockStatus: resolveMaterialStockStatus({
          currentQuantity: updated.quantity,
          contingencyQuantity: updated.contingencyQuantity,
          minimumQuantity: updated.minimumQuantity,
          recommendedQuantity: updated.recommendedQuantity,
        }),
        stockConferenceVersion: updated.stockConferenceVersion,
        updatedAt: toIso(updated.updatedAt),
      },
      auditId: audit.id,
    };
  }).then(async (result) => {
    await enqueueMaterialStockSpreadsheetMirrorBestEffort(db, {
      materialId: result.material.id,
      eventType: "LEVELS_UPDATE",
    });
    return result;
  });
}
