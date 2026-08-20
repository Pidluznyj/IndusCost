/**
 * Validação de conferência física — sem Prisma.
 */
import { safeTrim } from "@/src/lib/safeTrim.js";
import { computeCountDifference, hasCountDivergence } from "./inventoryCountMath.js";
import { InventoryValidationError } from "./inventoryTypes.js";

export type CreateCountSessionInput = {
  warehouseId: string;
  notes: string | null;
};

export type UpdateCountLineInput = {
  countedQuantity: number;
  justification: string | null;
  /** CAS obrigatório na rota humana — ver COUNT_LINE_VERSION_REQUIRED. */
  expectedVersion: number;
  /** Chave de idempotência por tentativa lógica. */
  operationId: string | null;
};

/** Cliente antigo (aba aberta durante o deploy) não tem como fazer CAS. */
export const COUNT_LINE_VERSION_REQUIRED = "COUNT_LINE_VERSION_REQUIRED";

export function parseCreateCountSessionBody(body: unknown): CreateCountSessionInput {
  const data = (body ?? {}) as Record<string, unknown>;
  const warehouseId = safeTrim(data.warehouseId);
  if (!warehouseId) {
    throw new InventoryValidationError("Almoxarifado é obrigatório.", "FIELD_REQUIRED");
  }
  return {
    warehouseId,
    notes: safeTrim(data.notes) || null,
  };
}

export function parseUpdateCountLineBody(body: unknown): UpdateCountLineInput {
  const data = (body ?? {}) as Record<string, unknown>;
  const raw = data.countedQuantity;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new InventoryValidationError(
      "Quantidade contada deve ser >= 0.",
      "INVALID_COUNTED_QUANTITY"
    );
  }

  // Sem expectedVersion não existe CAS — e proteção opcional em silêncio é o
  // mesmo que proteção nenhuma. Código próprio para a UI pedir recarga.
  const rawVersion = data.expectedVersion;
  const expectedVersion = Number(rawVersion);
  if (
    rawVersion == null ||
    !Number.isFinite(expectedVersion) ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    throw new InventoryValidationError(
      "Recarregue a conferência: a versão da linha é obrigatória.",
      COUNT_LINE_VERSION_REQUIRED
    );
  }

  return {
    countedQuantity: n,
    justification: safeTrim(data.justification) || null,
    expectedVersion,
    operationId: safeTrim(data.operationId) || null,
  };
}

/**
 * REGRA LEGADA — diferença contra a fotografia do START da sessão.
 *
 * NÃO usar como autoridade em contagens novas: desde o OP-10 a exigência de
 * justificativa e o roteamento de aprovação seguem a divergência FÍSICA
 * efetiva (requiresCountJustification / hasEffectiveCountDivergence, sobre o
 * adjustmentDelta da Observation). Mantida apenas para descrever o
 * comportamento das sessões anteriores ao OP-10.
 */
export function validateCountLineUpdate(
  systemQuantity: number,
  input: { countedQuantity: number; justification: string | null }
): { differenceQuantity: number; differencePercent: number } {
  const { differenceQuantity, differencePercent } = computeCountDifference(
    systemQuantity,
    input.countedQuantity
  );
  if (hasCountDivergence(differenceQuantity) && !input.justification?.trim()) {
    throw new InventoryValidationError(
      "Divergência exige justificativa.",
      "JUSTIFICATION_REQUIRED"
    );
  }
  return { differenceQuantity, differencePercent };
}

export const COUNT_SESSION_EDITABLE_STATUSES = new Set([
  "OPEN",
  "COUNTING",
  "WAITING_APPROVAL",
]);

export const COUNT_SESSION_LINE_EDITABLE_STATUSES = new Set(["COUNTING"]);
