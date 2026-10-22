/**
 * Visão 360° de Comissões — tipos, rótulos e textos (módulo puro, seguro para o frontend).
 *
 * Camada gerencial de LEITURA sobre os registros oficiais. Não calcula percentual,
 * não grava snapshot, schedule, cobertura, fechamento, ledger nem pagamento.
 * O cálculo está em commission360View.ts; a leitura Prisma em commission360View.server.ts.
 *
 * Naturezas econômicas que nunca se somam entre si:
 * - CONFIRMADO: pagamento ao vendedor em lote PAID com data de pagamento.
 * - LEGADO: comissão contemplada em relatório do Nomus importado (sem data de desembolso).
 * - REALIZADO: comissão de recebimentos reais do cliente (evento de recebimento).
 * - PREVISTO: comissão ligada ao saldo em aberto de CRs com schedule vigente.
 * - POTENCIAL: comissão do snapshot correspondente à quantidade ainda não faturada do PV.
 * - SEM CONCILIAÇÃO: valores que as fontes não sustentam (não entram em nenhum total).
 */

export const COMMISSION_360_TITLE = "Visão 360° de Comissões";

export const COMMISSION_360_DESCRIPTION =
  "Visão histórica, atual e futura das comissões comerciais. Acompanha pagamentos, valores realizados, " +
  "previsões financeiras e potencial da carteira, com conciliação das fontes oficiais.";

export const COMMISSION_360_READ_ONLY_NOTE =
  "Somente leitura: esta visão não recalcula comissão, não gera schedule, não cobre recebimento, " +
  "não fecha competência e não paga vendedor.";

/** Meses do diagnóstico prioritário (CRs com vencimento em novembro e dezembro de 2026). */
export const COMMISSION_360_DIAGNOSTIC_MONTHS = ["2026-11", "2026-12"] as const;

export type Commission360Section = "paid" | "realized" | "forecast" | "potential" | "reconciliation";

export const COMMISSION_360_SECTIONS: ReadonlyArray<{ id: Commission360Section; label: string }> = [
  { id: "paid", label: "Pagamentos" },
  { id: "realized", label: "Realizada não paga" },
  { id: "forecast", label: "Prevista sobre CRs" },
  { id: "potential", label: "Potencial em PVs" },
  { id: "reconciliation", label: "Conciliação de CRs" },
];

export type Commission360Nature = "CONFIRMADO" | "LEGADO" | "REALIZADO" | "PREVISTO" | "POTENCIAL" | "SEM_CONCILIACAO";

export const COMMISSION_360_NATURE_LABELS: Record<Commission360Nature, string> = {
  CONFIRMADO: "Valor confirmado",
  LEGADO: "Histórico legado sem confirmação de desembolso",
  REALIZADO: "Valor realizado",
  PREVISTO: "Valor previsto",
  POTENCIAL: "Valor potencial",
  SEM_CONCILIACAO: "Valor sem conciliação",
};

// ---------------------------------------------------------------------------
// Conciliação inversa CR → comissão
// ---------------------------------------------------------------------------

export type Commission360CrStatus =
  | "COBERTO_FUTURA"
  | "COBERTO_REALIZADA"
  | "COBERTO_ZERADA"
  | "CLIENTE_EXCLUIDO"
  | "EMPRESA_GRUPO"
  | "VENDEDOR_NAO_COMISSIONAVEL"
  | "SEM_VINCULO_NFE"
  | "SEM_VINCULO_PV"
  | "VINCULO_PV_AMBIGUO"
  | "PEDIDO_CANCELADO"
  | "SEM_SNAPSHOT"
  | "SNAPSHOT_SUBSTITUIDO"
  | "SEM_SCHEDULE"
  | "SCHEDULE_INCONSISTENTE"
  | "SALDO_LIQUIDADO"
  | "FORA_UNIVERSO"
  | "DIVERGENCIA_ALOCACAO"
  | "DADOS_INSUFICIENTES";

/** Grupo da classificação: decide em qual linha da conciliação o saldo cai. */
export type Commission360CrGroup = "COBERTO" | "EXCLUIDO" | "SEM_COBERTURA" | "LIQUIDADO" | "FORA_UNIVERSO" | "DIVERGENCIA";

