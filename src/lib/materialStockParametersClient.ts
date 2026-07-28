/**
 * Cliente browser-safe — PATCH parâmetros de nível + validação de formulário.
 */
import { validateStockLevelHierarchy } from "./materialStockLevelRules.js";
import {
  isStockLevelConfigured,
  roundMaterialStockQuantity,
} from "./materialStockConferenceMath.js";
import type { MaterialStockTabletListItem } from "./materialStockTabletTypes.js";
import type { MaterialStockStatus } from "./materialStockLevelRules.js";

export type MaterialStockParametersApiResult = {
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

export type ParseLevelInputResult =
  | { ok: true; value: number | null }
  | { ok: false; reason: "INVALID" | "NEGATIVE" };

/** Vazio / "null" → null (não configurado). "0" é valor configurado. */
export function parseStockLevelParameterInput(raw: string): ParseLevelInputResult {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") {
    return { ok: true, value: null };
  }
  const normalized = trimmed.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return { ok: false, reason: "INVALID" };
  }
  const value = roundMaterialStockQuantity(normalized);
  if (!Number.isFinite(value)) return { ok: false, reason: "INVALID" };
  if (value < 0) return { ok: false, reason: "NEGATIVE" };
  return { ok: true, value };
}

export function validateStockParametersForm(input: {
  contingencyQuantity: number | null;
  minimumQuantity: number | null;
  recommendedQuantity: number | null;
}): { ok: true } | { ok: false; message: string } {
  const { contingencyQuantity: c, minimumQuantity: m, recommendedQuantity: r } = input;
  const allConfigured =
    isStockLevelConfigured(c) && isStockLevelConfigured(m) && isStockLevelConfigured(r);
  if (allConfigured) {
    const hierarchy = validateStockLevelHierarchy({
      contingencyQuantity: c,
      minimumQuantity: m,
      recommendedQuantity: r,
    });
    if (!hierarchy.ok) {
      return {
        ok: false,
        message: "Hierarquia inválida: contingência ≤ mínimo ≤ recomendado.",
      };
    }
    return { ok: true };
  }
  if (c != null && m != null && !(c <= m)) {
    return {
      ok: false,
      message: "Hierarquia inválida: contingência ≤ mínimo ≤ recomendado.",
    };
  }
  if (m != null && r != null && !(m <= r)) {
    return {
      ok: false,
      message: "Hierarquia inválida: contingência ≤ mínimo ≤ recomendado.",
    };
  }
  if (c != null && r != null && !(c <= r)) {
    return {
      ok: false,
      message: "Hierarquia inválida: contingência ≤ mínimo ≤ recomendado.",
    };
  }
  return { ok: true };
}

export function materialStockParametersApiPath(materialId: string): string {
  return `/api/materials/stock-tablet/${encodeURIComponent(materialId)}/parameters`;
}

export type UpdateMaterialStockParametersResult =
  | { ok: true; data: MaterialStockParametersApiResult }
  | { ok: false; message: string; status?: number };

export async function updateMaterialStockParameters(input: {
  materialId: string;
  contingencyQuantity: number | null;
  minimumQuantity: number | null;
  recommendedQuantity: number | null;
  reason?: string | null;
  signal?: AbortSignal;
}): Promise<UpdateMaterialStockParametersResult> {
  const body = {
    contingencyQuantity: input.contingencyQuantity,
    minimumQuantity: input.minimumQuantity,
    recommendedQuantity: input.recommendedQuantity,
    reason: input.reason?.trim() || null,
  };
  try {
    const res = await fetch(materialStockParametersApiPath(input.materialId), {
      method: "PATCH",
      credentials: "include",
      signal: input.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message:
          (typeof payload.message === "string" && payload.message) ||
          "Não foi possível salvar os parâmetros.",
      };
    }
    return { ok: true, data: payload as unknown as MaterialStockParametersApiResult };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Falha de rede ao salvar os parâmetros.",
    };
  }
}

export function applyParametersSuccessToListItem(
  item: MaterialStockTabletListItem,
  result: MaterialStockParametersApiResult
): MaterialStockTabletListItem {
  const statusRaw = result.material.stockStatus;
  const stockStatus = (
    [
      "NAO_CONFIGURADO",
      "SEM_ESTOQUE",
      "EMERGENCIA",
      "CRITICO",
      "ATENCAO",
      "SAUDAVEL",
    ] as const
  ).includes(statusRaw as MaterialStockStatus)
    ? (statusRaw as MaterialStockStatus)
    : item.stockStatus;

  return {
    ...item,
    // quantity oficial permanece a do servidor (não deve mudar na edição de parâmetros)
    currentQuantity: result.material.quantity,
    contingencyQuantity: result.material.contingencyQuantity,
    minimumQuantity: result.material.minimumQuantity,
    recommendedQuantity: result.material.recommendedQuantity,
    stockStatus,
    stockConferenceVersion: result.material.stockConferenceVersion,
    updatedAt: result.material.updatedAt,
  };
}

export function assertParametersPayloadHasNoCostOrQuantityFields(
  body: Record<string, unknown>
): string[] {
  const forbidden = [
    "currentCost",
    "averageCost",
    "standardCost",
    "freight",
    "standardLoss",
    "conversionFactor",
    "quantity",
    "landedCost",
    "effectiveCost",
  ];
  return forbidden.filter((key) => Object.prototype.hasOwnProperty.call(body, key));
}

/** Body de edição nunca inclui quantity/custos. */
export function buildParametersRequestBody(input: {
  contingencyQuantity: number | null;
  minimumQuantity: number | null;
  recommendedQuantity: number | null;
  reason?: string | null;
}): Record<string, unknown> {
  return {
    contingencyQuantity: input.contingencyQuantity,
    minimumQuantity: input.minimumQuantity,
    recommendedQuantity: input.recommendedQuantity,
    reason: input.reason?.trim() || null,
  };
}
