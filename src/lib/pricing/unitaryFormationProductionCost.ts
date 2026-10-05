/**
 * Contrato puro da geração de DRAFT unitário de custo de produção.
 * Sem Prisma / sem motor — só parse, DTO e composição de apresentação.
 */

import { PRODUCTION_COST_PUBLICATION_SOURCE } from "../productionCostPublication.js";
import { isUnitaryFormationProductId } from "./unitaryFormationDetail.js";

/** Marcador em notes — source permanece o oficial de Pricing. */
export const UNITARY_PRODUCTION_COST_DRAFT_NOTES_MARKER = "unitary-formation";

export const UNITARY_PRODUCTION_COST_DRAFT_SOURCE = PRODUCTION_COST_PUBLICATION_SOURCE;

export type UnitaryCostCompositionDto = {
  material: number | null;
  hh: number | null;
  hm: number | null;
  /** Apresentação: HH + HM (não usa processCost persistido = 0). */
  processTotal: number | null;
  overhead: number | null;
  others: number | null;
  total: number | null;
};

export type UnitaryProductionCostDraftResponse = {
  draftVersionId: string;
  code: string;
  revision: number;
  status: "DRAFT";
  effectiveDate: string;
  createdAt: string;
  createdBy: string | null;
  source: string | null;
  productId: string;
  sku: string;
  productName: string;
  unitCost: number;
  composition: UnitaryCostCompositionDto;
  calculationHash: string | null;
  costAnalysisPartial: boolean;
  warnings: Array<{ code: string; message: string }>;
  published: false;
};

export type UnitaryProductionCostDraftErrorCode =
  | "INVALID_PRODUCT_ID"
  | "INVALID_EFFECTIVE_DATE"
  | "PRODUCT_NOT_FOUND"
  | "INACTIVE_PRODUCT"
  | "BOM_INACTIVE_COMPONENT"
  | "LIVE_COST_ERROR"
  | "LIVE_COST_INVALID"
  | "UNEXPECTED_ERROR";

export type UnitaryProductionCostDraftError = {
  httpStatus: 400 | 404 | 409 | 422;
  code: UnitaryProductionCostDraftErrorCode;
  message: string;
};

export function mapUnitaryCostComposition(input: {
  materialCost?: number | null;
  laborCost?: number | null;
  machineCost?: number | null;
  overheadCost?: number | null;
  otherCost?: number | null;
  unitProductionCost?: number | null;
}): UnitaryCostCompositionDto {
  const material = finiteOrNull(input.materialCost);
  const hh = finiteOrNull(input.laborCost);
  const hm = finiteOrNull(input.machineCost);
  const overhead = finiteOrNull(input.overheadCost);
  const others = finiteOrNull(input.otherCost);
  const total = finiteOrNull(input.unitProductionCost);
  const processTotal =
    hh == null && hm == null
      ? null
      : Math.round(((hh ?? 0) + (hm ?? 0)) * 1_000_000) / 1_000_000;
  return { material, hh, hm, processTotal, overhead, others, total };
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

export function parseUnitaryProductionCostDraftRequest(input: {
  productId: string;
  body?: Record<string, unknown> | null;
  now?: Date;
}):
  | { ok: true; productId: string; effectiveDate: Date; effectiveDateKey: string }
  | { ok: false; error: UnitaryProductionCostDraftError } {
  const productId = String(input.productId ?? "").trim();
  if (!isUnitaryFormationProductId(productId)) {
    return {
      ok: false,
      error: {
        httpStatus: 400,
        code: "INVALID_PRODUCT_ID",
        message: "productId inválido.",
      },
    };
  }

  const body = input.body ?? {};
  // Custos / hash / breakdown do browser são ignorados de propósito.
  void body.unitCost;
  void body.unitProductionCost;
  void body.material;
  void body.hh;
  void body.hm;
  void body.overhead;
  void body.others;
  void body.total;
  void body.calculationHash;
  void body.composition;

  const rawDate =
    typeof body.effectiveDate === "string" && body.effectiveDate.trim()
      ? body.effectiveDate.trim()
      : null;

  if (rawDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      return {
        ok: false,
        error: {
          httpStatus: 400,
          code: "INVALID_EFFECTIVE_DATE",
          message: "effectiveDate inválida (yyyy-mm-dd).",
        },
      };
    }
    const [y, m, d] = rawDate.split("-").map(Number);
    const effectiveDate = new Date(y!, m! - 1, d!);
    if (
      Number.isNaN(effectiveDate.getTime()) ||
      effectiveDate.getFullYear() !== y ||
      effectiveDate.getMonth() !== m! - 1 ||
      effectiveDate.getDate() !== d
    ) {
      return {
        ok: false,
        error: {
          httpStatus: 400,
          code: "INVALID_EFFECTIVE_DATE",
          message: "effectiveDate inválida.",
        },
      };
    }
    return { ok: true, productId, effectiveDate, effectiveDateKey: rawDate };
  }

  const now = input.now ?? new Date();
  const effectiveDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const effectiveDateKey = [
    effectiveDate.getFullYear(),
    String(effectiveDate.getMonth() + 1).padStart(2, "0"),
    String(effectiveDate.getDate()).padStart(2, "0"),
  ].join("-");
  return { ok: true, productId, effectiveDate, effectiveDateKey };
}

