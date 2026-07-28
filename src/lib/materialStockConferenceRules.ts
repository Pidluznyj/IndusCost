/**
 * Regras puras da operação de conferência manual de estoque.
 * Sem Prisma / React / custos.
 */
import { safeTrim } from "@/src/lib/safeTrim.js";
import {
  computeStockConferenceDifference,
  roundMaterialStockQuantity,
} from "./materialStockConferenceMath.js";

export const MATERIAL_STOCK_CONFERENCE_REASONS = [
  "CONFERENCIA_FISICA",
  "ENTRADA_MANUAL",
  "SAIDA_MANUAL",
  "AJUSTE_DE_INVENTARIO",
  "PERDA",
  "OUTRO",
] as const;

export type MaterialStockConferenceReason =
  (typeof MATERIAL_STOCK_CONFERENCE_REASONS)[number];

export type MaterialStockConferenceCommandErrorCode =
  | "REQUIRED_FIELD"
  | "INVALID_FIELD"
  | "PAYLOAD_TOO_LARGE"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN";

export class MaterialStockConferenceError extends Error {
  readonly code: MaterialStockConferenceCommandErrorCode;
  readonly field?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: MaterialStockConferenceCommandErrorCode,
    message: string,
    field?: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "MaterialStockConferenceError";
    this.code = code;
    this.field = field;
    this.details = details;
  }
}

