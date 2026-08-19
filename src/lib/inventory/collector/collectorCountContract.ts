/**
 * FASE 2D — contrato HTTP da contagem via DEVICE. Motor puro (sem Prisma).
 *
 * O body do Collector carrega APENAS a intenção de contagem:
 *
 *   { countedQuantity, justification?, expectedVersion, operationId }
 *
 * Identidade NUNCA vem do body: actorType/userId/deviceId nascem server-side
 * (middleware da 2C). O contrato é ESTRITO nesse ponto — qualquer campo de
 * identidade presente no body é rejeitado com erro, em vez de silenciosamente
 * ignorado: um cliente que tenta escolher identidade está errado ou hostil, e
 * ambos merecem um erro explícito.
 *
 * expectedVersion e operationId são OBRIGATÓRIOS no DEVICE: o coletor de chão
 * de fábrica opera em rede instável — retry sem idempotência e gravação sem
 * CAS são exatamente os acidentes que a 2B eliminou.
 */
import { safeTrim } from "@/src/lib/safeTrim.js";
import { COUNT_LINE_VERSION_REQUIRED } from "./../inventoryCountValidation.js";
import { InventoryValidationError } from "./../inventoryTypes.js";

export const COLLECTOR_IDENTITY_FIELD_REJECTED = "COLLECTOR_IDENTITY_FIELD_REJECTED";
export const COLLECTOR_OPERATION_ID_REQUIRED = "COLLECTOR_OPERATION_ID_REQUIRED";

/** Campos que descrevem identidade/origem — proibidos no body do Collector. */
export const COLLECTOR_FORBIDDEN_IDENTITY_FIELDS = [
  "actorType",
  "userId",
  "deviceId",
  "tailscaleStableNodeId",
  "stableNodeId",
  "nodeName",
  "tailscaleNodeName",
  "loginName",
  "ip",
  "peer",
  "remoteAddress",
] as const;

export type CollectorCountBody = {
  countedQuantity: number;
  justification: string | null;
  expectedVersion: number;
  operationId: string;
};

export function parseCollectorCountBody(body: unknown): CollectorCountBody {
  const data = (body ?? {}) as Record<string, unknown>;

  for (const field of COLLECTOR_FORBIDDEN_IDENTITY_FIELDS) {
    if (field in data) {
      throw new InventoryValidationError(
        "Identidade do dispositivo não pode vir no corpo da requisição.",
        COLLECTOR_IDENTITY_FIELD_REJECTED
      );
    }
  }

  const counted = Number(data.countedQuantity);
  if (!Number.isFinite(counted) || counted < 0) {
    throw new InventoryValidationError(
      "Quantidade contada deve ser >= 0.",
      "INVALID_COUNTED_QUANTITY"
    );
  }

  const rawVersion = data.expectedVersion;
  const expectedVersion = Number(rawVersion);
  if (
    rawVersion == null ||
    !Number.isFinite(expectedVersion) ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    throw new InventoryValidationError(
      "expectedVersion é obrigatório na contagem via dispositivo.",
      COUNT_LINE_VERSION_REQUIRED
    );
  }

  const operationId = safeTrim(data.operationId);
  if (!operationId) {
    throw new InventoryValidationError(
      "operationId é obrigatório na contagem via dispositivo.",
      COLLECTOR_OPERATION_ID_REQUIRED
    );
  }

  return {
    countedQuantity: counted,
    justification: safeTrim(data.justification) || null,
    expectedVersion,
    operationId,
  };
}
