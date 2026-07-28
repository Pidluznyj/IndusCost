/**
 * Indicadores executivos da Cadeia de Suprimentos (OP-26) — motor puro.
 *
 * Regras:
 * - Cada métrica declara base + grain.
 * - Não somar solicitação + cotação + pedido + recebimento como valores do mesmo fato.
 * - Money por pipelineKey (dedupe); estoque por saldo (não some físico+disponível como “total”).
 */

export type SupplyChainIndicatorsFilters = {
  periodFrom?: string | null; // YYYY-MM-DD
  periodTo?: string | null;
  supplierId?: string | null;
  materialId?: string | null;
  warehouseId?: string | null;
};

export type IndicatorUnit = "BRL" | "QTY" | "COUNT" | "DAYS";

export type IndicatorCard = {
  id: string;
  label: string;
  value: number;
  unit: IndicatorUnit;
  /** Base declarada (o que entra no cálculo). */
  base: string;
  /** Grain de agregação / anti-dupla contagem. */
  grain: string;
  filtersApplied: string[];
  notes: string[];
};

export type PipelineMoneySnapshot = {
  pipelineKey: string;
  /** Custo comparável inicial (1ª oferta / snapshot inicial). */
  initialComparable: number | null;
  /** Melhor (menor) custo comparável inicial entre ofertas da cotação. */
  quotedBestComparable: number | null;
  /** Custo comparável negociado/adjudicado (PO preferido). */
  negotiatedComparable: number | null;
  /** Ganho negociado histórico. */
  negotiatedGain: number | null;
  /** Ganho realizado (só qty aceita confirmada). */
  realizedGain: number | null;
  createdAt: string; // ISO date for period filter
  supplierId: string | null;
  materialIds: string[];
};

export type OpenPurchaseOrderRow = {
  purchaseOrderId: string;
  pipelineKey: string;
  status: string;
  expectedDeliveryDate: string | null; // YYYY-MM-DD
  quantityPending: number;
  supplierId: string | null;
  materialIds: string[];
  createdAt: string;
};

export type InventoryBalanceAgg = {
  itemId: string;
  materialId: string | null;
  warehouseId: string;
  physical: number;
  reserved: number;
  blocked: number;
  quarantine: number;
  available: number;
  minimumStock: number | null;
  /** Demanda futura no horizonte (opcional) para cobertura. */
  futureDemand: number;
  horizonDays: number;
};

export type EvidenceExceptionRow = {
  awardId: string;
  pipelineKey: string;
  usedEvidenceException: boolean;
  evidenceCountSnapshot: number;
  status: string;
  createdAt: string;
  supplierId: string | null;
  materialIds: string[];
};

export type DivergentReceiptRow = {
  receiptId: string;
  status: string;
  purchaseOrderId: string;
  supplierId: string | null;
  materialIds: string[];
  createdAt: string;
};

function n(v: number | null | undefined): number {
  if (v == null) return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

function ymd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

export function listAppliedFilterLabels(filters: SupplyChainIndicatorsFilters): string[] {
  const out: string[] = [];
  if (filters.periodFrom) out.push(`periodFrom=${filters.periodFrom}`);
  if (filters.periodTo) out.push(`periodTo=${filters.periodTo}`);
  if (filters.supplierId) out.push(`supplierId=${filters.supplierId}`);
  if (filters.materialId) out.push(`materialId=${filters.materialId}`);
  if (filters.warehouseId) out.push(`warehouseId=${filters.warehouseId}`);
  return out;
}

export function matchesPeriod(
  createdAt: string,
  filters: SupplyChainIndicatorsFilters
): boolean {
  const d = ymd(createdAt);
  if (!d) return true;
  if (filters.periodFrom && d < filters.periodFrom) return false;
  if (filters.periodTo && d > filters.periodTo) return false;
  return true;
}

export function matchesSupplierMaterial(
  row: { supplierId: string | null; materialIds: string[] },
  filters: SupplyChainIndicatorsFilters
): boolean {
  if (filters.supplierId && row.supplierId !== filters.supplierId) return false;
  if (filters.materialId && !row.materialIds.includes(filters.materialId)) return false;
  return true;
}

/**
 * Escolhe um valor monetário por pipelineKey (maior |v| quando há múltiplos).
 * Evita somar SC + cotação + PO do mesmo fato.
 */
export function pickOnePerPipelineKey(
  rows: Array<{ pipelineKey: string; value: number | null }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.value == null || !Number.isFinite(row.value)) continue;
    const prev = map.get(row.pipelineKey);
    if (prev == null || Math.abs(row.value) > Math.abs(prev)) {
      map.set(row.pipelineKey, row.value);
    }
  }
  return map;
}

