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
 *
 * FASE 2B — ordem canônica de locks, sempre nesta sequência:
 *
 *   1. InventoryBalance FOR UPDATE          (preserva a serialização da 2A)
 *   2. INSERT InventoryCountOperation       (ON CONFLICT DO NOTHING)
 *   3. INSERT InventoryCountObservation
 *   4. CAS UPDATE InventoryCountLine        (WHERE version = expectedVersion)
 *   5. completar a operação (resultSnapshot)
 *   6. auditoria COUNT_RECORDED
 *
 * A ordem é global e única: o saldo SEMPRE vem antes do índice de operação. Se
 * alguma transação invertesse isso, uma poderia segurar o saldo esperando o
 * índice enquanto a outra segura o índice esperando o saldo — deadlock.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { writeInventoryAuditLogInTx } from "./inventoryAudit.server.js";
import { computeCountDifference } from "./inventoryCountMath.js";
import {
  computeObservationDelta,
  requiresCountJustification,
} from "./inventoryCountObservation.js";
import { resolveRecordedCountJustification } from "./inventoryCountDeviceJustification.js";
import {
  buildCountRequestHash,
  type CountActorType,
} from "./inventoryCountRequestHash.js";
import { COUNT_SESSION_LINE_EDITABLE_STATUSES } from "./inventoryCountValidation.js";
import {
  decimalQuantity,
  getOrCreateInventoryBalanceForUpdate,
  type InventoryTx,
} from "./inventoryRepository.server.js";
import { inventoryDec } from "./inventorySerialization.server.js";
import { InventoryValidationError } from "./inventoryTypes.js";

/** Conflito de versão (CAS perdido) — HTTP 409. */
export const COUNT_LINE_VERSION_CONFLICT = "COUNT_LINE_VERSION_CONFLICT";
/** Mesma chave de operação com payload diferente — HTTP 409. */
export const COUNT_OPERATION_IDEMPOTENCY_CONFLICT = "COUNT_OPERATION_IDEMPOTENCY_CONFLICT";

export type RecordInventoryCountActor = {
  /** null para ator DEVICE — dispositivo não é usuário humano falso. */
  userId: string | null;
  permissions?: readonly string[];
};

export type RecordInventoryCountInput = {
  sessionId: string;
  lineId: string;
  countedQuantity: number;
  justification?: string | null;
  /** CAS obrigatório: a versão que o cliente leu. */
  expectedVersion: number;
  /** Chave de idempotência. Sem ela não há replay — cada chamada executa. */
  operationId?: string | null;
  /**
   * Definido SEMPRE server-side. O browser humano não escolhe ator: a rota
   * humana fixa USER. DEVICE só será emitido pelo Collector, com Device
   * Registry, em fase futura.
   */
  actorType?: CountActorType;
  deviceId?: string | null;
};

/** DTO devolvido pela operação — é ele que o replay reproduz. */
export type RecordInventoryCountSnapshot = {
  lineId: string;
  sessionId: string;
  countedQuantity: number;
  differenceQuantity: number;
  differencePercent: number;
  justification: string | null;
  expectedQuantity: number;
  adjustmentDelta: number;
  observationId: string;
  version: number;
  previousVersion: number;
};

type CountLineRow = NonNullable<
  Awaited<ReturnType<InventoryTx["inventoryCountLine"]["findFirst"]>>
>;
type CountObservationRow = NonNullable<
  Awaited<ReturnType<InventoryTx["inventoryCountObservation"]["findFirst"]>>
>;

export type RecordInventoryCountResult = {
  /** true quando a resposta veio de uma operação já concluída antes. */
  replayed: boolean;
  snapshot: RecordInventoryCountSnapshot;
  /** Linha/Observation vivas só existem no caminho que executou de fato. */
  line: CountLineRow | null;
  observation: CountObservationRow | null;
};

