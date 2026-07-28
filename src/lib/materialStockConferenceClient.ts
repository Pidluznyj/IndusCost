/**
 * Cliente browser-safe — POST conferência manual + helpers de formulário.
 * Não toca custos / frete / perda / BOM.
 */
import {
  computeStockConferenceDifference,
  roundMaterialStockQuantity,
} from "./materialStockConferenceMath.js";
import {
  MATERIAL_STOCK_CONFERENCE_REASONS,
  type MaterialStockConferenceReason,
} from "./materialStockConferenceRules.js";
import {
  resolveMaterialStockStatus,
  type MaterialStockStatus,
} from "./materialStockLevelRules.js";
import {
  MATERIAL_STOCK_TABLET_CONFERENCE_PATH,
  type MaterialStockTabletListItem,
} from "./materialStockTabletTypes.js";

export const MATERIAL_STOCK_CONFERENCE_REASON_LABELS: Record<
  MaterialStockConferenceReason,
  string
> = {
  CONFERENCIA_FISICA: "Conferência física",
  ENTRADA_MANUAL: "Entrada manual",
  SAIDA_MANUAL: "Saída manual",
  AJUSTE_DE_INVENTARIO: "Ajuste de inventário",
  PERDA: "Perda",
  OUTRO: "Outro",
};

export const MATERIAL_STOCK_CONFERENCE_DEFAULT_REASON: MaterialStockConferenceReason =
  "CONFERENCIA_FISICA";

export type MaterialStockConferenceApiResult = {
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
    contingencyQuantity?: number | null;
    minimumQuantity?: number | null;
    recommendedQuantity?: number | null;
    stockConferenceVersion: number;
    lastStockConferenceAt: string | null;
    lastStockConferenceUserId: string | null;
    updatedAt: string | null;
    stockStatus: string;
  };
};

export type MaterialStockConferenceConflictDetails = {
  reportedQuantity: number;
  serverQuantity: number;
  stockConferenceVersion: number | null;
  updatedAt: string | null;
  message: string;
};

export type SubmitMaterialStockConferenceResult =
  | { ok: true; data: MaterialStockConferenceApiResult }
  | { ok: false; kind: "conflict"; conflict: MaterialStockConferenceConflictDetails }
  | { ok: false; kind: "error"; message: string; status?: number };

export type ParseStockQuantityInputResult =
  | { ok: true; value: number }
  | { ok: false; reason: "EMPTY" | "INVALID" | "NEGATIVE" };

/** Aceita pt-BR (vírgula) ou ponto; vazio ≠ zero. */
export function parseStockConferenceQuantityInput(
  raw: string
): ParseStockQuantityInputResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "EMPTY" };
  // permite dígitos, um separador decimal e espaços
  const normalized = trimmed
    .replace(/\s/g, "")
    .replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return { ok: false, reason: "INVALID" };
  }
  const value = roundMaterialStockQuantity(normalized);
  if (!Number.isFinite(value)) return { ok: false, reason: "INVALID" };
  if (value < 0) return { ok: false, reason: "NEGATIVE" };
  return { ok: true, value };
}

export function previewStockConferenceDifference(
  previousQuantity: number,
  reportedRaw: string
): { previous: number; reported: number | null; difference: number | null } {
  const parsed = parseStockConferenceQuantityInput(reportedRaw);
  if (!parsed.ok) {
    return { previous: previousQuantity, reported: null, difference: null };
  }
  return {
    previous: previousQuantity,
    reported: parsed.value,
    difference: computeStockConferenceDifference(previousQuantity, parsed.value),
  };
}

export function listMaterialStockConferenceReasons(): Array<{
  value: MaterialStockConferenceReason;
  label: string;
}> {
  return MATERIAL_STOCK_CONFERENCE_REASONS.map((value) => ({
    value,
    label: MATERIAL_STOCK_CONFERENCE_REASON_LABELS[value],
  }));
}