export const COMMISSION_360_CR_STATUS_META: Record<
  Commission360CrStatus,
  { label: string; group: Commission360CrGroup; description: string }
> = {
  COBERTO_FUTURA: {
    label: "Coberto com comissão futura",
    group: "COBERTO",
    description: "Schedule vigente e saldo em aberto: a comissão futura vem do motor da Previsão.",
  },
  COBERTO_REALIZADA: {
    label: "Coberto com comissão já realizada",
    group: "COBERTO",
    description: "Schedule vigente; a comissão já foi realizada pelos recebimentos do título.",
  },
  COBERTO_ZERADA: {
    label: "Coberto com comissão zerada legitimamente",
    group: "COBERTO",
    description: "Schedule vigente com comissão zero no snapshot oficial (sem base, regra zerada).",
  },
  CLIENTE_EXCLUIDO: {
    label: "Cliente excluído",
    group: "EXCLUIDO",
    description: "Cliente em Exceções por cliente na data da venda: sem comissão, como no fechamento.",
  },
  EMPRESA_GRUPO: {
    label: "Empresa do grupo",
    group: "EXCLUIDO",
    description: "Sacado é empresa do grupo: fora da comissão, como no fechamento.",
  },
  VENDEDOR_NAO_COMISSIONAVEL: {
    label: "Vendedor não comissionável / não resolvido",
    group: "EXCLUIDO",
    description: "O snapshot oficial não tem vendedor comissionável resolvido (NO_SELLER / SELLER_UNRESOLVED).",
  },
  SEM_VINCULO_NFE: {
    label: "Sem vínculo de NF-e",
    group: "SEM_COBERTURA",
    description: "O título não aponta NF-e de origem (sourceInvoiceId vazio). Pode não ser título de venda.",
  },
  SEM_VINCULO_PV: {
    label: "Sem vínculo de PV",
    group: "SEM_COBERTURA",
    description: "A NF-e do título não está vinculada a nenhum Pedido de Venda sincronizado.",
  },
  VINCULO_PV_AMBIGUO: {
    label: "Vínculo de PV ambíguo",
    group: "DIVERGENCIA",
    description: "A NF-e aparece em mais de um Pedido de Venda: o motor oficial também não escolhe.",
  },
  PEDIDO_CANCELADO: {
    label: "Pedido cancelado",
    group: "EXCLUIDO",
    description: "O Pedido de Venda vinculado está cancelado no IndusCost.",
  },
  SEM_SNAPSHOT: {
    label: "Sem snapshot",
    group: "SEM_COBERTURA",
    description: "Não há snapshot oficial de comissão para o pedido/NF-e do título.",
  },
  SNAPSHOT_SUBSTITUIDO: {
    label: "Snapshot substituído",
    group: "SEM_COBERTURA",
    description: "Só existem versões substituídas do snapshot do pedido/NF-e: nenhuma versão vigente.",
  },
  SEM_SCHEDULE: {
    label: "Sem schedule válido",
    group: "SEM_COBERTURA",
    description: "Há snapshot vigente, mas o título não tem schedule de comissão vigente.",
  },
  SCHEDULE_INCONSISTENTE: {
    label: "Schedule órfão ou inconsistente",
    group: "DIVERGENCIA",
    description: "O schedule do título é órfão, com erro ou de uma versão substituída do pedido.",
  },
  SALDO_LIQUIDADO: {
    label: "Saldo liquidado",
    group: "LIQUIDADO",
    description: "Título sem saldo em aberto e sem schedule: não há comissão futura possível.",
  },
  FORA_UNIVERSO: {
    label: "Título suspenso ou fora do universo operacional",
    group: "FORA_UNIVERSO",
    description: "Cobrança suspensa ou título removido na origem (ausência confirmada).",
  },
  DIVERGENCIA_ALOCACAO: {
    label: "Divergência de alocação",
    group: "DIVERGENCIA",
    description: "O saldo do título não sustenta toda a comissão alocada ainda não realizada.",
  },
  DADOS_INSUFICIENTES: {
    label: "Dados insuficientes",
    group: "DIVERGENCIA",
    description: "Faltam dados para provar o vínculo ou a elegibilidade. Nada é presumido.",
  },
};

