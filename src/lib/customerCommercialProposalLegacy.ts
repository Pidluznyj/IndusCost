/**
 * @deprecated Legacy proposal-based commercial intelligence.
 * Do not use as sales/revenue source.
 * Use customerCommercialSalesOrderView / crmCommercialOrderRules instead.
 */

import type { ProposalStatus } from "@/src/types/commercial";
import {
  isPipelineOpenStatus,
  proposalExpiryDate,
  safeNum,
} from "@/src/lib/salesFunnel";
import {
  COMMERCIAL_INTEL_VERSION,
  type CommercialHealthLevel,
  type CommercialSegment,
  type Phase2IntelResult,
  type PortfolioAbcResult,
  type RepurchaseWindowStatus,
  buildPortfolioAbcForCustomer,
} from "@/src/lib/customerCommercialShared";

/** @deprecated Legacy proposal slice — not a sales/revenue source. */
export const ABC_METHODOLOGY_PT =
  "Curva ABC pela soma do valor líquido de propostas Aprovadas por cliente, ordenados do maior para o menor: clientes que compõem os primeiros 80% da receita aprovada da carteira = A; até 95% = B; restante = C.";

/** @deprecated Legacy proposal slice — not a sales/revenue source. */
export interface ProposalIntelSlice {
  id: string;
  status: ProposalStatus;
  number?: number;
  createdAt: string;
  updatedAt: string;
  totalNetValue: unknown;
  totalMarginPerc: unknown;
  validityDays?: number | null;
  responsible?: string | null;
}

function daysBetweenIso(a: string, b: Date): number {
  const t1 = new Date(a).getTime();
  const t2 = b.getTime();
  return Math.floor((t2 - t1) / 86400000);
}

function medianSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

const SEGMENT_LABELS_PT: Record<CommercialSegment, string> = {
  ESTRATEGICO: "Estratégico",
  RECORRENTE: "Recorrente",
  OPORTUNIDADE: "Oportunidade",
  EM_RISCO: "Em risco",
  INATIVO: "Inativo",
};

/**
 * @deprecated Legacy proposal-based intelligence.
 * Do not use as sales/revenue source.
 * Use computeCommercialPhase2FromSalesOrders in customerCommercialSalesOrderView instead.
 */
export function buildPortfolioAbcForCustomerFromProposals(
  rows: Array<{ customerId: string; revenue: number }>,
  customerId: string
): PortfolioAbcResult {
  return buildPortfolioAbcForCustomer(rows, customerId, {
    basisLabel: "Soma de totalNetValue em propostas com status APPROVED",
    methodologyNote: ABC_METHODOLOGY_PT,
  });
}

/**
 * @deprecated Legacy proposal-based intelligence.
 * Do not use as sales/revenue source.
 * Use computeCommercialPhase2FromSalesOrders in customerCommercialSalesOrderView instead.
 */
