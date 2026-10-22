/**
 * Score de Confiança de crédito — indicador documental, não autorização.
 * O algoritmo cadastral original permanece intacto; aqui só se aplica o peso.
 * QUOD e IEPTB entram apenas com evidência já persistida, válida e favorável.
 */

export const CREDIT_CONFIDENCE_POLICY_VERSION = "CREDIT_CONFIDENCE_V1";

export type CreditConfidencePolicy = {
  version: string;
  cadastralMax: number;
  quodMax: number;
  ieptbMax: number;
  bands: { excellent: number; good: number; regular: number };
};

export const CREDIT_CONFIDENCE_V1: CreditConfidencePolicy = {
  version: CREDIT_CONFIDENCE_POLICY_VERSION,
  cadastralMax: 80,
  quodMax: 12,
  ieptbMax: 8,
  bands: { excellent: 85, good: 70, regular: 50 },
};

export type CreditConfidenceBand =
  | "Excelente"
  | "Bom"
  | "Regular"
  | "Baixo"
  | "Insuficiente para avaliação";

export type CreditConfidenceSourceStatus =
  | "AUSENTE"
  | "FAVORAVEL"
  | "EXPIRADA"
  | "INSUFICIENTE"
  | "INCOMPATIVEL"
  | "RESTRITIVA"
  | "FALHA";

export type CreditConfidenceResult = {
  score: number;
  maximumPossibleScore: number;
  band: CreditConfidenceBand;
  label: string;
  cadastral: { originalScore: number | null; contribution: number; maxContribution: number };
  quod: {
    status: CreditConfidenceSourceStatus;
    contribution: number;
    maxContribution: number;
    consultedAt: string | null;
    validUntil: string | null;
  };
  ieptb: {
    status: CreditConfidenceSourceStatus;
    contribution: number;
    maxContribution: number;
    consultedAt: string | null;
    validUntil: string | null;
  };
  evidenceCoverage: "CADASTRO" | "CADASTRO_QUOD" | "CADASTRO_IEPTB" | "CADASTRO_QUOD_IEPTB";
  policyVersion: string;
  calculatedAt: string;
};

export type CreditConfidenceQuodInput = {
  state?: string | null;
  confirmedRestriction?: boolean | null;
  insufficient?: boolean | null;
  cnpjMatches?: boolean | null;
  consultedAt?: string | null;
  validUntil?: string | null;
};

export type CreditConfidenceIeptbInput = {
  state?: string | null;
  confirmedProtest?: boolean | null;
  confirmedClear?: boolean | null;
  insufficient?: boolean | null;
  cnpjMatches?: boolean | null;
  consultedAt?: string | null;
  validUntil?: string | null;
};

/** Meio para cima, no inteiro mais próximo. 72,8 → 73. */
export function roundCreditConfidencePoints(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

export function creditConfidenceBand(score: number, hasCadastral: boolean): CreditConfidenceBand {
  if (!hasCadastral && score <= 0) return "Insuficiente para avaliação";
  if (score >= CREDIT_CONFIDENCE_V1.bands.excellent) return "Excelente";
  if (score >= CREDIT_CONFIDENCE_V1.bands.good) return "Bom";
  if (score >= CREDIT_CONFIDENCE_V1.bands.regular) return "Regular";
  return "Baixo";
}

function finiteOriginal(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score) || score < 0 || score > 100) return null;
  return score;
}

function sourceStatus(input: {
  present: boolean;
  state?: string | null;
  favorable: boolean;
  restrictive: boolean;
  cnpjMatches?: boolean | null;
  insufficient?: boolean | null;
}): CreditConfidenceSourceStatus {
  const state = (input.state ?? "").toUpperCase();
  if (input.cnpjMatches === false) return "INCOMPATIVEL";
  if (state === "FAILED" || state === "UNAVAILABLE") return "FALHA";
  if (!input.present || state === "" || state === "NOT_CONSULTED") return "AUSENTE";
  if (state === "STALE" || state === "EXPIRED") return "EXPIRADA";
  if (input.insufficient === true || state === "PARTIAL" || state === "IN_PROGRESS" || state === "NOT_CONSULTED") {
    return "INSUFICIENTE";
  }
  if (input.restrictive) return "RESTRITIVA";
  if (input.favorable && state === "VALID") return "FAVORAVEL";
  return "INSUFICIENTE";
}