export type Commission360CrRow = {
  receivableId: number;
  invoiceNumber: string | null;
  sourceInvoiceId: number | null;
  dueDate: string | null;
  dueMonth: string | null;
  customerName: string | null;
  orderCode: string | null;
  salesOrderId: string | null;
  canonicalSellerId: string | null;
  sellerName: string | null;
  nominalAmount: number;
  /** Saldo em aberto oficial do título (null = fora do universo operacional). */
  openBalance: number | null;
  status: Commission360CrStatus;
  group: Commission360CrGroup;
  reason: string;
  /** Comissão alocada pelo schedule vigente (motor oficial). */
  allocatedCommission: number;
  /** Comissão futura calculada pelo motor da Previsão. */
  forecastCommission: number;
  realizedCommission: number;
  /** Comissão do título que o motor deixou fora da previsão (unreconciled). */
  unreconciledCommission: number;
  /**
   * Comissão potencial SEM cobertura confirmada: só quando há snapshot vigente,
   * vendedor resolvido e cliente elegível, mas falta o schedule. Rateio do snapshot
   * pelo mesmo rateio do scheduler oficial, simulado em memória. Nunca entra na previsão.
   */
  potentialUncoveredCommission: number | null;
  /**
   * Excesso do PV: comissão alocada em schedules vigentes de TODAS as NF-e do pedido acima da
   * comissão do pedido (risco R1). null = não verificável (sem PV ou snapshots divergentes).
   */
  orderOverAllocatedCommission: number | null;
  scheduleIds: string[];
  snapshotIds: string[];
};

export type Commission360ReconciliationFunnel = {
  operationalCount: number;
  operationalBalance: number;
  commissionableCount: number;
  commissionableBalance: number;
  coveredCount: number;
  coveredBalance: number;
  forecastCommission: number;
  differenceCount: number;
  differenceBalance: number;
};

export type Commission360DiagnosticColumn = {
  month: string | "TOTAL";
  label: string;
  crCount: number;
  openBalance: number;
  eligibleBalance: number;
  coveredBalance: number;
  uncoveredBalance: number;
  excludedBalance: number;
  allocatedCommission: number;
  forecastCommission: number;
  potentialUncoveredCommission: number;
  differenceBalance: number;
  /** Comissão futura de títulos cujo PV tem alocação acima da comissão do pedido (R1). */
  forecastOnOverAllocatedOrders: number;
  /** Soma do excesso de alocação por PV (cada PV uma vez). */
  orderOverAllocationExcess: number;
  byStatus: Array<{ status: Commission360CrStatus; count: number; openBalance: number }>;
};

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

/**
 * Mês da série principal. A série histórica oficial (pago, realizado) só existe a partir do
 * cutover (10/2026); antes dele o valor é null (não zero): o mês só aparece por causa da
 * previsão, que começa no marco da Previsão (09/2026). Legado e ajustes retroativos nunca
 * entram aqui — ficam em `legacySection`.
 */
export type Commission360Month = {
  month: string;
  label: string;
  kind: "past" | "current" | "future";
  /** Mês com fechamento oficial no IndusCost (≥ cutover). */
  official: boolean;
  /** CONFIRMADO: lote PAID de competência oficial, pela data do pagamento. null antes do cutover. */
  paidConfirmed: number | null;
  /** REALIZADO: comissão dos recebimentos oficiais do mês (receiptDate ≥ cutover, sem cobertura Nomus). */
  realized: number | null;
  /** PREVISTO: comissão sobre o saldo aberto dos CRs com vencimento no mês. */
  forecast: number;
};

export type Commission360SeriesInfo = {
  /** Primeiro mês da série histórica oficial (cutover do fechamento IndusCost). */
  officialStartMonth: string;
  /** Primeiro mês da previsão (marco da Previsão; antes dele vale o relatório do Nomus). */
  forecastStartMonth: string;
  note: string;
};

