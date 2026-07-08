/**
 * Classificação de confiabilidade de cotações de mercado.
 * Níveis canônicos: MANUAL < BAIXA < MEDIA < ALTA.
 * Aceita legado LOW/MEDIUM/HIGH.
 */

export const MATERIAL_MARKET_QUOTE_RELIABILITY_LEVELS = [
  "MANUAL",
  "BAIXA",
  "MEDIA",
  "ALTA",
] as const;

export type MaterialMarketQuoteReliabilityLevel =
  (typeof MATERIAL_MARKET_QUOTE_RELIABILITY_LEVELS)[number];

export const MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS: Record<
  MaterialMarketQuoteReliabilityLevel,
  string
> = {
  MANUAL: "Manual",
  BAIXA: "Baixa",
  MEDIA: "Média",
  ALTA: "Alta",
};

export const MATERIAL_MARKET_QUOTE_RELIABILITY_BADGE_CLASSES: Record<
  MaterialMarketQuoteReliabilityLevel,
  string
> = {
  MANUAL: "border-slate-300 bg-slate-50 text-slate-800",
  BAIXA: "border-amber-300 bg-amber-50 text-amber-900",
  MEDIA: "border-sky-300 bg-sky-50 text-sky-900",
  ALTA: "border-emerald-300 bg-emerald-50 text-emerald-900",
};

const RELIABILITY_RANK: Record<MaterialMarketQuoteReliabilityLevel, number> = {
  MANUAL: 0,
  BAIXA: 1,
  MEDIA: 2,
  ALTA: 3,
};

const LEGACY_MAP: Record<string, MaterialMarketQuoteReliabilityLevel> = {
  LOW: "BAIXA",
  MEDIUM: "MEDIA",
  HIGH: "ALTA",
  MANUAL: "MANUAL",
  BAIXA: "BAIXA",
  MEDIA: "MEDIA",
  ALTA: "ALTA",
};

export function parseMaterialMarketQuoteReliabilityLevel(
  value: unknown
): MaterialMarketQuoteReliabilityLevel | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toUpperCase();
  return LEGACY_MAP[key] ?? null;
}

export function pickHigherReliabilityLevel(
  a: MaterialMarketQuoteReliabilityLevel,
  b: MaterialMarketQuoteReliabilityLevel
): MaterialMarketQuoteReliabilityLevel {
  return RELIABILITY_RANK[a] >= RELIABILITY_RANK[b] ? a : b;
}

export function lowerMaterialMarketQuoteReliabilityLevel(
  level: MaterialMarketQuoteReliabilityLevel
): MaterialMarketQuoteReliabilityLevel {
  if (level === "ALTA") return "MEDIA";
  if (level === "MEDIA") return "BAIXA";
  if (level === "BAIXA") return "MANUAL";
  return "MANUAL";
}

export function suggestReliabilityForAttachmentType(
  attachmentType: string
): MaterialMarketQuoteReliabilityLevel {
  const type = attachmentType.trim().toUpperCase();
  if (type === "PDF" || type === "PROPOSAL") return "ALTA";
  if (type === "SPREADSHEET" || type === "EMAIL") return "MEDIA";
  if (type === "IMAGE") return "BAIXA";
  return "MANUAL";
}

export function suggestMaterialMarketQuoteReliability(input: {
  attachments: Array<{ attachmentType: string }>;
  exchangeOrigin?: string | null;
  informationSource?: string | null;
}): MaterialMarketQuoteReliabilityLevel {
  let best: MaterialMarketQuoteReliabilityLevel = "MANUAL";

  if (input.attachments.length === 0) {
    const source = input.informationSource?.trim().toUpperCase();
    best = source === "VERBAL" ? "BAIXA" : "MANUAL";
  } else {
    for (const attachment of input.attachments) {
      best = pickHigherReliabilityLevel(
        best,
        suggestReliabilityForAttachmentType(attachment.attachmentType)
      );
    }
  }

  if (input.exchangeOrigin === "MANUAL") {
    best = lowerMaterialMarketQuoteReliabilityLevel(best);
  }

  return best;
}

