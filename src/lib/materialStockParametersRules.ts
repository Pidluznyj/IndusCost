/**
 * Regras puras — edição dos parâmetros de nível (contingência/mínimo/recomendado).
 * null = não configurado; 0 é valor configurado válido.
 */
import { safeTrim } from "@/src/lib/safeTrim.js";
import {
  isStockLevelConfigured,
  roundMaterialStockQuantity,
} from "./materialStockConferenceMath.js";
import { MaterialStockConferenceError } from "./materialStockConferenceRules.js";
import { validateStockLevelHierarchy } from "./materialStockLevelRules.js";

export type ParsedMaterialStockParameters = {
  contingencyQuantity: number | null;
  minimumQuantity: number | null;
  recommendedQuantity: number | null;
  reason: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseNullableLevel(
  value: unknown,
  field: "contingencyQuantity" | "minimumQuantity" | "recommendedQuantity"
): number | null {
  if (value === undefined) {
    throw new MaterialStockConferenceError(
      "REQUIRED_FIELD",
      `${field} é obrigatório (use null para não configurado).`,
      field
    );
  }
  if (value === null || value === "") return null;
  const n = roundMaterialStockQuantity(value);
  if (!Number.isFinite(n)) {
    throw new MaterialStockConferenceError(
      "INVALID_FIELD",
      `${field} inválido.`,
      field
    );
  }
  if (n < 0) {
    throw new MaterialStockConferenceError(
      "INVALID_FIELD",
      `${field} não pode ser negativo.`,
      field
    );
  }
  return n;
}

/**
 * Valida payload de edição.
 * - null permitido (não configurado)
 * - 0 permitido (configurado)
 * - com os três configurados: contingência <= mínimo <= recomendado
 */
export function parseMaterialStockParametersCommand(
  body: Record<string, unknown>
): ParsedMaterialStockParameters {
  const contingencyQuantity = parseNullableLevel(
    body.contingencyQuantity,
    "contingencyQuantity"
  );
  const minimumQuantity = parseNullableLevel(
    body.minimumQuantity,
    "minimumQuantity"
  );
  const recommendedQuantity = parseNullableLevel(
    body.recommendedQuantity,
    "recommendedQuantity"
  );

  const allConfigured =
    isStockLevelConfigured(contingencyQuantity) &&
    isStockLevelConfigured(minimumQuantity) &&
    isStockLevelConfigured(recommendedQuantity);

  if (allConfigured) {
    const hierarchy = validateStockLevelHierarchy({
      contingencyQuantity,
      minimumQuantity,
      recommendedQuantity,
    });
    if (!hierarchy.ok) {
      throw new MaterialStockConferenceError(
        "INVALID_FIELD",
        "Hierarquia inválida: contingência <= mínimo <= recomendado.",
        "minimumQuantity"
      );
    }
  } else {
    // Comparações parciais quando dois lados estão configurados.
    if (
      contingencyQuantity != null &&
      minimumQuantity != null &&
      !(contingencyQuantity <= minimumQuantity)
    ) {
      throw new MaterialStockConferenceError(
        "INVALID_FIELD",
        "Hierarquia inválida: contingência <= mínimo <= recomendado.",
        "minimumQuantity"
      );
    }
    if (
      minimumQuantity != null &&
      recommendedQuantity != null &&
      !(minimumQuantity <= recommendedQuantity)
    ) {
      throw new MaterialStockConferenceError(
        "INVALID_FIELD",
        "Hierarquia inválida: contingência <= mínimo <= recomendado.",
        "recommendedQuantity"
      );
    }
    if (
      contingencyQuantity != null &&
      recommendedQuantity != null &&
      !(contingencyQuantity <= recommendedQuantity)
    ) {
      throw new MaterialStockConferenceError(
        "INVALID_FIELD",
        "Hierarquia inválida: contingência <= mínimo <= recomendado.",
        "recommendedQuantity"
      );
    }
  }

  const reasonRaw = safeTrim(body.reason ?? body.notes ?? body.observation);
  const reason = reasonRaw ? reasonRaw.slice(0, 2000) : null;

  return {
    contingencyQuantity,
    minimumQuantity,
    recommendedQuantity,
    reason,
  };
}

export function assertMaterialStockMaterialId(value: unknown): string {
  const materialId = safeTrim(value);
  if (!materialId || !UUID_RE.test(materialId)) {
    throw new MaterialStockConferenceError(
      "REQUIRED_FIELD",
      "materialId é obrigatório e deve ser UUID.",
      "materialId"
    );
  }
  return materialId;
}

export function snapshotStockLevels(row: {
  contingencyQuantity: unknown;
  minimumQuantity: unknown;
  recommendedQuantity: unknown;
}): {
  contingencyQuantity: number | null;
  minimumQuantity: number | null;
  recommendedQuantity: number | null;
} {
  const toNullable = (v: unknown): number | null => {
    if (!isStockLevelConfigured(v)) return null;
    const n = roundMaterialStockQuantity(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    contingencyQuantity: toNullable(row.contingencyQuantity),
    minimumQuantity: toNullable(row.minimumQuantity),
    recommendedQuantity: toNullable(row.recommendedQuantity),
  };
}