export const COMMISSION_360_LEGACY_SECTION_TITLE = "Histórico legado / Ajustes retroativos";

export const COMMISSION_360_LEGACY_SECTION_NOTE =
  "Valores que NÃO integram a série principal: histórico do Nomus (espelho técnico até 30/09/2026), " +
  "recebimentos com competência natural anterior a 10/2026, linhas de ajuste retroativo dos fechamentos " +
  "(LEGACY_CARRYOVER e ajustes manuais), lotes de competência anterior ao corte e previsão de títulos " +
  "vencidos antes de 09/2026. Um valor legado pago depois do corte continua legado.";

export type Commission360LegacyTotals = {
  /** Comissão contemplada em relatório do Nomus (NOMUS_LEGACY), sem confirmação de desembolso. */
  nomusLegacyCovered: number;
  nomusLegacyCoveredCount: number;
  /** Comissão realizada de recebimentos legados (receiptDate < cutover ou cobertos pelo Nomus). */
  legacyRealized: number;
  /** Parte desses recebimentos legados ainda sem cobertura de fechamento (pendência antiga). */
  legacyAwaitingClosing: number;
  /** Liberado em fechamento oficial como ajuste retroativo (LEGACY_CARRYOVER, MANUAL_ADJUSTMENT). */
  retroactiveReleased: number;
  /** Ajuste retroativo liberado e não pago (só quando o pagamento do fechamento é atribuível). */
  retroactiveNotPaid: number;
  /** Lotes PAID de competência anterior ao corte ou que atravessam o corte. */
  legacyPayments: number;
  legacyPaymentsCount: number;
  /** Comissão prevista de títulos em aberto vencidos antes do marco da Previsão. */
  forecastBeforeStart: number;
  forecastBeforeStartCount: number;
};

export type Commission360LegacySection = {
  title: string;
  note: string;
  totals: Commission360LegacyTotals;
  /** Por competência natural (mês do recebimento / do relatório Nomus / natural da linha retroativa). */
  byMonth: Array<{ month: string; label: string; nomusLegacyCovered: number; legacyRealized: number; retroactiveReleased: number }>;
  bySeller: Array<{
    key: string;
    sellerName: string;
    nomusLegacyCovered: number;
    legacyRealized: number;
    legacyAwaitingClosing: number;
    retroactiveReleased: number;
    legacyPayments: number;
  }>;
  /** Lotes pagos fora da série (competência anterior ao corte ou atravessando o corte). */
  payments: Array<Commission360PaymentRow & { reason: string }>;
  /** Linhas retroativas dos fechamentos oficiais, agregadas por fechamento × natural × vendedor × tipo. */
  retroactiveLines: Array<{
    competence: string;
    naturalMonth: string | null;
    sellerName: string;
    inclusionType: string;
    released: number;
  }>;
};

export type Commission360Cards = {
  paidConfirmed: number;
  paidConfirmedCount: number;
  legacyUnconfirmed: number;
  realizedAwaitingClosing: number;
  releasedNotPaid: number;
  /** Liberada com lote candidato sem vínculo: não se sabe se foi paga. */
  releasedUnreconciled: number;
  unmatchedPaymentsAmount: number;
  unmatchedPaymentsCount: number;
  forecastOnReceivables: number;
  potentialOnOrders: number;
  potentialToReconcileCount: number;
  uncoveredReceivablesCount: number;
  uncoveredReceivablesBalance: number;
};

export type Commission360SellerRow = {
  key: string;
  canonicalSellerId: string | null;
  sellerName: string;
  paidConfirmed: number;
  realizedAwaitingClosing: number;
  releasedNotPaid: number;
  forecast: number;
  potential: number;
};

export type Commission360PaymentRow = {
  batchId: string;
  paymentDate: string | null;
  month: string | null;
  sellerKey: string;
  sellerName: string;
  itemCount: number;
  amountPaid: number;
  source: "LOTE_INDUSCOST_PAGO";
  notes: string | null;
};

