/**
 * KPIs de negócio O2C — Conciliação / Inteligência da Carteira.
 * Read-only sobre PortfolioMaturityOrderRow[]. Não toca allocation engine.
 */

import type { PortfolioMaturityOrderRow } from "./portfolioMaturityAnalytics.js";

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function toYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function parseYmd(ymd: string | null): Date | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export type PortfolioO2cKpiCard = {
  key: string;
  title: string;
  value: number;
  count: number;
  tone: "neutral" | "green" | "blue" | "amber" | "red" | "gray";
  explanation: string;
  /** Filtro sugerido na UI (opcional). */
  filterHint?: {
    statusPrincipal?: string;
    onlyWithoutNfe?: boolean;
    onlyWithoutStockDocument?: boolean;
    onlyWithoutReceivable?: boolean;
    onlyFutureDelivery?: boolean;
    onlyPastDelivery?: boolean;
    onlyWithCr?: boolean;
    onlyWithDocOrNfe?: boolean;
    onlyOrderOnly?: boolean;
    onlyOrderWithPaymentTerms?: boolean;
    onlyOrderWithoutPaymentTerms?: boolean;
  };
};

export type PortfolioO2cEvidenceStage = {
  key: "SO_PEDIDO" | "DOC_OU_NF" | "CR_ABERTO" | "RECEBIDO" | "BLOQUEADO";
  label: string;
  count: number;
  value: number;
};

export type PortfolioO2cAgingBucket = {
  key: "OVERDUE" | "D0_30" | "D31_60" | "D61_90_PLUS" | "SEM_DATA";
  label: string;
  count: number;
  value: number;
};

export type PortfolioO2cBusinessKpis = {
  asOfDate: string;
  cards: PortfolioO2cKpiCard[];
  evidenceFunnel: PortfolioO2cEvidenceStage[];
  agingBuckets: PortfolioO2cAgingBucket[];
  /** Só pedido com condição de pagamento disponível (sem tag SEM_CONDICAO). */
  soPedidoComCondicao: { count: number; value: number };
  soPedidoSemCondicao: { count: number; value: number };
};

export function isPortfolioO2cOnlyOrder(row: PortfolioMaturityOrderRow): boolean {
  return (
    !row.evidenceFlags.hasNfe &&
    !row.evidenceFlags.hasStockDocument &&
    !row.evidenceFlags.hasReceivable
  );
}

export function portfolioO2cRowHasCr(row: PortfolioMaturityOrderRow): boolean {
  return (
    row.evidenceFlags.hasReceivable ||
    row.statusPrincipal === "CR_ABERTO" ||
    row.statusPrincipal === "RECEBIDO"
  );
}

export function portfolioO2cRowHasDocOrNfe(row: PortfolioMaturityOrderRow): boolean {
  return row.evidenceFlags.hasStockDocument || row.evidenceFlags.hasNfe;
}

export function portfolioO2cRowHasPaymentTerms(row: PortfolioMaturityOrderRow): boolean {
  return !row.tagsAlerta.includes("SEM_CONDICAO_PAGAMENTO");
}

export function portfolioO2cDeliveryAnchor(row: PortfolioMaturityOrderRow): string | null {
  return toYmd(row.expectedDeliveryDate) ?? toYmd(row.forecastDate);
}

export function portfolioO2cCashAnchor(row: PortfolioMaturityOrderRow): string | null {
  return (
    toYmd(row.receivableDueDate) ??
    toYmd(row.forecastDate) ??
    toYmd(row.expectedDeliveryDate)
  );
}

/** Dias da asOf até a entrega (positivo = futuro). null se sem data. */
export function portfolioO2cDeliveryDeltaDays(
  row: PortfolioMaturityOrderRow,
  asOfYmd: string
): number | null {
  const asOfDate = parseYmd(toYmd(asOfYmd));
  const delDate = parseYmd(portfolioO2cDeliveryAnchor(row));
  if (!asOfDate || !delDate) return null;
  return daysBetween(asOfDate, delDate);
}

const isOnlyOrder = isPortfolioO2cOnlyOrder;
const hasCr = portfolioO2cRowHasCr;
const hasDocOrNfe = portfolioO2cRowHasDocOrNfe;
const hasPaymentTerms = portfolioO2cRowHasPaymentTerms;
const deliveryAnchor = portfolioO2cDeliveryAnchor;
const cashAnchor = portfolioO2cCashAnchor;

/**
 * Agrega KPIs O2C a partir de pedidos já classificados (filtrados pela API).
 */
