import type { NormalizedCnpjSummary } from "./companyCnpjNormalize.js";
import type { CommercialRiskResult } from "./companyCommercialRiskScore.js";

export type CommercialInsight = {
  code: string;
  title: string;
  description: string;
};

export type CnaeCrossSellSuggestion = {
  category: string;
  cnaeCodes: string[];
  suggestions: string[];
};

export type TaxAlert = {
  code: string;
  level: "warning" | "info";
  message: string;
};

export function buildCommercialInsights(
  summary: NormalizedCnpjSummary,
  risk: CommercialRiskResult
): CommercialInsight[] {
  const insights: CommercialInsight[] = [];
  const years =
    summary.openedAt && !Number.isNaN(Date.parse(summary.openedAt))
      ? (Date.now() - new Date(summary.openedAt).getTime()) / (365.25 * 86400000)
      : null;

  if ((years ?? 0) >= 5 && (summary.shareCapital ?? 0) >= 100_000 && summary.hasPartners) {
    insights.push({
      code: "CORPORATE_PREMIUM",
      title: "Corporate Premium",
      description:
        "Empresa madura, capital relevante e quadro societário definido — perfil para relacionamento corporativo.",
    });
  }

  if (
    summary.isMei ||
    (summary.shareCapital ?? 0) <= 15_000 ||
    (summary.companySize?.toUpperCase().includes("MICRO") ?? false)
  ) {
    insights.push({
      code: "VOLUME_MICRO",
      title: "Volume / Micro",
      description:
        "Empresa de porte reduzido — ciclo de venda mais rápido, priorizar pagamento antecipado.",
    });
  }

  if (years != null && years < 2) {
    insights.push({
      code: "TRACTION",
      title: "Cliente em tração",
      description: "Empresa recente com potencial, mas exige cautela comercial e limites iniciais.",
    });
  }

  if (risk.blockedByRegistration) {
    insights.push({
      code: "REGISTRATION_BLOCK",
      title: "Bloqueio cadastral",
      description: "Situação cadastral impeditiva para venda a prazo.",
    });
  }

  return insights;
}

function cnaePrefix(code: string | undefined): string {
  if (!code) return "";
  const digits = code.replace(/\D/g, "");
  return digits.slice(0, 2);
}

export function buildCnaeCrossSellSuggestions(
  summary: NormalizedCnpjSummary
): CnaeCrossSellSuggestion[] {
  const codes = [
    summary.mainCnae?.code,
    ...summary.secondaryCnaes.map((c) => c.code),
  ].filter(Boolean) as string[];

  const suggestions: CnaeCrossSellSuggestion[] = [];

  const industryPrefixes = ["01", "02", "03", ...Array.from({ length: 24 }, (_, i) => String(10 + i))];
  if (codes.some((c) => industryPrefixes.includes(cnaePrefix(c)))) {
    suggestions.push({
      category: "Indústria / Agro / Produção",
      cnaeCodes: codes.filter((c) => industryPrefixes.includes(cnaePrefix(c))),
      suggestions: [
        "Insumos industriais",
        "EPIs",
        "Materiais operacionais",
        "Embalagens",
        "Itens de manutenção",
      ],
    });
  }

  if (codes.some((c) => ["41", "42", "43"].includes(cnaePrefix(c)))) {
    suggestions.push({
      category: "Construção / Infraestrutura",
      cnaeCodes: codes.filter((c) => ["41", "42", "43"].includes(cnaePrefix(c))),
      suggestions: ["Materiais de obra", "Ferramentas", "EPIs", "Logística", "Frota"],
    });
  }

  if (codes.some((c) => ["45", "46", "47"].includes(cnaePrefix(c)))) {
    suggestions.push({
      category: "Comércio / Estoque",
      cnaeCodes: codes.filter((c) => ["45", "46", "47"].includes(cnaePrefix(c))),
      suggestions: [
        "Embalagens",
        "Produtos de giro",
        "Soluções para estoque",
        "Automação comercial",
      ],
    });
  }

  const techHints = [
    summary.mainCnae?.description,
    ...summary.secondaryCnaes.map((c) => c.description),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/tecnolog|software|consultoria|informática|informatica|digital|saas/.test(techHints)) {
    suggestions.push({
      category: "Tecnologia / Consultoria",
      cnaeCodes: codes,
      suggestions: ["Soluções digitais", "SaaS", "Consultoria", "Automação"],
    });
  }

  return suggestions;
}

export function buildTaxAlerts(
  summary: NormalizedCnpjSummary,
  sellerUf = "PR"
): TaxAlert[] {
  const alerts: TaxAlert[] = [];
  const clientUf = summary.state?.toUpperCase() ?? null;

  if (clientUf && clientUf !== sellerUf.toUpperCase()) {
    alerts.push({
      code: "INTERSTATE_ICMS",
      level: "warning",
      message: `Cliente em ${clientUf} e vendedor em ${sellerUf}: possível DIFAL, conferir IE e regras fiscais interestaduais.`,
    });
  }

  if (summary.stateTaxIds.length > 0) {
    for (const ie of summary.stateTaxIds) {
      alerts.push({
        code: "STATE_IE",
        level: "info",
        message: `Inscrição estadual ${ie.number}${ie.state ? ` (${ie.state})` : ""}${ie.status ? ` — ${ie.status}` : ""}.`,
      });
    }
  } else {
    alerts.push({
      code: "STATE_IE_MISSING",
      level: "warning",
      message: "Inscrição estadual não retornada pela API — verificar IE antes de faturar.",
    });
  }

  return alerts;
}

export function buildCommercialInsightsBundle(
  summary: NormalizedCnpjSummary,
  risk: CommercialRiskResult,
  sellerUf?: string
) {
  return {
    insights: buildCommercialInsights(summary, risk),
    crossSell: buildCnaeCrossSellSuggestions(summary),
    taxAlerts: buildTaxAlerts(summary, sellerUf),
    disclaimer:
      "Análise baseada em dados públicos e regras internas. Use como apoio à decisão comercial.",
  };
}