export function computeCommercialPhase2(
  proposals: ProposalIntelSlice[],
  portfolioAbc: PortfolioAbcResult,
  now = new Date()
): Phase2IntelResult {
  const proxyNote =
    "Indicadores estratégicos usam o histórico completo de propostas deste cliente. Negócio fechado = proxy por proposta Aprovada (não há pedido/NF no sistema).";

  const approved = proposals
    .filter((p) => p.status === "APPROVED")
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

  const intervals: number[] = [];
  for (let i = 1; i < approved.length; i++) {
    intervals.push(
      daysBetweenIso(approved[i - 1]!.createdAt, new Date(approved[i]!.createdAt))
    );
  }
  const intervalsSorted = [...intervals].sort((a, b) => a - b);
  const medianDays = medianSorted(intervalsSorted);
  const meanDays =
    intervals.length > 0
      ? intervals.reduce((a, b) => a + b, 0) / intervals.length
      : null;

  const lastApproval = approved.length ? approved[approved.length - 1]! : null;
  const lastApprovalDate = lastApproval?.createdAt ?? null;
  const daysSinceLastApproval = lastApprovalDate
    ? daysBetweenIso(lastApprovalDate, now)
    : null;

  let predictedNextApprovalDate: string | null = null;
  if (lastApprovalDate && medianDays != null && medianDays > 0) {
    const d = new Date(lastApprovalDate);
    d.setDate(d.getDate() + Math.round(medianDays));
    predictedNextApprovalDate = d.toISOString();
  }

  let windowStatus: RepurchaseWindowStatus = "INSUFICIENTE";
  let windowDetail = "";
  if (approved.length < 2 || medianDays == null || medianDays <= 0) {
    windowStatus = "INSUFICIENTE";
    windowDetail =
      "É necessário ao menos duas propostas aprovadas para estimar intervalo entre aprovações.";
  } else if (daysSinceLastApproval == null) {
    windowStatus = "INSUFICIENTE";
    windowDetail = "Sem data de última aprovação.";
  } else {
    const ratio = daysSinceLastApproval / medianDays;
    if (ratio <= 0.85) {
      windowStatus = "DENTRO_JANELA";
      windowDetail = `Última aprovação há ${daysSinceLastApproval} dias; mediana histórica entre aprovações ≈ ${Math.round(medianDays)} dias.`;
    } else if (ratio <= 1.15) {
      windowStatus = "PROXIMA";
      windowDetail = `Próximo da janela típica de nova aprovação (mediana ≈ ${Math.round(medianDays)} dias).`;
    } else {
      windowStatus = "ATRASADO";
      windowDetail = `Acima do intervalo típico desde a última aprovação — priorizar contato (proxy de recompra).`;
    }
  }

  const allSortedByUpdate = [...proposals].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const lastMove = allSortedByUpdate[0];
  const daysSinceAnyUpdate = lastMove
    ? daysBetweenIso(lastMove.updatedAt, now)
    : null;

  const openProps = proposals.filter((p) => isPipelineOpenStatus(p.status));
  const openNet = openProps.reduce((a, p) => a + safeNum(p.totalNetValue), 0);

  const approvedNetTotal = approved.reduce(
    (a, p) => a + safeNum(p.totalNetValue),
    0
  );

  const marginSamples = approved.map((p) => safeNum(p.totalMarginPerc));
  const marginAvg =
    marginSamples.length > 0
      ? marginSamples.reduce((x, y) => x + y, 0) / marginSamples.length
      : 0;

  const closedForConv = proposals.filter((p) =>
    ["APPROVED", "REJECTED", "CANCELED"].includes(p.status)
  );
  const conv =
    closedForConv.length > 0
      ? approved.length / closedForConv.length
      : 0;

  const t180 = new Date(now);
  t180.setDate(t180.getDate() - 180);
  const t360 = new Date(now);
  t360.setDate(t360.getDate() - 360);

  const recent180 = approved.filter(
    (p) => new Date(p.createdAt) >= t180
  );
  const prior180 = approved.filter((p) => {
    const c = new Date(p.createdAt);
    return c < t180 && c >= t360;
  });
  const recent180dApprovedNet = recent180.reduce(
    (a, p) => a + safeNum(p.totalNetValue),
    0
  );
  const prior180dApprovedNet = prior180.reduce(
    (a, p) => a + safeNum(p.totalNetValue),
    0
  );

  let trendNote: string | null = null;
  if (prior180.length >= 1 && recent180.length >= 1) {
    if (prior180dApprovedNet > 0 && recent180dApprovedNet < prior180dApprovedNet * 0.7) {
      trendNote =
        "Volume aprovado nos últimos 180 dias caiu em relação aos 180 dias anteriores — revisar demanda ou relacionamento.";
    }
  } else if (approved.length >= 3 && prior180dApprovedNet === 0 && recent180dApprovedNet > 0) {
    trendNote = "Crescimento recente de aprovações após período mais fraco — monitorar sustentabilidade.";
  }

  let score = 50;
  const healthReasons: string[] = [];

  if (proposals.length === 0) {
    score = 8;
    healthReasons.push("Nenhuma proposta registrada para este cliente.");
  } else {
    if (daysSinceAnyUpdate != null && daysSinceAnyUpdate <= 30) {
      score += 18;
      healthReasons.push("Movimentação comercial recente (atualização de proposta ≤ 30 dias).");
    }
    if (openProps.length > 0) {
      score += 14;
      healthReasons.push(`Pipeline aberto: ${openProps.length} proposta(s) em andamento.`);
    }
    if (daysSinceLastApproval != null && medianDays != null && medianDays > 0) {
      if (daysSinceLastApproval <= medianDays * 1.05) {
        score += 12;
        healthReasons.push("Última aprovação alinhada à mediana de intervalo entre aprovações.");
      } else if (daysSinceLastApproval > medianDays * 1.5) {
        score -= 22;
        healthReasons.push("Tempo desde a última aprovação acima do intervalo típico.");
      }
    }
    if (daysSinceLastApproval != null && daysSinceLastApproval > 180) {
      score -= 18;
      healthReasons.push("Mais de 180 dias sem nova aprovação.");
    }
    if (daysSinceAnyUpdate != null && daysSinceAnyUpdate > 120) {
      score -= 16;
      healthReasons.push("Sem atualização em propostas há mais de 120 dias.");
    }
    if (marginAvg >= 12 && approved.length > 0) {
      score += 8;
      healthReasons.push(`Margem média nas aprovações favorável (~${marginAvg.toFixed(1)}%).`);
    }
    if (proposals.length >= 4 && conv < 0.2) {
      score -= 12;
      healthReasons.push("Taxa de conversão histórica baixa (aprovações ÷ fechadas).");
    }
    if (
      portfolioAbc.abcClass === "A" &&
      openNet === 0 &&
      daysSinceLastApproval != null &&
      daysSinceLastApproval > 45
    ) {
      score -= 10;
      healthReasons.push("Cliente relevante na carteira (ABC A) sem pipeline aberto e sem aprovação recente.");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level: CommercialHealthLevel = "ATENCAO";
  if (proposals.length === 0 || (daysSinceAnyUpdate != null && daysSinceAnyUpdate > 365)) {
    level = "INATIVO";
  } else if (score >= 72) {
    level = "SAUDAVEL";
  } else if (score >= 42) {
    level = "ATENCAO";
  } else if (score >= 18) {
    level = "EM_RISCO";
  } else {
    level = "INATIVO";
  }

  const strategicAlerts: Phase2IntelResult["strategicAlerts"] = [];

  proposals.forEach((p) => {
    if (p.status === "SENT") {
      const du = daysBetweenIso(p.updatedAt, now);
      if (du > 14) {
        strategicAlerts.push({
          level: "warn",
          text: `Follow-up: proposta #${p.number ?? "?"} enviada há ${du} dias sem atualização.`,
        });
      }
    }
    if (isPipelineOpenStatus(p.status)) {
      const exp = proposalExpiryDate(p.createdAt, p.validityDays ?? 15);
      if (exp < now) {
        strategicAlerts.push({
          level: "danger",
          text: `Validade ultrapassada na proposta #${p.number ?? "?"} (${p.status}) — realinhar ou encerrar.`,
        });
      }
    }
  });

  if (windowStatus === "ATRASADO") {
    strategicAlerts.push({
      level: "warn",
      text: "Janela de recompra (proxy por aprovações) em atraso — agendar abordagem.",
    });
  }

  const crossSell: string[] = [];
  if (approved.length >= 2) {
    crossSell.push(
      "Revise o mix de SKUs nas propostas abertas e fechadas — diversificação reduz concentração de receita."
    );
  }

  const nextActions: Phase2IntelResult["nextActions"] = [];
  if (openProps.length > 0) {
    nextActions.push({
      text: `Acompanhar fechamento das ${openProps.length} proposta(s) em aberto (pipeline R$ ${openNet.toFixed(0)}).`,
      kind: "follow_up",
    });
  }
  if (windowStatus === "ATRASADO" || windowStatus === "PROXIMA") {
    nextActions.push({
      text: "Contatar cliente alinhando próxima oportunidade / recompra (base: histórico de aprovações).",
      kind: "follow_up",
    });
  }
  if (portfolioAbc.abcClass === "A" && openNet === 0) {
    nextActions.push({
      text: "Cliente classe A sem pipeline: priorizar visita ou nova proposta para proteger a carteira.",
      kind: "risk",
    });
  }
  if (conv >= 0.45 && approved.length >= 2 && openNet === 0) {
    nextActions.push({
      text: "Boa conversão histórica sem oportunidades abertas — buscar expansão de volume.",
      kind: "expansion",
    });
  }

  let primary: CommercialSegment = "OPORTUNIDADE";
  const segReasons: string[] = [];

  if (level === "INATIVO") {
    primary = "INATIVO";
    segReasons.push("Pouca ou nenhuma atividade comercial recente.");
  } else if (level === "EM_RISCO") {
    primary = "EM_RISCO";
    segReasons.push("Health score e sinais de tempo indicam risco de esfriamento.");
  } else if (portfolioAbc.abcClass === "A" && approvedNetTotal > 0) {
    primary = "ESTRATEGICO";
    segReasons.push("Peso na carteira (ABC A) com histórico de valor aprovado.");
  } else if (openNet > 0 && approved.length === 0) {
    primary = "OPORTUNIDADE";
    segReasons.push("Pipeline ativo sem aprovação ainda — foco em conversão.");
  } else if (
    approved.length >= 3 &&
    medianDays != null &&
    medianDays < 130
  ) {
    primary = "RECORRENTE";
    segReasons.push("Intervalo típico entre aprovações sugere compra recorrente.");
  } else if (
    level === "SAUDAVEL" &&
    approved.length >= 2
  ) {
    primary = "RECORRENTE";
    segReasons.push("Relacionamento saudável com histórico de aprovações.");
  } else {
    primary = "OPORTUNIDADE";
    segReasons.push("Potencial a desenvolver com mais histórico ou maior participação na carteira.");
  }

  const sharePctStr =
    portfolioAbc.portfolioApprovedTotal > 0
      ? portfolioAbc.shareOfPortfolioPct.toFixed(1)
      : "0";
  const managerial = {
    summary: `Carteira: este cliente representa ~${sharePctStr}% da receita aprovada total (${portfolioAbc.customerCount} clientes com aprovação). ABC: ${portfolioAbc.abcClass ?? "—"}. Segmento: ${SEGMENT_LABELS_PT[primary]}.`,
  };

  return {
    version: COMMERCIAL_INTEL_VERSION,
    proxyNote,
    health: { level, score, reasons: healthReasons },
    repurchase: {
      basis: "Intervalos entre datas de criação de propostas Aprovadas (proxy de recompra)",
      medianDaysBetweenApprovals: medianDays,
      meanDaysBetweenApprovals: meanDays,
      lastApprovalDate,
      daysSinceLastApproval,
      predictedNextApprovalDate,
      windowStatus,
      windowDetail,
    },
    segment: {
      primary,
      labelsPt: SEGMENT_LABELS_PT,
      reasons: segReasons,
    },
    portfolioAbc,
    crossSell,
    nextActions: nextActions.slice(0, 8),
    strategicAlerts: strategicAlerts.slice(0, 14),
    trend: {
      recent180dApprovedNet,
      prior180dApprovedNet,
      note: trendNote,
    },
    managerial,
  };
}