export type ParsedMaterialStockConferenceCommand = {
  materialId: string;
  reportedQuantity: number;
  /** Obrigatório na conferência. */
  contingencyQuantity: number;
  /** Opcional — null = não configurado / limpar. */
  recommendedQuantity: number | null;
  reason: MaterialStockConferenceReason;
  notes: string | null;
  expectedVersion: number | null;
  expectedUpdatedAt: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertMaterialStockIdempotencyKey(
  value: string | null | undefined
): string {
  const key = value?.trim() ?? "";
  if (!key) {
    throw new MaterialStockConferenceError(
      "REQUIRED_FIELD",
      "Idempotency-Key é obrigatório para conferência de estoque.",
      "idempotencyKey"
    );
  }
  if (key.length > 128) {
    throw new MaterialStockConferenceError(
      "PAYLOAD_TOO_LARGE",
      "Idempotency-Key excede 128 caracteres.",
      "idempotencyKey"
    );
  }
  return key;
}

function parseReason(value: unknown): MaterialStockConferenceReason {
  const raw = safeTrim(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, "_");
  const aliases: Record<string, MaterialStockConferenceReason> = {
    CONFERENCIA_FISICA: "CONFERENCIA_FISICA",
    ENTRADA_MANUAL: "ENTRADA_MANUAL",
    SAIDA_MANUAL: "SAIDA_MANUAL",
    AJUSTE_DE_INVENTARIO: "AJUSTE_DE_INVENTARIO",
    PERDA: "PERDA",
    OUTRO: "OUTRO",
  };
  const mapped = aliases[raw];
  if (!mapped) {
    throw new MaterialStockConferenceError(
      "INVALID_FIELD",
      "Motivo de conferência inválido.",
      "reason"
    );
  }
  return mapped;
}

export function parseMaterialStockConferenceCommand(
  body: Record<string, unknown>
): ParsedMaterialStockConferenceCommand {
  const materialId = safeTrim(body.materialId);
  if (!materialId || !UUID_RE.test(materialId)) {
    throw new MaterialStockConferenceError(
      "REQUIRED_FIELD",
      "materialId é obrigatório e deve ser UUID.",
      "materialId"
    );
  }

  const reportedRaw = body.reportedQuantity ?? body.countedQuantity ?? body.newQuantity;
  if (reportedRaw === undefined || reportedRaw === null || reportedRaw === "") {
    throw new MaterialStockConferenceError(
      "REQUIRED_FIELD",
      "Estoque atual é obrigatório.",
      "reportedQuantity"
    );
  }
  const reportedQuantity = roundMaterialStockQuantity(reportedRaw);
  if (!Number.isFinite(reportedQuantity)) {
    throw new MaterialStockConferenceError(
      "INVALID_FIELD",
      "Estoque atual inválido.",
      "reportedQuantity"
    );
  }
  if (reportedQuantity < 0) {
    throw new MaterialStockConferenceError(
      "INVALID_FIELD",
      "Estoque atual não pode ser negativo.",
      "reportedQuantity"
    );
  }

  const contingencyRaw =
    body.contingencyQuantity ?? body.estoqueContingencia ?? body.contingency;
  if (
    contingencyRaw === undefined ||
    contingencyRaw === null ||
    contingencyRaw === ""
  ) {
    throw new MaterialStockConferenceError(
      "REQUIRED_FIELD",
      "Estoque contingência é obrigatório.",
      "contingencyQuantity"
    );
  }
  const contingencyQuantity = roundMaterialStockQuantity(contingencyRaw);
  if (!Number.isFinite(contingencyQuantity)) {
    throw new MaterialStockConferenceError(
      "INVALID_FIELD",
      "Estoque contingência inválido.",
      "contingencyQuantity"
    );
  }
  if (contingencyQuantity < 0) {
    throw new MaterialStockConferenceError(
      "INVALID_FIELD",
      "Estoque contingência não pode ser negativo.",
      "contingencyQuantity"
    );
  }

  const recommendedRaw =
    body.recommendedQuantity ?? body.estoqueRecomendado ?? body.recommended;
  let recommendedQuantity: number | null = null;
  if (recommendedRaw !== undefined && recommendedRaw !== null && recommendedRaw !== "") {
    const n = roundMaterialStockQuantity(recommendedRaw);
    if (!Number.isFinite(n)) {
      throw new MaterialStockConferenceError(
        "INVALID_FIELD",
        "Estoque recomendado inválido.",
        "recommendedQuantity"
      );
    }
    if (n < 0) {
      throw new MaterialStockConferenceError(
        "INVALID_FIELD",
        "Estoque recomendado não pode ser negativo.",
        "recommendedQuantity"
      );
    }
    recommendedQuantity = n;
  }

  if (
    recommendedQuantity != null &&
    !(contingencyQuantity <= recommendedQuantity)
  ) {
    throw new MaterialStockConferenceError(
      "INVALID_FIELD",
      "Hierarquia inválida: contingência ≤ recomendado.",
      "recommendedQuantity"
    );
  }

  const reason = parseReason(body.reason);
  const notesRaw = safeTrim(body.notes ?? body.observation);
  const notes = notesRaw ? notesRaw.slice(0, 2000) : null;

  let expectedVersion: number | null = null;
  if (body.expectedVersion != null && body.expectedVersion !== "") {
    const v = Number(body.expectedVersion);
    if (!Number.isInteger(v) || v < 1) {
      throw new MaterialStockConferenceError(
        "INVALID_FIELD",
        "expectedVersion inválido.",
        "expectedVersion"
      );
    }
    expectedVersion = v;
  }

  let expectedUpdatedAt: string | null = null;
  if (body.expectedUpdatedAt != null && body.expectedUpdatedAt !== "") {
    const iso = safeTrim(body.expectedUpdatedAt);
    const d = new Date(iso);
    if (!iso || !Number.isFinite(d.getTime())) {
      throw new MaterialStockConferenceError(
        "INVALID_FIELD",
        "expectedUpdatedAt inválido.",
        "expectedUpdatedAt"
      );
    }
    expectedUpdatedAt = d.toISOString();
  }

  if (expectedVersion == null && expectedUpdatedAt == null) {
    throw new MaterialStockConferenceError(
      "REQUIRED_FIELD",
      "Informe expectedVersion ou expectedUpdatedAt para controle de concorrência.",
      "expectedVersion"
    );
  }

  return {
    materialId,
    reportedQuantity,
    contingencyQuantity,
    recommendedQuantity,
    reason,
    notes,
    expectedVersion,
    expectedUpdatedAt,
  };
}

/** Valida contingência/recomendado da conferência contra o mínimo já cadastrado. */
export function assertConferenceLevelsAgainstMinimum(input: {
  contingencyQuantity: number;
  recommendedQuantity: number | null;
  minimumQuantity: unknown;
}): void {
  const min = roundMaterialStockQuantity(input.minimumQuantity);
  const hasMin =
    input.minimumQuantity != null &&
    input.minimumQuantity !== "" &&
    Number.isFinite(min);
  if (!hasMin) return;
  if (!(input.contingencyQuantity <= min)) {
    throw new MaterialStockConferenceError(
      "INVALID_FIELD",
      "Hierarquia inválida: contingência ≤ mínimo.",
      "contingencyQuantity"
    );
  }
  if (
    input.recommendedQuantity != null &&
    !(min <= input.recommendedQuantity)
  ) {
    throw new MaterialStockConferenceError(
      "INVALID_FIELD",
      "Hierarquia inválida: mínimo ≤ recomendado.",
      "recommendedQuantity"
    );
  }
}

export function assertStockConferenceConcurrency(input: {
  expectedVersion: number | null;
  expectedUpdatedAt: string | null;
  actualVersion: number;
  actualUpdatedAt: Date | string | null;
}): void {
  if (input.expectedVersion != null && input.actualVersion !== input.expectedVersion) {
    throw new MaterialStockConferenceError(
      "CONFLICT",
      "O material foi alterado desde a abertura da tela. Recarregue e confirme novamente.",
      "expectedVersion",
      {
        currentQuantity: undefined,
        stockConferenceVersion: input.actualVersion,
        updatedAt:
          input.actualUpdatedAt instanceof Date
            ? input.actualUpdatedAt.toISOString()
            : input.actualUpdatedAt,
      }
    );
  }
  if (input.expectedUpdatedAt != null) {
    const actualIso =
      input.actualUpdatedAt instanceof Date
        ? input.actualUpdatedAt.toISOString()
        : input.actualUpdatedAt
          ? new Date(input.actualUpdatedAt).toISOString()
          : null;
    if (actualIso !== input.expectedUpdatedAt) {
      throw new MaterialStockConferenceError(
        "CONFLICT",
        "O material foi alterado desde a abertura da tela. Recarregue e confirme novamente.",
        "expectedUpdatedAt",
        {
          stockConferenceVersion: input.actualVersion,
          updatedAt: actualIso,
        }
      );
    }
  }
}

export function buildConferenceDifference(
  previousQuantity: unknown,
  reportedQuantity: number
): { previous: number; reported: number; difference: number } {
  const previous = roundMaterialStockQuantity(previousQuantity);
  const prev = Number.isFinite(previous) ? previous : 0;
  const difference = computeStockConferenceDifference(prev, reportedQuantity);
  return { previous: prev, reported: reportedQuantity, difference };
}
