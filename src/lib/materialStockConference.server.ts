/**
 * Operação oficial de conferência manual — atualiza Material.quantity + histórico.
 * Transacional. Não altera custos / BOM / Nomus / ledger SC.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  assertMaterialStockIdempotencyKey,
  assertStockConferenceConcurrency,
  buildConferenceDifference,
  MaterialStockConferenceError,
  parseMaterialStockConferenceCommand,
  type ParsedMaterialStockConferenceCommand,
} from "./materialStockConferenceRules.js";
import { resolveMaterialStockStatus } from "./materialStockLevelRules.js";
import { enqueueMaterialStockSpreadsheetMirrorBestEffort } from "./materialStockSpreadsheetMirror/enqueue.server.js";
import { roundMaterialStockQuantity } from "./materialStockConferenceMath.js";

export type MaterialStockConferenceActor = {
  id: string;
  name?: string | null;
  email?: string | null;
};

export type MaterialStockConferenceResult = {
  ok: true;
  created: boolean;
  idempotent: boolean;
  conference: {
    id: string;
    materialId: string;
    previousQuantity: number;
    reportedQuantity: number;
    difference: number;
    unitSnapshot: string;
    reason: string;
    notes: string | null;
    userId: string;
    userName: string | null;
    recordedAt: string;
    source: string;
    previousVersion: number | null;
    previousUpdatedAt: string | null;
    idempotencyKey: string | null;
  };
  material: {
    id: string;
    code: string;
    quantity: number;
    stockConferenceVersion: number;
    lastStockConferenceAt: string | null;
    lastStockConferenceUserId: string | null;
    updatedAt: string | null;
    stockStatus: string;
  };
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

function serializeConference(
  row: {
    id: string;
    materialId: string;
    previousQuantity: unknown;
    reportedQuantity: unknown;
    difference: unknown;
    unitSnapshot: string;
    reason: string;
    notes: string | null;
    userId: string;
    userName: string | null;
    recordedAt: Date;
    source: string;
    previousVersion: number | null;
    previousUpdatedAt: Date | null;
    idempotencyKey: string | null;
  }
): MaterialStockConferenceResult["conference"] {
  return {
    id: row.id,
    materialId: row.materialId,
    previousQuantity: toNumber(row.previousQuantity),
    reportedQuantity: toNumber(row.reportedQuantity),
    difference: toNumber(row.difference),
    unitSnapshot: row.unitSnapshot,
    reason: row.reason,
    notes: row.notes,
    userId: row.userId,
    userName: row.userName,
    recordedAt: row.recordedAt.toISOString(),
    source: row.source,
    previousVersion: row.previousVersion,
    previousUpdatedAt: toIso(row.previousUpdatedAt),
    idempotencyKey: row.idempotencyKey,
  };
}

function serializeMaterial(row: {
  id: string;
  code: string;
  quantity: unknown;
  contingencyQuantity: unknown;
  minimumQuantity: unknown;
  recommendedQuantity: unknown;
  stockConferenceVersion: number;
  lastStockConferenceAt: Date | null;
  lastStockConferenceUserId: string | null;
  updatedAt: Date | null;
}): MaterialStockConferenceResult["material"] {
  return {
    id: row.id,
    code: row.code,
    quantity: toNumber(row.quantity),
    stockConferenceVersion: row.stockConferenceVersion,
    lastStockConferenceAt: toIso(row.lastStockConferenceAt),
    lastStockConferenceUserId: row.lastStockConferenceUserId,
    updatedAt: toIso(row.updatedAt),
    stockStatus: resolveMaterialStockStatus({
      currentQuantity: row.quantity,
      contingencyQuantity: row.contingencyQuantity,
      minimumQuantity: row.minimumQuantity,
      recommendedQuantity: row.recommendedQuantity,
    }),
  };
}

async function loadConferenceByIdempotency(
  db: PrismaClient | Prisma.TransactionClient,
  idempotencyKey: string
) {
  return db.materialStockConference.findUnique({
    where: { idempotencyKey },
  });
}

async function buildResultFromExisting(
  db: PrismaClient | Prisma.TransactionClient,
  conferenceId: string,
  idempotent: boolean,
  created: boolean
): Promise<MaterialStockConferenceResult> {
  const conference = await db.materialStockConference.findUniqueOrThrow({
    where: { id: conferenceId },
  });
  const material = await db.material.findUniqueOrThrow({
    where: { id: conference.materialId },
    select: {
      id: true,
      code: true,
      quantity: true,
      contingencyQuantity: true,
      minimumQuantity: true,
      recommendedQuantity: true,
      stockConferenceVersion: true,
      lastStockConferenceAt: true,
      lastStockConferenceUserId: true,
      updatedAt: true,
    },
  });
  return {
    ok: true,
    created,
    idempotent,
    conference: serializeConference(conference),
    material: serializeMaterial(material),
  };
}

export async function recordMaterialStockConference(
  db: PrismaClient,
  input: {
    body: Record<string, unknown>;
    idempotencyKeyHeader: string | null | undefined;
    actor: MaterialStockConferenceActor;
    source?: "TABLET_CONFERENCE" | "MANUAL_API";
    now?: Date;
  }
): Promise<MaterialStockConferenceResult> {
  const idempotencyKey = assertMaterialStockIdempotencyKey(input.idempotencyKeyHeader);
  const command = parseMaterialStockConferenceCommand(input.body);
  const existing = await loadConferenceByIdempotency(db, idempotencyKey);
  if (existing) {
    return buildResultFromExisting(db, existing.id, true, false);
  }

  const actorName =
    input.actor.name?.trim() || input.actor.email?.trim() || input.actor.id;
  const now = input.now ?? new Date();
  const source = input.source ?? "TABLET_CONFERENCE";

  try {
    return await db.$transaction(async (tx) => {
      const again = await loadConferenceByIdempotency(tx, idempotencyKey);
      if (again) {
        return buildResultFromExisting(tx, again.id, true, false);
      }

      const material = await tx.material.findUnique({
        where: { id: command.materialId },
        select: {
          id: true,
          code: true,
          unit: true,
          quantity: true,
          contingencyQuantity: true,
          minimumQuantity: true,
          recommendedQuantity: true,
          stockConferenceVersion: true,
          lastStockConferenceAt: true,
          lastStockConferenceUserId: true,
          updatedAt: true,
          status: true,
        },
      });
      if (!material) {
        throw new MaterialStockConferenceError(
          "NOT_FOUND",
          "Matéria-prima não encontrada.",
          "materialId"
        );
      }

      try {
        assertStockConferenceConcurrency({
          expectedVersion: command.expectedVersion,
          expectedUpdatedAt: command.expectedUpdatedAt,
          actualVersion: material.stockConferenceVersion,
          actualUpdatedAt: material.updatedAt,
        });
      } catch (err) {
        if (err instanceof MaterialStockConferenceError && err.code === "CONFLICT") {
          throw new MaterialStockConferenceError(
            "CONFLICT",
            err.message,
            err.field,
            {
              currentQuantity: toNumber(material.quantity),
              stockConferenceVersion: material.stockConferenceVersion,
              updatedAt: toIso(material.updatedAt),
            }
          );
        }
        throw err;
      }

      const { previous, reported, difference } = buildConferenceDifference(
        material.quantity,
        command.reportedQuantity
      );
      const previousVersion = material.stockConferenceVersion;
      const previousUpdatedAt = material.updatedAt;

      const conference = await tx.materialStockConference.create({
        data: {
          materialId: material.id,
          previousQuantity: previous,
          reportedQuantity: reported,
          difference,
          unitSnapshot: material.unit,
          reason: command.reason,
          notes: command.notes,
          userId: input.actor.id,
          userName: actorName,
          recordedAt: now,
          source,
          previousVersion,
          previousUpdatedAt,
          idempotencyKey,
        },
      });

      const updated = await tx.material.updateMany({
        where: {
          id: material.id,
          stockConferenceVersion: previousVersion,
        },
        data: {
          quantity: reported,
          stockConferenceVersion: previousVersion + 1,
          lastStockConferenceAt: now,
          lastStockConferenceUserId: input.actor.id,
        },
      });
      if (updated.count !== 1) {
        throw new MaterialStockConferenceError(
          "CONFLICT",
          "O material foi alterado durante a conferência. Recarregue e confirme novamente.",
          "expectedVersion",
          {
            currentQuantity: toNumber(material.quantity),
            stockConferenceVersion: material.stockConferenceVersion,
            updatedAt: toIso(material.updatedAt),
          }
        );
      }

      const materialAfter = await tx.material.findUniqueOrThrow({
        where: { id: material.id },
        select: {
          id: true,
          code: true,
          quantity: true,
          contingencyQuantity: true,
          minimumQuantity: true,
          recommendedQuantity: true,
          stockConferenceVersion: true,
          lastStockConferenceAt: true,
          lastStockConferenceUserId: true,
          updatedAt: true,
        },
      });

      return {
        ok: true as const,
        created: true,
        idempotent: false,
        conference: serializeConference(conference),
        material: serializeMaterial(materialAfter),
      };
    }).then(async (result) => {
      // Após commit: falha de outbox/Excel nunca reverte o estoque oficial.
      if (result.created && !result.idempotent) {
        await enqueueMaterialStockSpreadsheetMirrorBestEffort(db, {
          materialId: result.material.id,
          eventType: "CONFERENCE",
        });
      }
      return result;
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const replay = await loadConferenceByIdempotency(db, idempotencyKey);
      if (replay) {
        return buildResultFromExisting(db, replay.id, true, false);
      }
    }
    throw error;
  }
}

export function materialStockConferenceHttpStatus(
  error: MaterialStockConferenceError
): number {
  switch (error.code) {
    case "REQUIRED_FIELD":
    case "INVALID_FIELD":
    case "PAYLOAD_TOO_LARGE":
      return 400;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    default:
      return 500;
  }
}

export function parseConferenceBodyAndKey(input: {
  body: unknown;
  idempotencyKeyHeader: string | null | undefined;
}): {
  command: ParsedMaterialStockConferenceCommand;
  idempotencyKey: string;
} {
  const body =
    input.body && typeof input.body === "object"
      ? (input.body as Record<string, unknown>)
      : {};
  return {
    command: parseMaterialStockConferenceCommand(body),
    idempotencyKey: assertMaterialStockIdempotencyKey(input.idempotencyKeyHeader),
  };
}
