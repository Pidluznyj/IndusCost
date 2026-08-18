/**
 * OP-10 — serviço de aplicação canônico da conferência física (server-only).
 *
 * Única implementação de "registrar contagem". A rota humana já entra por aqui;
 * a futura rota DEVICE reutiliza exatamente esta operação — a lógica que grava
 * countedQuantity não pode voltar a existir em dois lugares.
 *
 * Nunca altera InventoryBalance: apenas o LÊ sob FOR UPDATE para fotografar o
 * saldo esperado no instante da contagem. O ajuste continua sendo gerado
 * exclusivamente por createInventoryMovement.
 */
import type { PrismaClient } from "@prisma/client";
import { computeObservationDelta } from "./inventoryCountObservation.js";
import {
  COUNT_SESSION_LINE_EDITABLE_STATUSES,
  validateCountLineUpdate,
} from "./inventoryCountValidation.js";
import {
  decimalQuantity,
  getOrCreateInventoryBalanceForUpdate,
  type InventoryTx,
} from "./inventoryRepository.server.js";
import { inventoryDec } from "./inventorySerialization.server.js";
import { InventoryValidationError } from "./inventoryTypes.js";

export type RecordInventoryCountActor = {
  userId: string;
  permissions?: readonly string[];
};

export type RecordInventoryCountInput = {
  sessionId: string;
  lineId: string;
  countedQuantity: number;
  justification?: string | null;
  /**
   * Fundação de idempotência (FASE 2B). Aqui apenas persistido sob UNIQUE —
   * replay seguro / conflito de payload ainda NÃO estão implementados.
   */
  operationId?: string | null;
  /** DEVICE só será ativado com o Device Registry — FASE 2B. */
  actorType?: "USER" | "DEVICE";
  deviceId?: string | null;
};

/**
 * Núcleo da contagem — exige uma transação JÁ ABERTA.
 *
 * O saldo esperado é lido sob lock (`getOrCreateInventoryBalanceForUpdate` →
 * SELECT ... FOR UPDATE), de modo que movimentações concorrentes, ou a data
 * retroativa de um lançamento, nunca influenciam o delta: vale apenas o saldo
 * materializado visível no instante da contagem.
 */
export async function recordInventoryCountInTx(
  tx: InventoryTx,
  input: RecordInventoryCountInput,
  actor: RecordInventoryCountActor
) {
  const session = await tx.inventoryCountSession.findUnique({
    where: { id: input.sessionId },
  });
  if (!session) {
    throw new InventoryValidationError("Conferência não encontrada.", "SESSION_NOT_FOUND");
  }
  if (!COUNT_SESSION_LINE_EDITABLE_STATUSES.has(session.status)) {
    throw new InventoryValidationError(
      "Conferência não permite edição de linhas neste status.",
      "SESSION_LOCKED"
    );
  }

  const line = await tx.inventoryCountLine.findFirst({
    where: { id: input.lineId, sessionId: input.sessionId },
  });
  if (!line) {
    throw new InventoryValidationError("Linha não encontrada.", "LINE_NOT_FOUND");
  }
  if (line.generatedMovementId) {
    throw new InventoryValidationError("Linha já possui ajuste gerado.", "ADJUSTMENT_EXISTS");
  }

  // Lock do escopo item/almoxarifado/endereço — mesmo helper canônico do ledger.
  const balance = await getOrCreateInventoryBalanceForUpdate(
    tx,
    line.itemId,
    line.warehouseId,
    line.locationId
  );

  // Ainda sob lock: saldo esperado = saldo materializado agora.
  const expectedQuantity = balance.physicalQuantity;

  // Compatibilidade: a diferença exibida e a exigência de justificativa
  // continuam medidas contra a fotografia do START da sessão.
  const systemQuantity = inventoryDec(line.systemQuantity);
  const { differenceQuantity, differencePercent } = validateCountLineUpdate(systemQuantity, {
    countedQuantity: input.countedQuantity,
    justification: input.justification ?? null,
  });

  const countedQuantity = input.countedQuantity;
  const adjustmentDelta = computeObservationDelta(expectedQuantity, countedQuantity);
  const justification = input.justification?.trim() || null;

  // Append-only: recontagem cria nova Observation, nunca edita a anterior.
  const observation = await tx.inventoryCountObservation.create({
    data: {
      lineId: line.id,
      operationId: input.operationId?.trim() || null,
      expectedQuantity: decimalQuantity(expectedQuantity),
      countedQuantity: decimalQuantity(countedQuantity),
      adjustmentDelta: decimalQuantity(adjustmentDelta),
      justification,
      actorType: input.actorType ?? "USER",
      userId: actor.userId,
      deviceId: input.deviceId?.trim() || null,
    },
  });

  // `version` só é incrementada; a exigência de expectedVersion (CAS/409) é
  // escopo da FASE 2B. Escritas concorrentes na mesma linha serializam no
  // lock do saldo acima, então o incremento lido-e-gravado é seguro aqui.
  const updated = await tx.inventoryCountLine.update({
    where: { id: line.id },
    data: {
      countedQuantity: decimalQuantity(countedQuantity),
      differenceQuantity: decimalQuantity(differenceQuantity),
      differencePercent: decimalQuantity(differencePercent),
      justification,
      currentObservationId: observation.id,
      version: (line.version ?? 0) + 1,
    },
  });

  return { line: updated, observation };
}

/** Registra uma contagem física dentro de UMA transação PostgreSQL. */
export async function recordInventoryCount(
  prisma: PrismaClient,
  input: RecordInventoryCountInput,
  actor: RecordInventoryCountActor
) {
  return prisma.$transaction(async (tx: InventoryTx) =>
    recordInventoryCountInTx(tx, input, actor)
  );
}