export function buildPortfolioO2cBusinessKpis(
  rows: readonly PortfolioMaturityOrderRow[],
  asOfDateInput?: string | null
): PortfolioO2cBusinessKpis {
  const asOf =
    toYmd(asOfDateInput) ??
    (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
  const asOfDate = parseYmd(asOf)!;

  const active = rows.filter((r) => r.statusPrincipal !== "RECEBIDO" || true);
  // Inclui RECEBIDO nos totais de pedido; buckets de entrega focam carteira aberta.

  const valorPedidos = round2(rows.reduce((s, r) => s + r.orderValue, 0));

  let entregaFuturaV = 0;
  let entregaFuturaC = 0;
  let entregaVencidaV = 0;
  let entregaVencidaC = 0;
  let virouCrV = 0;
  let virouCrC = 0;
  let comDocV = 0;
  let comDocC = 0;
  let soPedidoV = 0;
  let soPedidoC = 0;
  let soComCondV = 0;
  let soComCondC = 0;
  let soSemCondV = 0;
  let soSemCondC = 0;

  const funnel: Record<
    PortfolioO2cEvidenceStage["key"],
    { count: number; value: number }
  > = {
    SO_PEDIDO: { count: 0, value: 0 },
    DOC_OU_NF: { count: 0, value: 0 },
    CR_ABERTO: { count: 0, value: 0 },
    RECEBIDO: { count: 0, value: 0 },
    BLOQUEADO: { count: 0, value: 0 },
  };

  const aging: Record<
    PortfolioO2cAgingBucket["key"],
    { count: number; value: number }
  > = {
    OVERDUE: { count: 0, value: 0 },
    D0_30: { count: 0, value: 0 },
    D31_60: { count: 0, value: 0 },
    D61_90_PLUS: { count: 0, value: 0 },
    SEM_DATA: { count: 0, value: 0 },
  };

  for (const row of rows) {
    const v = row.orderValue;
    const del = deliveryAnchor(row);
    const delDate = parseYmd(del);
    if (delDate) {
      const delta = daysBetween(asOfDate, delDate);
      if (delta > 0) {
        entregaFuturaV = round2(entregaFuturaV + v);
        entregaFuturaC += 1;
      } else if (row.statusPrincipal !== "RECEBIDO") {
        entregaVencidaV = round2(entregaVencidaV + v);
        entregaVencidaC += 1;
      }
    }

    if (hasCr(row)) {
      virouCrV = round2(virouCrV + v);
      virouCrC += 1;
    }
    if (hasDocOrNfe(row)) {
      comDocV = round2(comDocV + v);
      comDocC += 1;
    }
    if (isOnlyOrder(row)) {
      soPedidoV = round2(soPedidoV + v);
      soPedidoC += 1;
      if (hasPaymentTerms(row)) {
        soComCondV = round2(soComCondV + v);
        soComCondC += 1;
      } else {
        soSemCondV = round2(soSemCondV + v);
        soSemCondC += 1;
      }
    }

    // Funil: um estágio principal por pedido (mutuamente exclusivo por evidência)
    if (row.statusPrincipal === "RECEBIDO") {
      funnel.RECEBIDO.count += 1;
      funnel.RECEBIDO.value = round2(funnel.RECEBIDO.value + v);
    } else if (row.statusPrincipal === "CARTEIRA_VENCIDA_BLOQUEADA") {
      funnel.BLOQUEADO.count += 1;
      funnel.BLOQUEADO.value = round2(funnel.BLOQUEADO.value + v);
    } else if (row.statusPrincipal === "CR_ABERTO" || (hasCr(row) && !row.evidenceFlags.hasReceived)) {
      funnel.CR_ABERTO.count += 1;
      funnel.CR_ABERTO.value = round2(funnel.CR_ABERTO.value + v);
    } else if (hasDocOrNfe(row) && !hasCr(row)) {
      funnel.DOC_OU_NF.count += 1;
      funnel.DOC_OU_NF.value = round2(funnel.DOC_OU_NF.value + v);
    } else if (isOnlyOrder(row)) {
      funnel.SO_PEDIDO.count += 1;
      funnel.SO_PEDIDO.value = round2(funnel.SO_PEDIDO.value + v);
    } else if (hasCr(row)) {
      funnel.CR_ABERTO.count += 1;
      funnel.CR_ABERTO.value = round2(funnel.CR_ABERTO.value + v);
    } else {
      funnel.SO_PEDIDO.count += 1;
      funnel.SO_PEDIDO.value = round2(funnel.SO_PEDIDO.value + v);
    }

    if (row.statusPrincipal === "RECEBIDO") {
      // aging de caixa já realizado não entra nos buckets a receber
      continue;
    }
    const cash = cashAnchor(row);
    const cashDate = parseYmd(cash);
    if (!cashDate) {
      aging.SEM_DATA.count += 1;
      aging.SEM_DATA.value = round2(aging.SEM_DATA.value + v);
      continue;
    }
    const d = daysBetween(asOfDate, cashDate);
    if (d < 0) {
      aging.OVERDUE.count += 1;
      aging.OVERDUE.value = round2(aging.OVERDUE.value + v);
    } else if (d <= 30) {
      aging.D0_30.count += 1;
      aging.D0_30.value = round2(aging.D0_30.value + v);
    } else if (d <= 60) {
      aging.D31_60.count += 1;
      aging.D31_60.value = round2(aging.D31_60.value + v);
    } else {
      aging.D61_90_PLUS.count += 1;
      aging.D61_90_PLUS.value = round2(aging.D61_90_PLUS.value + v);
    }
  }

  void active;

  const cards: PortfolioO2cKpiCard[] = [
    {
      key: "VALOR_EM_PEDIDOS",
      title: "Valor em pedidos",
      value: valorPedidos,
      count: rows.length,
      tone: "neutral",
      explanation:
        "Soma do valor oficial dos pedidos no recorte (um pedido uma vez). Não soma cabeçalho de NF nem excedente.",
    },
    {
      key: "ENTREGA_FUTURA",
      title: "Entrega futura",
      value: entregaFuturaV,
      count: entregaFuturaC,
      tone: "green",
      explanation:
        "Pedidos com data de entrega (ou forecast) depois de hoje. Ainda não é caixa.",
      filterHint: { onlyFutureDelivery: true },
    },
    {
      key: "ENTREGA_VENCIDA",
      title: "Entrega vencida",
      value: entregaVencidaV,
      count: entregaVencidaC,
      tone: "amber",
      explanation:
        "Entrega no passado e ainda não recebidos. Prioridade operacional/comercial.",
      filterHint: { onlyPastDelivery: true },
    },
    {
      key: "VIROU_CR",
      title: "Já virou Contas a Receber",
      value: virouCrV,
      count: virouCrC,
      tone: "blue",
      explanation: "Pedidos com título de CR (aberto ou já com baixa parcial/total).",
      filterHint: { onlyWithCr: true },
    },
    {
      key: "COM_DOC_OU_NF",
      title: "Com documento / NF",
      value: comDocV,
      count: comDocC,
      tone: "blue",
      explanation: "Há evidência de documento de saída e/ou NF vinculada ao pedido.",
      filterHint: { onlyWithDocOrNfe: true },
    },
    {
      key: "SO_PEDIDO",
      title: "Só pedido em carteira",
      value: soPedidoV,
      count: soPedidoC,
      tone: "amber",
      explanation:
        "Sem NF, sem documento de saída e sem CR. Inclui quem tem ou não condição de pagamento.",
      filterHint: { onlyOrderOnly: true },
    },
  ];

  return {
    asOfDate: asOf,
    cards,
    evidenceFunnel: [
      {
        key: "SO_PEDIDO",
        label: "Só pedido",
        count: funnel.SO_PEDIDO.count,
        value: round2(funnel.SO_PEDIDO.value),
      },
      {
        key: "DOC_OU_NF",
        label: "Doc / NF",
        count: funnel.DOC_OU_NF.count,
        value: round2(funnel.DOC_OU_NF.value),
      },
      {
        key: "CR_ABERTO",
        label: "CR aberto",
        count: funnel.CR_ABERTO.count,
        value: round2(funnel.CR_ABERTO.value),
      },
      {
        key: "RECEBIDO",
        label: "Recebido",
        count: funnel.RECEBIDO.count,
        value: round2(funnel.RECEBIDO.value),
      },
      {
        key: "BLOQUEADO",
        label: "Bloqueado",
        count: funnel.BLOQUEADO.count,
        value: round2(funnel.BLOQUEADO.value),
      },
    ],
    agingBuckets: [
      {
        key: "OVERDUE",
        label: "Vencidos",
        count: aging.OVERDUE.count,
        value: round2(aging.OVERDUE.value),
      },
      {
        key: "D0_30",
        label: "0–30 dias",
        count: aging.D0_30.count,
        value: round2(aging.D0_30.value),
      },
      {
        key: "D31_60",
        label: "31–60 dias",
        count: aging.D31_60.count,
        value: round2(aging.D31_60.value),
      },
      {
        key: "D61_90_PLUS",
        label: "61–90+ dias",
        count: aging.D61_90_PLUS.count,
        value: round2(aging.D61_90_PLUS.value),
      },
      {
        key: "SEM_DATA",
        label: "Sem data",
        count: aging.SEM_DATA.count,
        value: round2(aging.SEM_DATA.value),
      },
    ],
    soPedidoComCondicao: { count: soComCondC, value: soComCondV },
    soPedidoSemCondicao: { count: soSemCondC, value: soSemCondV },
  };
}