export function sumMapValues(map: Map<string, number>): number {
  let s = 0;
  for (const v of Array.from(map.values())) s += v;
  return round2(s);
}

export const OPEN_PO_STATUSES = new Set([
  "RASCUNHO",
  "APROVADO",
  "ENVIADO",
  "EMITIDO",
  "CONFIRMADO",
  "PARCIALMENTE_RECEBIDO",
]);

export function isOpenPurchaseOrderStatus(status: string): boolean {
  return OPEN_PO_STATUSES.has(status);
}

export function isSupplierLate(input: {
  expectedDeliveryDate: string | null;
  quantityPending: number;
  todayYmd: string;
}): boolean {
  if (input.quantityPending <= 1e-9) return false;
  if (!input.expectedDeliveryDate) return false;
  return input.expectedDeliveryDate < input.todayYmd;
}

/** Cobertura estimada em dias = disponível / (demandaFutura / horizonte). */
export function estimateCoverageDays(input: {
  available: number;
  futureDemand: number;
  horizonDays: number;
}): number | null {
  const available = Math.max(0, n(input.available));
  const demand = Math.max(0, n(input.futureDemand));
  const days = Math.max(1, n(input.horizonDays));
  if (demand <= 1e-9) return null;
  const daily = demand / days;
  if (daily <= 1e-12) return null;
  return round4(available / daily);
}