export type Commission360LegacyRow = {
  coverageId: string;
  receiptExternalId: number | null;
  receivableId: number;
  competence: string | null;
  sellerKey: string;
  sellerName: string;
  coveredCommissionAmount: number | null;
  legacyImportId: string | null;
  /** Mesmo título também pago em lote confirmado: prevalece o lote, não entra no total legado. */
  supersededByConfirmedPayment: boolean;
};

export type Commission360ReleasedStatus = "PAGO" | "PAGO_PARCIAL" | "NAO_PAGO" | "NAO_CONCILIADO" | "PAGO_ACIMA_DO_LIBERADO";

export const COMMISSION_360_RELEASED_STATUS_LABELS: Record<Commission360ReleasedStatus, string> = {
  PAGO: "Paga",
  PAGO_PARCIAL: "Paga parcialmente",
  NAO_PAGO: "Não paga",
  NAO_CONCILIADO: "Não conciliada (lote sem vínculo)",
  PAGO_ACIMA_DO_LIBERADO: "Paga acima do liberado",
};

export type Commission360ReleasedRow = {
  key: string;
  competence: string;
  sellerKey: string;
  canonicalSellerId: string | null;
  sellerName: string;
  closingId: string;
  released: number;
  /** Parte operacional do liberado (NORMAL / LATE_CARRYOVER com competência natural ≥ cutover). */
  releasedOperational: number;
  /** Parte de ajuste retroativo (LEGACY_CARRYOVER, MANUAL_ADJUSTMENT ou natural < cutover). */
  releasedAdjustment: number;
  /** Ajuste retroativo liberado e não pago (fica na seção legado/ajustes, fora do card). */
  adjustmentNotPaid: number;
  /** Pago com vínculo por linha (mesmo CommissionRecord do item do lote e da linha do fechamento). */
  paidByLine: number;
  /** Pago por lote do vendedor com período inteiro na competência (único fechamento do mês). */
  paidByCompetence: number;
  paid: number;
  /** Liberada sem pagamento e sem lote candidato. */
  releasedNotPaid: number;
  /** Liberada sem prova: há lote pago do vendedor cobrindo a competência, mas sem vínculo. */
  unreconciledAmount: number;
  overpaidAmount: number;
  status: Commission360ReleasedStatus;
  matchedBatchIds: string[];
  candidateBatchIds: string[];
};

/** Lote pago que não pôde ser ligado a nenhum fechamento: não abate nada. */
export type Commission360UnmatchedPaymentRow = {
  batchId: string;
  sellerKey: string;
  sellerName: string;
  periodStart: string;
  periodEnd: string;
  paymentDate: string | null;
  amount: number;
  reason: string;
};

export type Commission360RealizedRow = {
  scheduleId: string;
  receivableId: number;
  installmentNumber: number;
  orderCode: string;
  customerName: string;
  canonicalSellerId: string | null;
  sellerName: string;
  realizedCommission: number;
  awaitingClosing: number;
  lastReceiptDate: string | null;
};

export type Commission360ForecastRow = {
  scheduleId: string;
  receivableId: number;
  receivableCode: string | null;
  installmentNumber: number;
  dueDate: string | null;
  dueMonth: string | null;
  orderCode: string;
  salesOrderId: string;
  customerId: string;
  customerName: string;
  canonicalSellerId: string | null;
  sellerName: string;
  openPrincipal: number | null;
  allocatedCommission: number;
  forecastCommission: number;
  unreconciledCommission: number;
  status: string;
};

export type Commission360PotentialStatus =
  | "PENDENTE_FATURAMENTO"
  | "TOTALMENTE_FATURADO"
  | "PEDIDO_CANCELADO"
  | "CLIENTE_EXCLUIDO"
  | "SEM_SNAPSHOT"
  | "VENDEDOR_NAO_RESOLVIDO"
  | "SNAPSHOTS_DIVERGENTES"
  | "SEM_SALDO_OPERACIONAL"
  | "JA_ALOCADO_EM_CR";