function resolveReplaySnapshot(
  operation: {
    requestHash: string;
    lineId: string;
    actorType: string;
    userId: string | null;
    resultSnapshot: Prisma.JsonValue | null;
  },
  expected: { requestHash: string; lineId: string; actorType: string; userId: string | null }
): RecordInventoryCountSnapshot {
  const sameRequest =
    operation.requestHash === expected.requestHash &&
    operation.lineId === expected.lineId &&
    operation.actorType === expected.actorType &&
    (operation.userId ?? null) === (expected.userId ?? null);

  if (!sameRequest) {
    throw new InventoryValidationError(
      "operationId já utilizado com outro conteúdo.",
      COUNT_OPERATION_IDEMPOTENCY_CONFLICT
    );
  }
  if (!operation.resultSnapshot) {
    // Só ocorre se a operação for gravada fora do serviço canônico: uma
    // operação commitada sem snapshot não é reproduzível.
    throw new InventoryValidationError(
      "Operação de contagem sem resultado reproduzível.",
      COUNT_OPERATION_IDEMPOTENCY_CONFLICT
    );
  }
  return operation.resultSnapshot as unknown as RecordInventoryCountSnapshot;
}

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
): Promise<RecordInventoryCountResult> {
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

  const actorType: CountActorType = input.actorType ?? "USER";
  const deviceId = input.deviceId?.trim() || null;
  const operationId = input.operationId?.trim() || null;
  const previousVersion = Math.trunc(input.expectedVersion);
  // DEVICE: o client não escolhe a razão oficial. Hash sem justification do
  // browser para retry idêntico (qty + version + operationId) não colidir
  // com a constante injetada depois do lock.
  const requestHash = buildCountRequestHash({
    lineId: input.lineId,
    countedQuantity: input.countedQuantity,
    justification: actorType === "DEVICE" ? null : input.justification,
    expectedVersion: previousVersion,
    actorType,
    userId: actor.userId,
    deviceId,
  });

  // (1) Lock do escopo item/almoxarifado/endereço — mesmo helper canônico do
  // ledger, e sempre o PRIMEIRO lock adquirido.
  const balance = await getOrCreateInventoryBalanceForUpdate(
    tx,
    line.itemId,
    line.warehouseId,
    line.locationId
  );

  // (2) Aquisição da operação. INSERT ... ON CONFLICT DO NOTHING: count 1 =
  // esta transação é a dona da execução; count 0 = a chave já foi commitada por
  // outra. Nada de provocar violação de UNIQUE e continuar operando — isso
  // deixaria a transação PostgreSQL em estado aborted.
  if (operationId) {
    const acquired = await tx.inventoryCountOperation.createMany({
      data: [
        {
          operationId,
          sessionId: input.sessionId,
          lineId: input.lineId,
          requestHash,
          expectedVersion: previousVersion,
          actorType,
          userId: actor.userId,
          deviceId,
        },
      ],
      skipDuplicates: true,
    });

    if (acquired.count === 0) {
      const existing = await tx.inventoryCountOperation.findUnique({ where: { operationId } });
      if (!existing) {
        throw new InventoryValidationError(
          "Operação de contagem em estado inconsistente.",
          COUNT_OPERATION_IDEMPOTENCY_CONFLICT
        );
      }
      const snapshot = resolveReplaySnapshot(existing, {
        requestHash,
        lineId: input.lineId,
        actorType,
        userId: actor.userId,
      });
      // Replay: nenhuma Observation, nenhum incremento de version, nenhum audit
      // novo. Devolve o resultado ORIGINAL daquela operação — e não o estado
      // atual da linha, que pode já ter sido recontada depois.
      return { replayed: true, snapshot, line: null, observation: null };
    }
  }

  // Ainda sob lock: saldo esperado = saldo materializado agora.
  const expectedQuantity = balance.physicalQuantity;
  const countedQuantity = input.countedQuantity;

  // Divergência efetiva: contado x saldo real sob lock. É esta — e não a
  // diferença contra a foto do START — que decide se há divergência física.
  const adjustmentDelta = computeObservationDelta(expectedQuantity, countedQuantity);

  const justification = resolveRecordedCountJustification({
    actorType,
    effectiveDelta: adjustmentDelta,
    clientJustification: input.justification,
  });

  // A decisão só acontece DEPOIS do lock: antes disso expectedQuantity não
  // existe corretamente e a exigência sairia do systemQuantity congelado.
  // DEVICE já recebeu justificativa canônica quando o delta efetivo exige.
  // HUMAN continua JUSTIFICATION_REQUIRED sem texto.
  // Lançar aqui aborta a transação inteira — nem Observation nem operação
  // sobrevivem, então o operationId não fica envenenado.
  if (requiresCountJustification(adjustmentDelta, justification)) {
    throw new InventoryValidationError(
      "Divergência exige justificativa.",
      "JUSTIFICATION_REQUIRED"
    );
  }

  // Campos legados: leitura histórica/visual contra a fotografia do START.
  // Preservados como sempre foram — não são autoridade de nada.
  const systemQuantity = inventoryDec(line.systemQuantity);
  const { differenceQuantity, differencePercent } = computeCountDifference(
    systemQuantity,
    countedQuantity
  );

  // (3) Append-only: recontagem cria nova Observation, nunca edita a anterior.
  const observation = await tx.inventoryCountObservation.create({
    data: {
      lineId: line.id,
      operationId,
      expectedQuantity: decimalQuantity(expectedQuantity),
      countedQuantity: decimalQuantity(countedQuantity),
      adjustmentDelta: decimalQuantity(adjustmentDelta),
      justification,
      actorType,
      userId: actor.userId,
      deviceId,
    },
  });

  // (4) CAS: o UPDATE condicional é a AUTORIDADE. Nada de SELECT + if + UPDATE,
  // que teria TOCTOU. Exatamente uma transação pode vencer para uma versão.
  const cas = await tx.inventoryCountLine.updateMany({
    where: { id: line.id, version: previousVersion },
    data: {
      countedQuantity: decimalQuantity(countedQuantity),
      differenceQuantity: decimalQuantity(differenceQuantity),
      differencePercent: decimalQuantity(differencePercent),
      justification,
      currentObservationId: observation.id,
      version: { increment: 1 },
    },
  });
  if (cas.count === 0) {
    // Aborta tudo: Observation, operação e auditoria desta transação somem.
    throw new InventoryValidationError(
      "A linha foi alterada por outra contagem. Recarregue e decida novamente.",
      COUNT_LINE_VERSION_CONFLICT
    );
  }

  const version = previousVersion + 1;
  const snapshot: RecordInventoryCountSnapshot = {
    lineId: line.id,
    sessionId: input.sessionId,
    countedQuantity,
    differenceQuantity,
    differencePercent,
    justification,
    expectedQuantity,
    adjustmentDelta,
    observationId: observation.id,
    version,
    previousVersion,
  };

  // (5) Conclui a operação na MESMA transação: ela só existe se commitar.
  if (operationId) {
    await tx.inventoryCountOperation.update({
      where: { operationId },
      data: {
        observationId: observation.id,
        resultVersion: version,
        resultSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // (6) Auditoria da contagem — o único evento do ciclo de vida que faltava.
  // Registra a transição de versão (que não tem lugar na Observation) e aponta
  // para ela; quantidades não são duplicadas aqui.
  await writeInventoryAuditLogInTx(tx, {
    entityType: "InventoryCountLine",
    entityId: line.id,
    action: "COUNT_RECORDED",
    beforeJson: { version: previousVersion, currentObservationId: line.currentObservationId },
    afterJson: {
      version,
      sessionId: input.sessionId,
      observationId: observation.id,
      operationId,
      actorType,
      deviceId,
    },
    userId: actor.userId,
  });

  const updated = await tx.inventoryCountLine.findFirst({ where: { id: line.id } });
  return { replayed: false, snapshot, line: updated, observation };
}

/** Registra uma contagem física dentro de UMA transação PostgreSQL. */
export async function recordInventoryCount(
  prisma: PrismaClient,
  input: RecordInventoryCountInput,
  actor: RecordInventoryCountActor
): Promise<RecordInventoryCountResult> {
  return prisma.$transaction(async (tx: InventoryTx) =>
    recordInventoryCountInTx(tx, input, actor)
  );
}