export function buildSupplyChainIndicatorCards(input: {
  filters: SupplyChainIndicatorsFilters;
  todayYmd: string;
  pipelines: PipelineMoneySnapshot[];
  openOrders: OpenPurchaseOrderRow[];
  balances: InventoryBalanceAgg[];
  evidenceExceptions: EvidenceExceptionRow[];
  divergentReceipts: DivergentReceiptRow[];
}): {
  cards: IndicatorCard[];
  meta: {
    doNotSumMoneyAcrossStages: true;
    stockLayersAreNotAdditiveTotal: true;
    readOnly: true;
    mutatesOfficialEngines: false;
    featureFlag: "SUPPLY_CHAIN_INDICATORS_ENABLED";
  };
  report: {
    moneyStages: Array<{ id: string; value: number; grainCount: number }>;
    lateOrders: Array<{ purchaseOrderId: string; expectedDeliveryDate: string; quantityPending: number }>;
    belowMinimumItems: Array<{ itemId: string; available: number; minimumStock: number }>;
    coverageSample: Array<{ itemId: string; coverageDays: number | null }>;
  };
} {
  const filtersApplied = listAppliedFilterLabels(input.filters);
  const pipelines = input.pipelines.filter(
    (p) => matchesPeriod(p.createdAt, input.filters) && matchesSupplierMaterial(p, input.filters)
  );
  const openOrders = input.openOrders.filter(
    (o) =>
      isOpenPurchaseOrderStatus(o.status) &&
      matchesPeriod(o.createdAt, input.filters) &&
      matchesSupplierMaterial(o, input.filters)
  );
  const balances = input.balances.filter((b) => {
    if (input.filters.warehouseId && b.warehouseId !== input.filters.warehouseId) return false;
    if (input.filters.materialId && b.materialId !== input.filters.materialId) return false;
    return true;
  });
  const evidence = input.evidenceExceptions.filter(
    (e) => matchesPeriod(e.createdAt, input.filters) && matchesSupplierMaterial(e, input.filters)
  );
  const divergent = input.divergentReceipts.filter(
    (r) =>
      r.status === "DIVERGENTE" &&
      matchesPeriod(r.createdAt, input.filters) &&
      matchesSupplierMaterial(r, input.filters)
  );

  const solicitadoMap = pickOnePerPipelineKey(
    pipelines.map((p) => ({ pipelineKey: p.pipelineKey, value: p.initialComparable }))
  );
  const cotadoMap = pickOnePerPipelineKey(
    pipelines.map((p) => ({ pipelineKey: p.pipelineKey, value: p.quotedBestComparable }))
  );
  const negociadoMap = pickOnePerPipelineKey(
    pipelines.map((p) => ({ pipelineKey: p.pipelineKey, value: p.negotiatedComparable }))
  );
  const ganhoNegMap = pickOnePerPipelineKey(
    pipelines.map((p) => ({ pipelineKey: p.pipelineKey, value: p.negotiatedGain }))
  );
  const ganhoRealMap = pickOnePerPipelineKey(
    pipelines.map((p) => ({ pipelineKey: p.pipelineKey, value: p.realizedGain }))
  );

  const valorSolicitado = sumMapValues(solicitadoMap);
  const valorCotado = sumMapValues(cotadoMap);
  const valorNegociado = sumMapValues(negociadoMap);
  const ganhoNegociado = sumMapValues(ganhoNegMap);
  const ganhoRealizado = sumMapValues(ganhoRealMap);

  const pedidosEmAberto = new Set(openOrders.map((o) => o.purchaseOrderId)).size;
  const quantidadePendente = round4(
    openOrders.reduce((s, o) => s + Math.max(0, n(o.quantityPending)), 0)
  );

  const lateOrders = openOrders
    .filter((o) =>
      isSupplierLate({
        expectedDeliveryDate: o.expectedDeliveryDate,
        quantityPending: o.quantityPending,
        todayYmd: input.todayYmd,
      })
    )
    .map((o) => ({
      purchaseOrderId: o.purchaseOrderId,
      expectedDeliveryDate: o.expectedDeliveryDate!,
      quantityPending: o.quantityPending,
    }));
  const atrasosFornecedor = new Set(lateOrders.map((l) => l.purchaseOrderId)).size;

  // Estoque: soma de camadas por saldo — NÃO somar físico+disponível como um único “total”.
  let physical = 0;
  let reserved = 0;
  let blocked = 0;
  let available = 0;
  const byItem = new Map<
    string,
    { available: number; minimumStock: number | null; futureDemand: number; horizonDays: number }
  >();
  for (const b of balances) {
    physical += n(b.physical);
    reserved += n(b.reserved);
    blocked += n(b.blocked);
    available += n(b.available);
    const prev = byItem.get(b.itemId) ?? {
      available: 0,
      minimumStock: b.minimumStock,
      futureDemand: b.futureDemand,
      horizonDays: b.horizonDays,
    };
    prev.available += n(b.available);
    if (b.minimumStock != null) {
      prev.minimumStock =
        prev.minimumStock == null ? b.minimumStock : Math.max(prev.minimumStock, b.minimumStock);
    }
    prev.futureDemand = Math.max(prev.futureDemand, n(b.futureDemand));
    prev.horizonDays = Math.max(prev.horizonDays, n(b.horizonDays) || 90);
    byItem.set(b.itemId, prev);
  }
  physical = round4(physical);
  reserved = round4(reserved);
  blocked = round4(blocked);
  available = round4(available);

  const belowMinimumItems: Array<{ itemId: string; available: number; minimumStock: number }> = [];
  const coverageSample: Array<{ itemId: string; coverageDays: number | null }> = [];
  let coverageSum = 0;
  let coverageCount = 0;
  for (const [itemId, agg] of Array.from(byItem.entries())) {
    if (agg.minimumStock != null && agg.available < agg.minimumStock) {
      belowMinimumItems.push({
        itemId,
        available: round4(agg.available),
        minimumStock: agg.minimumStock,
      });
    }
    const cov = estimateCoverageDays({
      available: agg.available,
      futureDemand: agg.futureDemand,
      horizonDays: agg.horizonDays || 90,
    });
    coverageSample.push({ itemId, coverageDays: cov });
    if (cov != null) {
      coverageSum += cov;
      coverageCount += 1;
    }
  }
  const coberturaEstimada = coverageCount > 0 ? round4(coverageSum / coverageCount) : 0;

  const negociacoesSemEvidencia = new Set(
    evidence
      .filter(
        (e) =>
          e.usedEvidenceException ||
          (e.evidenceCountSnapshot <= 0 &&
            (e.status === "APROVADA" || e.status === "PENDENTE_APROVACAO"))
      )
      .map((e) => e.awardId)
  ).size;

  const recebimentosDivergentes = new Set(divergent.map((d) => d.receiptId)).size;

  const commonNotesMoney = [
    "Não some valor solicitado + cotado + negociado + recebido — são estágios do mesmo pipeline.",
    "Grain = pipelineKey (SC / cotação / PO).",
  ];

  const cards: IndicatorCard[] = [
    {
      id: "valor_solicitado",
      label: "Valor solicitado",
      value: valorSolicitado,
      unit: "BRL",
      base: "Custo comparável inicial (1ª oferta / initialComparable) — um valor por pipelineKey",
      grain: "pipelineKey",
      filtersApplied,
      notes: [
        ...commonNotesMoney,
        "Ausência de preço na SC pura: só entra quando há snapshot inicial de cotação/PO.",
      ],
    },
    {
      id: "valor_cotado",
      label: "Valor cotado",
      value: valorCotado,
      unit: "BRL",
      base: "Melhor (menor) custo comparável inicial entre ofertas da cotação — um por pipelineKey",
      grain: "pipelineKey",
      filtersApplied,
      notes: [...commonNotesMoney, "Não soma todas as ofertas de todos os fornecedores."],
    },
    {
      id: "valor_negociado",
      label: "Valor negociado",
      value: valorNegociado,
      unit: "BRL",
      base: "negotiatedComparableTotalSnapshot (PO) ou awardedComparableTotal (award) — um por pipelineKey",
      grain: "pipelineKey",
      filtersApplied,
      notes: commonNotesMoney,
    },
    {
      id: "ganho_negociado",
      label: "Ganho negociado",
      value: ganhoNegociado,
      unit: "BRL",
      base: "totalGainSnapshot / award.totalGain — mérito histórico, um por pipelineKey",
      grain: "pipelineKey",
      filtersApplied,
      notes: ["Ortogonal ao ganho realizado — não substitui nem soma com realizado."],
    },
    {
      id: "ganho_realizado",
      label: "Ganho realizado",
      value: ganhoRealizado,
      unit: "BRL",
      base: "realizedSavingsEngine sobre qty aceita em recebimentos APROVADO — um por pipelineKey",
      grain: "pipelineKey",
      filtersApplied,
      notes: ["Só quantidade confirmada no ledger SC; não altera mérito negociado."],
    },
    {
      id: "pedidos_em_aberto",
      label: "Pedidos em aberto",
      value: pedidosEmAberto,
      unit: "COUNT",
      base: "PO com status aberto (≠ RECEBIDO/CANCELADO/ENCERRADO)",
      grain: "purchaseOrderId",
      filtersApplied,
      notes: [],
    },
    {
      id: "quantidade_pendente",
      label: "Quantidade pendente",
      value: quantidadePendente,
      unit: "QTY",
      base: "Σ (qty pedida − qty aceita APROVADO) em POs abertos",
      grain: "purchaseOrderItem → agregado por PO aberto",
      filtersApplied,
      notes: ["Rejeitada/cancelada não entra como recebida."],
    },
    {
      id: "atrasos_fornecedor",
      label: "Atrasos de fornecedor",
      value: atrasosFornecedor,
      unit: "COUNT",
      base: "PO aberto com expectedDeliveryDate < hoje e qty pendente > 0",
      grain: "purchaseOrderId",
      filtersApplied,
      notes: ["Sem data prevista não conta como atraso (só como risco operacional)."],
    },
    {
      id: "estoque_fisico",
      label: "Estoque físico",
      value: physical,
      unit: "QTY",
      base: "Σ InventoryBalance.physicalQuantity",
      grain: "balance row",
      filtersApplied,
      notes: ["Camada física — não some com disponível para obter ‘estoque total’."],
    },
    {
      id: "estoque_reservado",
      label: "Reservado",
      value: reserved,
      unit: "QTY",
      base: "Σ InventoryBalance.reservedQuantity",
      grain: "balance row",
      filtersApplied,
      notes: [],
    },
    {
      id: "estoque_bloqueado",
      label: "Bloqueado",
      value: blocked,
      unit: "QTY",
      base: "Σ InventoryBalance.blockedQuantity",
      grain: "balance row",
      filtersApplied,
      notes: [],
    },
    {
      id: "estoque_disponivel",
      label: "Disponível",
      value: available,
      unit: "QTY",
      base: "Σ InventoryBalance.availableQuantity (já derivado: físico − reservado − bloqueado − quarentena)",
      grain: "balance row",
      filtersApplied,
      notes: ["Derivado — não some novamente as camadas."],
    },
    {
      id: "materiais_abaixo_minimo",
      label: "Materiais abaixo do mínimo",
      value: belowMinimumItems.length,
      unit: "COUNT",
      base: "Itens ACTIVE com Σ available < minimumStock",
      grain: "inventoryItemId",
      filtersApplied,
      notes: [],
    },
    {
      id: "cobertura_estimada",
      label: "Cobertura estimada",
      value: coberturaEstimada,
      unit: "DAYS",
      base: "Média de dias = available / (futureDemand / horizonDays) nos itens com demanda futura",
      grain: "inventoryItemId (média)",
      filtersApplied,
      notes: [
        "Estimativa — demanda futura de OPs/BOM no horizonte (modo sombra); 0 se sem demanda.",
        coverageCount === 0 ? "Sem itens com demanda futura no filtro." : `Amostra: ${coverageCount} item(ns).`,
      ],
    },
    {
      id: "negociacoes_sem_evidencia",
      label: "Negociações sem evidência",
      value: negociacoesSemEvidencia,
      unit: "COUNT",
      base: "Awards com usedEvidenceException ou evidenceCountSnapshot=0 (pendente/aprovada)",
      grain: "awardId",
      filtersApplied,
      notes: [],
    },
    {
      id: "recebimentos_divergentes",
      label: "Recebimentos divergentes",
      value: recebimentosDivergentes,
      unit: "COUNT",
      base: "PurchaseReceipt.status = DIVERGENTE",
      grain: "receiptId",
      filtersApplied,
      notes: ["Aguarda decisão operacional — não é saldo físico."],
    },
  ];

  return {
    cards,
    meta: {
      doNotSumMoneyAcrossStages: true,
      stockLayersAreNotAdditiveTotal: true,
      readOnly: true,
      mutatesOfficialEngines: false,
      featureFlag: "SUPPLY_CHAIN_INDICATORS_ENABLED",
    },
    report: {
      moneyStages: [
        { id: "valor_solicitado", value: valorSolicitado, grainCount: solicitadoMap.size },
        { id: "valor_cotado", value: valorCotado, grainCount: cotadoMap.size },
        { id: "valor_negociado", value: valorNegociado, grainCount: negociadoMap.size },
        { id: "ganho_negociado", value: ganhoNegociado, grainCount: ganhoNegMap.size },
        { id: "ganho_realizado", value: ganhoRealizado, grainCount: ganhoRealMap.size },
      ],
      lateOrders,
      belowMinimumItems,
      coverageSample: coverageSample.filter((c) => c.coverageDays != null).slice(0, 50),
    },
  };
}

/** Comparável simples de oferta: Σ qty×price + frete + impostos + despesas − descontos. */
export function offerInitialComparable(input: {
  lines: Array<{ unitPrice: number; quantity: number }>;
  freight?: number | null;
  taxes?: number | null;
  expenses?: number | null;
  discounts?: number | null;
}): number {
  const items = input.lines.reduce((s, l) => s + n(l.unitPrice) * n(l.quantity), 0);
  return round2(items + n(input.freight) + n(input.taxes) + n(input.expenses) - n(input.discounts));
}