export function buildUnitaryProductionCostDraftNotes(extra?: string | null): string {
  const base = UNITARY_PRODUCTION_COST_DRAFT_NOTES_MARKER;
  const more = extra?.trim();
  return more ? `${base} · ${more}` : base;
}

export function buildUnitaryProductionCostDraftResponse(input: {
  version: {
    id: string;
    code: string;
    revision: number;
    status: string;
    effectiveDate: Date | string;
    createdAt: Date | string;
    createdBy: string | null;
    source: string | null;
  };
  item: {
    productId: string;
    productCodeSnapshot: string;
    productNameSnapshot: string;
    unitProductionCost: number;
    materialCost: number;
    laborCost: number;
    machineCost: number;
    overheadCost: number;
    otherCost: number;
    calculationHash: string | null;
  };
  costAnalysisPartial: boolean;
  warnings?: Array<{ code: string; message: string }>;
  effectiveDateKey: string;
}): UnitaryProductionCostDraftResponse {
  const createdAt =
    input.version.createdAt instanceof Date
      ? input.version.createdAt.toISOString()
      : String(input.version.createdAt);
  return {
    draftVersionId: input.version.id,
    code: input.version.code,
    revision: input.version.revision,
    status: "DRAFT",
    effectiveDate: input.effectiveDateKey,
    createdAt,
    createdBy: input.version.createdBy,
    source: input.version.source,
    productId: input.item.productId,
    sku: input.item.productCodeSnapshot,
    productName: input.item.productNameSnapshot,
    unitCost: input.item.unitProductionCost,
    composition: mapUnitaryCostComposition({
      materialCost: input.item.materialCost,
      laborCost: input.item.laborCost,
      machineCost: input.item.machineCost,
      overheadCost: input.item.overheadCost,
      otherCost: input.item.otherCost,
      unitProductionCost: input.item.unitProductionCost,
    }),
    calculationHash: input.item.calculationHash,
    costAnalysisPartial: input.costAnalysisPartial,
    warnings: input.warnings ?? [],
    published: false,
  };
}

/** Origem de auditoria na publicação unitária (notes), sem fork de source da versão. */
export const UNITARY_PRODUCTION_COST_PUBLISH_AUDIT_SOURCE = "UNITARY_FORMATION" as const;

export type UnitaryProductionCostPublishErrorCode =
  | "INVALID_PRODUCT_ID"
  | "INVALID_DRAFT_VERSION_ID"
  | "PRODUCT_NOT_FOUND"
  | "DRAFT_NOT_FOUND"
  | "ALREADY_PUBLISHED"
  | "STALE_DRAFT"
  | "CONFLICT_NEWER_DRAFT"
  | "CONFLICT_STATUS_CHANGED"
  | "WRONG_PRODUCT"
  | "INACTIVE_PRODUCT"
  | "INVALID_COST"
  | "NOT_PENDING"
  | "TECHNICAL_ONLY"
  | "NO_DRAFT"
  | "PERMISSION"
  | "ERROR";

export type UnitaryProductionCostPublishError = {
  httpStatus: 400 | 403 | 404 | 409;
  code: UnitaryProductionCostPublishErrorCode;
  message: string;
};

export type UnitaryProductionCostPublishResponse = {
  published: true;
  alreadyPublished: boolean;
  productId: string;
  draftVersionId: string;
  versionId: string;
  code: string;
  revision: number;
  status: "PUBLISHED";
  effectiveDate: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  source: string | null;
  unitCost: number;
  composition: UnitaryCostCompositionDto;
  calculationHash: string | null;
  previousPublishedVersionId: string | null;
  previousUnitCost: number | null;
};

export function parseUnitaryProductionCostPublishRequest(input: {
  productId: string;
  body?: Record<string, unknown> | null;
}):
  | { ok: true; productId: string; draftVersionId: string }
  | { ok: false; error: UnitaryProductionCostPublishError } {
  const productId = String(input.productId ?? "").trim();
  if (!isUnitaryFormationProductId(productId)) {
    return {
      ok: false,
      error: {
        httpStatus: 400,
        code: "INVALID_PRODUCT_ID",
        message: "productId inválido.",
      },
    };
  }
  const body = input.body ?? {};
  // Ignorar qualquer custo enviado pelo browser.
  void body.unitCost;
  void body.unitProductionCost;
  void body.composition;

  const draftVersionId =
    typeof body.draftVersionId === "string" ? body.draftVersionId.trim() : "";
  if (!isUnitaryFormationProductId(draftVersionId)) {
    return {
      ok: false,
      error: {
        httpStatus: 400,
        code: "INVALID_DRAFT_VERSION_ID",
        message: "draftVersionId inválido.",
      },
    };
  }
  return { ok: true, productId, draftVersionId };
}

