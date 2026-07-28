/**
 * Enfileira espelho da planilha — best-effort / mesma transação.
 * Nunca chama HTTP externo.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { readMaterialStockSpreadsheetMirrorConfig } from "./config.js";
import {
  buildMaterialStockSpreadsheetMirrorDeduplicationKey,
  buildMaterialStockSpreadsheetMirrorPayload,
} from "./queueRules.js";
import { createMaterialStockSpreadsheetOutboxRepository } from "./repository.server.js";
import type { MaterialStockSpreadsheetMirrorEventType } from "./types.js";

type Db = PrismaClient | Prisma.TransactionClient;

const MATERIAL_SELECT = {
  id: true,
  code: true,
  description: true,
  unit: true,
  quantity: true,
  contingencyQuantity: true,
  minimumQuantity: true,
  recommendedQuantity: true,
  lastStockConferenceAt: true,
  stockConferenceVersion: true,
  status: true,
} as const;

export type EnqueueMaterialStockSpreadsheetMirrorResult =
  | { ok: true; outboxId: string; deduplicated: boolean }
  | { ok: false; reason: string };

/**
 * Cria/atualiza evento PENDING. Falha de enqueue não deve abortar o fluxo
 * oficial quando chamada em modo bestEffort.
 */
export async function enqueueMaterialStockSpreadsheetMirror(
  db: Db,
  input: {
    materialId: string;
    eventType: MaterialStockSpreadsheetMirrorEventType;
    requestId?: string | null;
    now?: Date;
    maxAttempts?: number;
  }
): Promise<EnqueueMaterialStockSpreadsheetMirrorResult> {
  const materialId = input.materialId?.trim();
  if (!materialId) {
    return { ok: false, reason: "materialId obrigatório" };
  }

  const material = await db.material.findUnique({
    where: { id: materialId },
    select: MATERIAL_SELECT,
  });
  if (!material) {
    return { ok: false, reason: "material não encontrado" };
  }

  const now = input.now ?? new Date();
  const config = readMaterialStockSpreadsheetMirrorConfig();
  const repo = createMaterialStockSpreadsheetOutboxRepository(db);
  const deduplicationKey =
    buildMaterialStockSpreadsheetMirrorDeduplicationKey(material.id);

  const active = await repo.findActiveByDeduplicationKey(deduplicationKey);
  if (active) {
    const eventId = active.id;
    const payload = buildMaterialStockSpreadsheetMirrorPayload({
      eventId,
      idempotencyKey: active.idempotencyKey,
      eventType: input.eventType,
      occurredAt: now,
      material,
    });
    const nextAvailable =
      active.availableAt.getTime() > now.getTime() ? now : active.availableAt;
    const job = await repo.touchPending(active.id, {
      availableAt: nextAvailable,
      payloadJson: payload,
      materialCode: material.code,
      eventType: input.eventType,
      requestId: input.requestId ?? active.requestId,
    });
    return { ok: true, outboxId: job.id, deduplicated: true };
  }

  const outboxId = randomUUID();
  const idempotencyKey = randomUUID();
  const payload = buildMaterialStockSpreadsheetMirrorPayload({
    eventId: outboxId,
    idempotencyKey,
    eventType: input.eventType,
    occurredAt: now,
    material,
  });

  const job = await repo.create({
    id: outboxId,
    materialId: material.id,
    materialCode: material.code,
    eventType: input.eventType,
    deduplicationKey,
    idempotencyKey,
    payloadJson: payload,
    maxAttempts: input.maxAttempts ?? config.maxAttempts,
    availableAt: now,
    requestId: input.requestId ?? null,
  });

  return { ok: true, outboxId: job.id, deduplicated: false };
}

/** Enfileira sem lançar — loga falha; estoque oficial já commitado. */
export async function enqueueMaterialStockSpreadsheetMirrorBestEffort(
  db: Db,
  input: {
    materialId: string;
    eventType: MaterialStockSpreadsheetMirrorEventType;
    requestId?: string | null;
  }
): Promise<void> {
  try {
    const result = await enqueueMaterialStockSpreadsheetMirror(db, input);
    if (result.ok === false) {
      console.error(
        "[material-stock-spreadsheet-mirror] enqueue skipped:",
        result.reason
      );
    }
  } catch (error) {
    console.error(
      "[material-stock-spreadsheet-mirror] enqueue failed (estoque intacto):",
      error instanceof Error ? error.message : "erro"
    );
  }
}