export function createConferenceIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `conf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function submitMaterialStockConference(input: {
  materialId: string;
  reportedQuantity: number;
  contingencyQuantity: number;
  recommendedQuantity: number | null;
  reason: MaterialStockConferenceReason;
  notes?: string | null;
  expectedVersion: number;
  expectedUpdatedAt?: string | null;
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<SubmitMaterialStockConferenceResult> {
  try {
    const res = await fetch(MATERIAL_STOCK_TABLET_CONFERENCE_PATH, {
      method: "POST",
      credentials: "include",
      signal: input.signal,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        materialId: input.materialId,
        reportedQuantity: input.reportedQuantity,
        contingencyQuantity: input.contingencyQuantity,
        recommendedQuantity: input.recommendedQuantity,
        reason: input.reason,
        notes: input.notes?.trim() || null,
        expectedVersion: input.expectedVersion,
        ...(input.expectedUpdatedAt
          ? { expectedUpdatedAt: input.expectedUpdatedAt }
          : {}),
      }),
    });

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.status === 409 || payload.error === "CONFLICT") {
      const details =
        payload.details && typeof payload.details === "object"
          ? (payload.details as Record<string, unknown>)
          : {};
      const serverQuantity = Number(details.currentQuantity);
      return {
        ok: false,
        kind: "conflict",
        conflict: {
          reportedQuantity: input.reportedQuantity,
          serverQuantity: Number.isFinite(serverQuantity) ? serverQuantity : NaN,
          stockConferenceVersion:
            details.stockConferenceVersion != null
              ? Number(details.stockConferenceVersion)
              : null,
          updatedAt:
            typeof details.updatedAt === "string" ? details.updatedAt : null,
          message:
            typeof payload.message === "string"
              ? payload.message
              : "O material foi alterado desde a abertura da tela.",
        },
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        kind: "error",
        status: res.status,
        message:
          (typeof payload.message === "string" && payload.message) ||
          (typeof payload.error === "string" && payload.error) ||
          "Não foi possível salvar a conferência.",
      };
    }

    return { ok: true, data: payload as unknown as MaterialStockConferenceApiResult };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      (error as { name?: string }).name === "AbortError"
    ) {
      return { ok: false, kind: "error", message: "Envio cancelado." };
    }
    return {
      ok: false,
      kind: "error",
      message:
        error instanceof Error
          ? error.message
          : "Falha de rede ao salvar a conferência.",
    };
  }
}

/** Aplica sucesso do servidor no item da lista — sem tocar campos de custo. */
export function applyConferenceSuccessToListItem(
  item: MaterialStockTabletListItem,
  result: MaterialStockConferenceApiResult
): MaterialStockTabletListItem {
  const quantity = result.material.quantity;
  const contingencyQuantity =
    result.material.contingencyQuantity !== undefined
      ? result.material.contingencyQuantity
      : item.contingencyQuantity;
  const recommendedQuantity =
    result.material.recommendedQuantity !== undefined
      ? result.material.recommendedQuantity
      : item.recommendedQuantity;
  const minimumQuantity =
    result.material.minimumQuantity !== undefined
      ? result.material.minimumQuantity
      : item.minimumQuantity;
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
    : resolveMaterialStockStatus({
        currentQuantity: quantity,
        contingencyQuantity,
        minimumQuantity,
        recommendedQuantity,
      });

  return {
    ...item,
    currentQuantity: quantity,
    contingencyQuantity,
    minimumQuantity,
    recommendedQuantity,
    stockStatus,
    stockConferenceVersion: result.material.stockConferenceVersion,
    lastStockConferenceAt: result.material.lastStockConferenceAt,
    lastStockConferenceUser: result.conference.userName
      ? {
          id: result.conference.userId,
          name: result.conference.userName,
        }
      : item.lastStockConferenceUser,
    updatedAt: result.material.updatedAt,
  };
}

export function assertConferencePayloadHasNoCostFields(
  body: Record<string, unknown>
): string[] {
  const forbidden = [
    "currentCost",
    "averageCost",
    "standardCost",
    "freight",
    "standardLoss",
    "conversionFactor",
    "landedCost",
    "effectiveCost",
  ];
  return forbidden.filter((key) => key in body);
}