export function mapUnitaryPublishBlockReason(
  blockReason: string | null | undefined,
  fallbackMessage: string
): UnitaryProductionCostPublishError {
  switch (blockReason) {
    case "STALE_DRAFT":
      return {
        httpStatus: 409,
        code: "STALE_DRAFT",
        message: fallbackMessage || "DRAFT desatualizado em relação ao LIVE atual.",
      };
    case "INACTIVE_PRODUCT":
      return {
        httpStatus: 409,
        code: "INACTIVE_PRODUCT",
        message: fallbackMessage || "Produto inativo — publicação bloqueada.",
      };
    case "INVALID_COST":
      return {
        httpStatus: 409,
        code: "INVALID_COST",
        message: fallbackMessage || "Custo do DRAFT inválido.",
      };
    case "TECHNICAL_ONLY":
      return {
        httpStatus: 409,
        code: "TECHNICAL_ONLY",
        message: fallbackMessage || "Snapshot técnico sem impacto de custo.",
      };
    case "NOT_PENDING":
      return {
        httpStatus: 409,
        code: "NOT_PENDING",
        message: fallbackMessage || "Item não está pendente de publicação.",
      };
    case "ALREADY_PUBLISHED":
      return {
        httpStatus: 409,
        code: "ALREADY_PUBLISHED",
        message: fallbackMessage || "Versão já publicada.",
      };
    case "NO_DRAFT":
      return {
        httpStatus: 409,
        code: "NO_DRAFT",
        message: fallbackMessage || "Sem DRAFT de custo de produção.",
      };
    case "WRONG_PRODUCT":
      return {
        httpStatus: 409,
        code: "WRONG_PRODUCT",
        message: fallbackMessage || "DRAFT não pertence a este produto.",
      };
    case "CONFLICT_NEWER_DRAFT":
      return {
        httpStatus: 409,
        code: "CONFLICT_NEWER_DRAFT",
        message: fallbackMessage || "Existe DRAFT mais recente.",
      };
    case "CONFLICT_STATUS_CHANGED":
      return {
        httpStatus: 409,
        code: "CONFLICT_STATUS_CHANGED",
        message: fallbackMessage || "Status do DRAFT mudou.",
      };
    case "PERMISSION":
      return {
        httpStatus: 403,
        code: "PERMISSION",
        message: fallbackMessage || "Sem permissão para publicar.",
      };
    default:
      return {
        httpStatus: 409,
        code: "ERROR",
        message: fallbackMessage || "Publicação unitária bloqueada.",
      };
  }
}

export function buildUnitaryProductionCostPublishResponse(input: {
  productId: string;
  draftVersionId: string;
  alreadyPublished: boolean;
  version: {
    id: string;
    code: string;
    revision: number;
    status: string;
    effectiveDate: Date | string | null;
    publishedAt: Date | string | null;
    publishedBy: string | null;
    source: string | null;
  };
  item: {
    unitProductionCost: number;
    materialCost: number;
    laborCost: number;
    machineCost: number;
    overheadCost: number;
    otherCost: number;
    calculationHash: string | null;
  };
  previousPublishedVersionId: string | null;
  previousUnitCost: number | null;
}): UnitaryProductionCostPublishResponse {
  const effectiveDate =
    input.version.effectiveDate instanceof Date
      ? [
          input.version.effectiveDate.getFullYear(),
          String(input.version.effectiveDate.getMonth() + 1).padStart(2, "0"),
          String(input.version.effectiveDate.getDate()).padStart(2, "0"),
        ].join("-")
      : input.version.effectiveDate
        ? String(input.version.effectiveDate).slice(0, 10)
        : null;
  const publishedAt =
    input.version.publishedAt instanceof Date
      ? input.version.publishedAt.toISOString()
      : input.version.publishedAt
        ? String(input.version.publishedAt)
        : null;

  return {
    published: true,
    alreadyPublished: input.alreadyPublished,
    productId: input.productId,
    draftVersionId: input.draftVersionId,
    versionId: input.version.id,
    code: input.version.code,
    revision: input.version.revision,
    status: "PUBLISHED",
    effectiveDate,
    publishedAt,
    publishedBy: input.version.publishedBy,
    source: input.version.source,
    unitCost: input.item.unitProductionCost,
    composition: mapUnitaryCostComposition({
      materialCost: input.item.materialCost,
      laborCost: input.item.laborCost,
      machineCost: input.item.machineCost,
      overheadCost: input.item.overheadCost,
      otherCost: input.item.otherCost,
      unitProductionCost: input.item.unitProductionCost,
    }),
    calculationHash: input.item.calculationHash,
    previousPublishedVersionId: input.previousPublishedVersionId,
    previousUnitCost: input.previousUnitCost,
  };
}
