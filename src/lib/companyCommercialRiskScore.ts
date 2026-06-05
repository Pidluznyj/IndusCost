import type { NormalizedCnpjSummary } from "./companyCnpjNormalize.js";
import { isRegistrationActive } from "./companyCnpjNormalize.js";

export type CommercialRiskVerdict =
  | "VENDA BLOQUEADA"
  | "APENAS PAGAMENTO ANTECIPADO"
  | "VENDA CONDICIONADA"
  | "VENDA LIBERADA";

export type CommercialRiskResult = {
  score: number;
  verdict: CommercialRiskVerdict;
  riskLevel: "Crítico" | "Alto" | "Médio" | "Baixo";
  saleRecommendation: string;
  dimensions: {
    registrationStatus: number;
    seniority: number;
    shareCapital: number;
    companySize: number;
    ownershipStructure: number;
  };
  blockedByRegistration: boolean;
  explanation: string[];
};

function yearsSince(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return diff / (365.25 * 24 * 60 * 60 * 1000);
}

function scoreSeniority(years: number | null): number {
  if (years == null) return 5;
  if (years >= 5) return 20;
  if (years >= 2) return 15;
  if (years >= 1) return 10;
  return 5;
}

function scoreShareCapital(capital: number | null): number {
  if (capital == null || capital <= 0) return 2;
  if (capital <= 15_000) return 8;
  if (capital <= 100_000) return 12;
  if (capital <= 1_000_000) return 15;
  return 20;
}

function scoreCompanySize(size: string | null): number {
  if (!size) return 5;
  const s = size.toUpperCase();
  if (s.includes("MEI")) return 3;
  if (s.includes("MICRO") || s === "ME") return 6;
  if (s.includes("PEQUENO") || s.includes("EPP")) return 8;
  if (s.includes("MÉDIO") || s.includes("MEDIO") || s.includes("GRANDE") || s.includes("DEMAIS")) {
    return 10;
  }
  return 5;
}

function scoreOwnership(summary: NormalizedCnpjSummary): number {
  if (summary.isMei) return 3;
  if (summary.hasPartners && summary.partners.length >= 2) return 10;
  if (summary.hasPartners) return 5;
  return 3;
}

export function classifyCommercialVerdict(score: number, blocked: boolean): {
  verdict: CommercialRiskVerdict;
  riskLevel: CommercialRiskResult["riskLevel"];
  saleRecommendation: string;
} {
  if (blocked) {
    return {
      verdict: "VENDA BLOQUEADA",
      riskLevel: "Crítico",
      saleRecommendation: "Não vender a prazo; venda corporativa bloqueada.",
    };
  }
  if (score < 55) {
    return {
      verdict: "APENAS PAGAMENTO ANTECIPADO",
      riskLevel: "Alto",
      saleRecommendation: "PIX/cartão/sinal; evitar boleto a prazo.",
    };
  }
  if (score <= 81) {
    return {
      verdict: "VENDA CONDICIONADA",
      riskLevel: "Médio",
      saleRecommendation: "Prazo curto, limite inicial e monitoramento.",
    };
  }
  return {
    verdict: "VENDA LIBERADA",
    riskLevel: "Baixo",
    saleRecommendation: "Prazos comerciais convencionais.",
  };
}

export function calculateCommercialRiskScore(summary: NormalizedCnpjSummary): CommercialRiskResult {
  const blockedByRegistration = !isRegistrationActive(summary.registrationStatusNormalized);
  const explanation: string[] = [];

  const registrationStatus = blockedByRegistration ? 0 : 40;
  if (blockedByRegistration) {
    explanation.push("Situação cadastral diferente de ATIVA — risco fiscal/jurídico crítico.");
  } else {
    explanation.push("Situação cadastral ATIVA.");
  }

  const years = yearsSince(summary.openedAt);
  const seniority = scoreSeniority(years);
  explanation.push(
    years != null
      ? `Senioridade: ${years.toFixed(1)} ano(s) — ${seniority} pts.`
      : "Senioridade não informada — pontuação conservadora."
  );

  const shareCapital = scoreShareCapital(summary.shareCapital);
  explanation.push(`Capital social: ${summary.shareCapital ?? 0} — ${shareCapital} pts.`);

  const companySize = summary.isMei ? 3 : scoreCompanySize(summary.companySize);
  explanation.push(
    `Porte (${summary.isMei ? "MEI" : summary.companySize ?? "indefinido"}): ${companySize} pts.`
  );

  const ownershipStructure = scoreOwnership(summary);
  explanation.push(`Estrutura societária: ${ownershipStructure} pts.`);

  const rawScore =
    registrationStatus + seniority + shareCapital + companySize + ownershipStructure;
  const score = blockedByRegistration ? Math.min(rawScore, 1) : rawScore;

  const classified = classifyCommercialVerdict(score, blockedByRegistration);

  return {
    score,
    ...classified,
    dimensions: {
      registrationStatus,
      seniority,
      shareCapital,
      companySize,
      ownershipStructure,
    },
    blockedByRegistration,
    explanation,
  };
}

export function simulateCommercialRisk(input: {
  registrationStatusNormalized: string | null;
  openedAt: string | null;
  shareCapital: number | null;
  companySize: string | null;
  isMei: boolean;
  hasPartners: boolean;
  partnersCount?: number;
}): CommercialRiskResult {
  return calculateCommercialRiskScore({
    cnpj: "00000000000000",
    cnpjFormatted: "—",
    companyName: "Simulação",
    tradeName: null,
    registrationStatus: input.registrationStatusNormalized,
    registrationStatusNormalized: input.registrationStatusNormalized,
    openedAt: input.openedAt,
    companySize: input.companySize,
    legalNature: null,
    shareCapital: input.shareCapital,
    mainCnae: null,
    secondaryCnaes: [],
    address: null,
    addressNumber: null,
    addressComplement: null,
    district: null,
    city: null,
    state: null,
    zipCode: null,
    phone: null,
    email: null,
    stateTaxIds: [],
    partners: Array.from({ length: input.partnersCount ?? (input.hasPartners ? 1 : 0) }).map(
      () => ({ name: "Sócio", role: null })
    ),
    isMei: input.isMei,
    hasPartners: input.hasPartners,
    sourceUpdatedAt: null,
  });
}