export const COMMISSION_360_POTENTIAL_STATUS_LABELS: Record<Commission360PotentialStatus, string> = {
  PENDENTE_FATURAMENTO: "Pendente de faturamento",
  TOTALMENTE_FATURADO: "Totalmente faturado",
  PEDIDO_CANCELADO: "Pedido cancelado",
  CLIENTE_EXCLUIDO: "Cliente excluído",
  SEM_SNAPSHOT: "Sem snapshot (a conciliar)",
  VENDEDOR_NAO_RESOLVIDO: "Vendedor não resolvido (a conciliar)",
  SNAPSHOTS_DIVERGENTES: "Snapshots divergentes (a conciliar)",
  SEM_SALDO_OPERACIONAL: "Sem saldo operacional (a conciliar)",
  JA_ALOCADO_EM_CR: "Comissão já alocada nos CRs pelo motor",
};

export type Commission360PotentialItemRow = {
  salesOrderItemId: string;
  productName: string | null;
  orderedQuantity: number | null;
  invoicedQuantity: number | null;
  pendingQuantity: number | null;
  /** Comissão total gerada pelo item no snapshot oficial. */
  totalCommission: number | null;
  invoicedCommission: number | null;
  pendingCommission: number | null;
  status: Commission360PotentialStatus;
  reason: string | null;
};

export type Commission360PotentialOrderRow = {
  salesOrderId: string;
  orderCode: string | null;
  saleDate: string | null;
  customerName: string;
  canonicalSellerId: string | null;
  sellerName: string;
  totalCommission: number;
  invoicedCommission: number;
  /** Potencial: parte pendente pela quantidade, limitada ao que ainda não está em schedules. */
  pendingCommission: number;
  /** Parte pendente só pela quantidade não faturada (antes do limite dos schedules). */
  quantityPendingCommission: number;
  /** Comissão do pedido já alocada pelo motor em schedules vigentes (previsão/realizado). */
  alreadyScheduledCommission: number;
  /** Alocado em schedules acima da comissão do pedido (ex.: um snapshot por NF-e). Não conciliado. */
  overAllocatedCommission: number;
  /** Itens sem base confiável para a parte pendente: nada é estimado. */
  toReconcileItemCount: number;
  status: Commission360PotentialStatus;
  items: Commission360PotentialItemRow[];
};

export type Commission360Payload = {
  title: string;
  description: string;
  readOnlyNote: string;
  today: string;
  filters: {
    fromMonth: string;
    toMonth: string;
    canonicalSellerId: string | null;
    customer: string | null;
    orderCode: string | null;
    section: Commission360Section;
    crStatus: Commission360CrStatus | null;
  };
  sellerLocked: boolean;
  cards: Commission360Cards;
  months: Commission360Month[];
  bySeller: Commission360SellerRow[];
  funnel: Commission360ReconciliationFunnel;
  diagnostic: Commission360DiagnosticColumn[];
  detail: {
    section: Commission360Section;
    page: number;
    pageSize: number;
    totalRows: number;
    payments?: Commission360PaymentRow[];
    legacy?: Commission360LegacyRow[];
    released?: Commission360ReleasedRow[];
    unmatchedPayments?: Commission360UnmatchedPaymentRow[];
    realized?: Commission360RealizedRow[];
    forecast?: Commission360ForecastRow[];
    potential?: Commission360PotentialOrderRow[];
    receivables?: Commission360CrRow[];
  };
  series: Commission360SeriesInfo;
  legacySection: Commission360LegacySection;
  sources: Array<{ indicator: string; nature: Commission360Nature; source: string; rule: string; limitation: string | null }>;
  limitations: string[];
};