export function calculateCreditConfidence(input: {
  cadastralScore: number | null | undefined;
  quod?: CreditConfidenceQuodInput | null;
  ieptb?: CreditConfidenceIeptbInput | null;
  now?: Date;
  policy?: CreditConfidencePolicy;
}): CreditConfidenceResult {
  const policy = input.policy ?? CREDIT_CONFIDENCE_V1;
  const now = input.now ?? new Date();
  const original = finiteOriginal(input.cadastralScore);
  const cadastralContribution =
    original == null ? 0 : roundCreditConfidencePoints((original * policy.cadastralMax) / 100);

  const quod = input.quod ?? null;
  const quodFavorable =
    quod != null &&
    quod.cnpjMatches !== false &&
    quod.confirmedRestriction !== true &&
    quod.insufficient !== true &&
    (quod.state ?? "").toUpperCase() === "VALID";
  const ieptb = input.ieptb ?? null;
  const ieptbFavorable =
    ieptb != null &&
    ieptb.cnpjMatches !== false &&
    ieptb.confirmedClear === true &&
    ieptb.confirmedProtest !== true &&
    ieptb.insufficient !== true &&
    (ieptb.state ?? "").toUpperCase() === "VALID";

  const quodContribution = quodFavorable ? policy.quodMax : 0;
  const ieptbContribution = ieptbFavorable ? policy.ieptbMax : 0;
  const maximumPossibleScore = policy.cadastralMax + (quodFavorable ? policy.quodMax : 0) + (ieptbFavorable ? policy.ieptbMax : 0);
  const score = Math.min(maximumPossibleScore, cadastralContribution + quodContribution + ieptbContribution);
  const band = creditConfidenceBand(score, original != null);
  const evidenceCoverage = quodFavorable && ieptbFavorable
    ? "CADASTRO_QUOD_IEPTB"
    : quodFavorable
      ? "CADASTRO_QUOD"
      : ieptbFavorable
        ? "CADASTRO_IEPTB"
        : "CADASTRO";

  return {
    score,
    maximumPossibleScore,
    band,
    label: `${score}/100 · ${band}`,
    cadastral: { originalScore: original, contribution: cadastralContribution, maxContribution: policy.cadastralMax },
    quod: {
      status: sourceStatus({
        present: quod != null,
        state: quod?.state,
        favorable: quodFavorable,
        restrictive: quod?.confirmedRestriction === true,
        cnpjMatches: quod?.cnpjMatches,
        insufficient: quod?.insufficient,
      }),
      contribution: quodContribution,
      maxContribution: policy.quodMax,
      consultedAt: quod?.consultedAt ?? null,
      validUntil: quod?.validUntil ?? null,
    },
    ieptb: {
      status: sourceStatus({
        present: ieptb != null,
        state: ieptb?.state,
        favorable: ieptbFavorable,
        restrictive: ieptb?.confirmedProtest === true,
        cnpjMatches: ieptb?.cnpjMatches,
        insufficient: ieptb?.insufficient,
      }),
      contribution: ieptbContribution,
      maxContribution: policy.ieptbMax,
      consultedAt: ieptb?.consultedAt ?? null,
      validUntil: ieptb?.validUntil ?? null,
    },
    evidenceCoverage,
    policyVersion: policy.version,
    calculatedAt: now.toISOString(),
  };
}

export type CreditConfidenceEvidence = {
  cadastralScore: number | null;
  quodState: string;
  quodConfirmedRestriction: boolean;
  quodCnpjMatches?: boolean;
  quodConsultedAt?: string | null;
  quodValidUntil?: string | null;
  ieptbState: string;
  ieptbConfirmedProtest: boolean;
  ieptbConfirmedClear?: boolean;
  ieptbCnpjMatches?: boolean;
  ieptbConsultedAt?: string | null;
  ieptbValidUntil?: string | null;
};

/** Mesma composição usada pela lista, pelo detalhe e pelo relatório. */
export function creditConfidenceFromEvidence(evidence: CreditConfidenceEvidence, now?: Date): CreditConfidenceResult {
  return calculateCreditConfidence({
    cadastralScore: evidence.cadastralScore,
    now,
    quod: {
      state: evidence.quodState,
      confirmedRestriction: evidence.quodConfirmedRestriction,
      cnpjMatches: evidence.quodCnpjMatches,
      consultedAt: evidence.quodConsultedAt ?? null,
      validUntil: evidence.quodValidUntil ?? null,
    },
    ieptb: {
      state: evidence.ieptbState,
      confirmedProtest: evidence.ieptbConfirmedProtest,
      confirmedClear: evidence.ieptbConfirmedClear === true,
      cnpjMatches: evidence.ieptbCnpjMatches,
      consultedAt: evidence.ieptbConsultedAt ?? null,
      validUntil: evidence.ieptbValidUntil ?? null,
    },
  });
}

export function explainBlockedConfidence(input: {
  score: number;
  customerStatus: string;
  reasons: readonly string[];
}): string | null {
  const blocked = input.customerStatus === "BLOQUEADO" || input.customerStatus === "BLOQUEIO_CRITICO";
  if (!blocked || input.score < CREDIT_CONFIDENCE_V1.bands.good) return null;
  if (input.reasons.includes("RELATED_PARTY_DELINQUENT")) {
    return "Score de Confiança elevado, mas crédito bloqueado por inadimplência em empresa relacionada confirmada.";
  }
  if (input.reasons.includes("OVERDUE_OPEN_BALANCE")) {
    return "Score de Confiança elevado, mas crédito bloqueado por inadimplência própria.";
  }
  if (input.reasons.includes("IEPTB_NATIONAL_PROTEST") || input.reasons.includes("EXTERNAL_PROTEST")) {
    return "Score de Confiança elevado, mas crédito bloqueado por protesto impeditivo.";
  }
  return "Score de Confiança elevado, mas a decisão oficial de crédito prevalece.";
}
