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
};

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
  return {
    countedQuantity: n,
    justification: safeTrim(data.justification) || null,
  };
}

export function validateCountLineUpdate(
  systemQuantity: number,
  input: UpdateCountLineInput
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