/** Fontes oficiais de cada indicador (mostradas na tela e no relatório). */
export const COMMISSION_360_SOURCES: Commission360Payload["sources"] = [
  {
    indicator: "Pago efetivamente",
    nature: "CONFIRMADO",
    source: "CommissionPaymentBatch PAID + CommissionPaymentBatchItem PAID",
    rule:
      "Soma de amountPaid dos itens pagos, no mês de paymentDate do lote, só de lotes com competência (período) " +
      "inteiramente a partir de 10/2026. Lote de competência legada pago depois do corte fica no legado.",
    limitation: "Não há estorno registrado no schema; lote PAID sem data de pagamento aparece como divergência.",
  },
  {
    indicator: "Histórico legado Nomus (seção separada)",
    nature: "LEGADO",
    source: "CommissionReceiptCoverage NOMUS_LEGACY COVERED",
    rule: "Comissão contemplada no relatório do Nomus importado, pela competência do relatório. Nunca entra na série principal.",
    limitation: "O relatório não traz a data do desembolso: não é tratado como pagamento confirmado.",
  },
  {
    indicator: "Realizada aguardando fechamento",
    nature: "REALIZADO",
    source: "Motor da Previsão (NomusReceivableReceipt × CommissionReceivableSchedule × CommissionReceiptCoverage)",
    rule:
      "Comissão de eventos de recebimento ainda sem cobertura de fechamento, com receiptDate a partir de 01/10/2026 " +
      "(competência natural). Recebimentos legados sem cobertura são pendência antiga, na seção legado.",
    limitation: "Saldo atual; a posição de meses passados não é reconstruída.",
  },
  {
    indicator: "Liberada e ainda não paga",
    nature: "CONFIRMADO",
    source: "CommissionReceiptLedgerLine de fechamentos CLOSED (competência ≥ 10/2026) − lotes PAID do vendedor",
    rule:
      "Liberado no fechamento oficial menos pagamentos com evidência: mesmo CommissionRecord (linha) ou lote do vendedor " +
      "com período inteiro na competência. Lote sem evidência não abate nada e a liberada vira 'não conciliada'. " +
      "Só linhas operacionais (NORMAL/LATE_CARRYOVER com competência natural ≥ 10/2026); LEGACY_CARRYOVER e ajustes " +
      "manuais são ajustes retroativos, na seção legado.",
    limitation: "Linhas de fechamento vindas de schedule não têm CommissionRecord: sem lote mensal exato não há como provar o pagamento.",
  },
  {
    indicator: "Prevista sobre CRs",
    nature: "PREVISTO",
    source: "Motor oficial da Previsão (commissionPortfolioOutlook)",
    rule:
      "min(comissão alocada × saldo aberto / nominal, alocada − realizada), por mês de vencimento, a partir de 09/2026 " +
      "(marco da Previsão). Títulos em aberto vencidos antes disso ficam na seção legado.",
    limitation: "Só títulos com schedule vigente. Títulos sem schedule aparecem na conciliação, nunca na previsão.",
  },
  {
    indicator: "Potencial em PVs pendentes",
    nature: "POTENCIAL",
    source: "CommissionOrderItemSnapshot (snapshot ACTIVE) × SalesOrderItemFlowSnapshot",
    rule:
      "Comissão final do item × quantidade ainda não faturada / quantidade pedida, limitada à comissão do pedido " +
      "ainda não alocada em schedules (o motor aloca a comissão inteira já na primeira NF-e).",
    limitation: "Sem data confiável de faturamento: fica sem vencimento. Item sem fluxo ou com snapshots divergentes fica a conciliar.",
  },
];

export function commission360MonthLabel(month: string): string {
  const names = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  const [year, mon] = month.split("-");
  return `${names[Number(mon) - 1] ?? mon}/${(year ?? "").slice(2)}`;
}

export function buildCommission360ClientQuery(input: {
  fromMonth: string;
  toMonth: string;
  sellerId: string;
  customer: string;
  orderCode: string;
  section: Commission360Section;
  crStatus: string;
  page: number;
  pageSize?: number;
}): string {
  const params = new URLSearchParams();
  if (input.fromMonth) params.set("from", input.fromMonth);
  if (input.toMonth) params.set("to", input.toMonth);
  if (input.sellerId && input.sellerId !== "all") params.set("sellerId", input.sellerId);
  if (input.customer.trim()) params.set("customer", input.customer.trim());
  if (input.orderCode.trim()) params.set("orderCode", input.orderCode.trim());
  params.set("section", input.section);
  if (input.crStatus && input.crStatus !== "all") params.set("crStatus", input.crStatus);
  params.set("page", String(Math.max(1, input.page)));
  params.set("pageSize", String(input.pageSize ?? 50));
  return params.toString();
}