export function parseMaterialMarketQuoteReliabilityPatch(
  body: unknown
):
  | { ok: true; level: MaterialMarketQuoteReliabilityLevel; justification: string }
  | { ok: false; code: string; message: string } {
  if (typeof body !== "object" || body == null) {
    return { ok: false, code: "RELIABILITY_INVALID_BODY", message: "Corpo da requisição inválido." };
  }

  const level = parseMaterialMarketQuoteReliabilityLevel((body as { level?: unknown }).level);
  if (!level) {
    return {
      ok: false,
      code: "RELIABILITY_INVALID_LEVEL",
      message: "Nível de confiabilidade inválido.",
    };
  }

  const justification =
    typeof (body as { justification?: unknown }).justification === "string"
      ? (body as { justification: string }).justification.trim()
      : "";

  if (!justification) {
    return {
      ok: false,
      code: "RELIABILITY_JUSTIFICATION_REQUIRED",
      message: "Informe a justificativa para ajustar a confiabilidade.",
    };
  }

  return { ok: true, level, justification };
}

export function buildMaterialMarketQuoteReliabilityAuditDetails(input: {
  before: MaterialMarketQuoteReliabilityLevel | string | null;
  after: MaterialMarketQuoteReliabilityLevel | string;
  justification: string;
}): string {
  return JSON.stringify({
    event: "RELIABILITY_CHANGED",
    before: input.before,
    after: input.after,
    justification: input.justification,
  });
}

export function canAdjustMaterialMarketQuoteReliability(user: {
  role: string;
  permissions: string[];
  effectivePermissions?: string[];
}): boolean {
  const effective = user.effectivePermissions ?? user.permissions;
  if (effective.includes("materials.edit")) return true;
  return user.role === "ADMIN" || user.role === "SUPER_ADMIN";
}

/** Alias usado pelo servidor de anexos (mesmo algoritmo agregado). */
export function computeQuoteSuggestedReliabilityFromAttachments(
  attachments: Array<{
    attachmentType: string;
    suggestedReliabilityLevel?: string | null;
  }>,
  options?: {
    exchangeOrigin?: string | null;
    informationSource?: string | null;
  }
): MaterialMarketQuoteReliabilityLevel {
  if (attachments.length === 0) {
    return suggestMaterialMarketQuoteReliability({
      attachments: [],
      exchangeOrigin: options?.exchangeOrigin,
      informationSource: options?.informationSource,
    });
  }

  let best: MaterialMarketQuoteReliabilityLevel = "MANUAL";
  for (const attachment of attachments) {
    const fromField = parseMaterialMarketQuoteReliabilityLevel(
      attachment.suggestedReliabilityLevel
    );
    const fromType = suggestReliabilityForAttachmentType(attachment.attachmentType);
    best = pickHigherReliabilityLevel(best, fromField ?? fromType);
  }

  const aggregate = suggestMaterialMarketQuoteReliability({
    attachments: attachments.map((a) => ({ attachmentType: a.attachmentType })),
    exchangeOrigin: options?.exchangeOrigin,
    informationSource: options?.informationSource,
  });

  return pickHigherReliabilityLevel(best, aggregate);
}

/** Prisma enum legado: LOW | MEDIUM | HIGH. */
export type MaterialMarketQuoteReliabilityPrismaLevel = "LOW" | "MEDIUM" | "HIGH";

export function toPrismaMaterialMarketQuoteReliabilityLevel(
  level: MaterialMarketQuoteReliabilityLevel | null | undefined
): MaterialMarketQuoteReliabilityPrismaLevel | null {
  if (!level) return null;
  if (level === "ALTA") return "HIGH";
  if (level === "MEDIA") return "MEDIUM";
  return "LOW";
}

export function fromPrismaMaterialMarketQuoteReliabilityLevel(
  value: unknown
): MaterialMarketQuoteReliabilityLevel | null {
  return parseMaterialMarketQuoteReliabilityLevel(value);
}
