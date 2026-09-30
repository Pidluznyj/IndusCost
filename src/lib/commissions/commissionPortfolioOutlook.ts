/**
 * Projeção de leitura: fluxo de comissão do vendedor.
 *
 * A comissão nasce no snapshot da venda e já está rateada em
 * CommissionReceivableSchedule.scheduledCommissionAmount. Este módulo não
 * recalcula o percentual comercial, não grava cobertura, fechamento nem pagamento.
 *
 * Competência do realizado: receiptDate.
 * Competência do previsto: dueDate da parte ainda não recebida.
 * settlementDate não entra.
 *
 * Comissão futura = parte da comissão do CR vinculada ao saldo AINDA EM ABERTO
 * do título na origem (balanceReceivable), nunca acima do que os eventos de
 * recebimento deixam por realizar. Evento de recebimento faltando, desconto ou
 * baixa sem recebimento não viram comissão a receber.
 */
import {
  computeCommissionReleasedFromReceivablePrincipal,
  formatBrl,
  roundMoney,
} from "./commission-money.shared.js";
import {
  COMMISSION_PORTFOLIO_OUTLOOK_START_YEAR_MONTH,
  formatCommissionYearMonthKey,
  formatCommissionYearMonthLongLabel,
} from "./commissionCoverageCutover.js";
import { isCommissionSnapshotActive } from "./commissionScheduleVigency.js";

export const COMMISSION_PORTFOLIO_OUTLOOK_NOTE =
  "Mostra quanto de comissão ainda falta receber sobre os títulos em aberto. " +
  "A comissão continua a do pedido, rateada pelo CR; o que falta segue o saldo do título e o mês do vencimento. " +
  "Esta consulta não fecha mês, não cobre recebimento e não paga o vendedor.";

/** Primeiro mês (`YYYY-MM`) da previsão. Antes dele, vale o relatório do Nomus. */
export const COMMISSION_PORTFOLIO_OUTLOOK_FIRST_MONTH = formatCommissionYearMonthKey(
  COMMISSION_PORTFOLIO_OUTLOOK_START_YEAR_MONTH
);

export const COMMISSION_PORTFOLIO_OUTLOOK_HISTORY_NOTE =
  `A previsão mostra de ${formatCommissionYearMonthLongLabel(COMMISSION_PORTFOLIO_OUTLOOK_START_YEAR_MONTH)} ` +
  "em diante. Para meses anteriores, consulte os relatórios de comissão do Nomus.";

/** Início do período: vazio, inválido ou anterior ao primeiro mês vira o primeiro mês. */
export function clampOutlookFromMonth(value: string | null | undefined): string {
  const month = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}$/.test(month) && month > COMMISSION_PORTFOLIO_OUTLOOK_FIRST_MONTH
    ? month
    : COMMISSION_PORTFOLIO_OUTLOOK_FIRST_MONTH;
}

export type OutlookCoverageSource = "NOMUS_LEGACY" | "INDUSCOST_CLOSING" | "MANUAL_ADJUSTMENT";

export type OutlookReceiptInput = {
  externalId: number;
  receiptDate: string;
  receivedAmount: number;
  coverageSource: OutlookCoverageSource | null;
  coveredCommissionAmount: number | null;
};

export type OutlookScheduleInput = {
  scheduleId: string;
  scheduleStatus: string;
  /**
   * Status do CommissionOrderSnapshot pai. Só ACTIVE é a versão vigente do pedido
   * (regra de commissionScheduleVigency): schedule de versão substituída não conta.
   */
  orderSnapshotStatus: string | null;
  /** createdAt do schedule (ISO). Desempata quando o título tem mais de um schedule vigente. */
  scheduleCreatedAt?: string | null;
  /**
   * Cancelamento COMPROVADO do título. O booleano `status` do Nomus não é esse
   * sinal (indica baixa: false = em aberto); o loader não o usa para cancelar.
   */
  titleCancelled?: boolean;
  /** Cobrança suspensa na origem: fora do fechamento oficial. */
  titleSuspended?: boolean;
  /**
   * Cliente com regra ativa em Exceções por cliente na data da venda, mesmo que o
   * schedule tenha sido materializado antes da regra (o fechamento aplica a regra viva).
   */
  customerExcludedByActiveRule?: boolean;
  /** Título de empresa do grupo: fora da comissão, como no fechamento. */
  groupCompany?: boolean;
  salesOrderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  sellerResolutionStatus: string | null;
  nfeNumber: string | null;
  receivableId: number;
  receivableCode: string | null;
  installmentNumber: number;
  dueDate: string | null;
  /** Valor nominal comissionável do CR (não inclui juros). */
  nominalAmount: number;
  /** Comissão já rateada para este CR. */
  allocatedCommission: number;
  sharePercent: number;
  /** Saldo em aberto do CR na origem. null = título não encontrado. */
  balanceReceivable: number | null;
  /** amountReceived do título. Não substitui eventos de recebimento. */
  amountReceivedOnTitle: number | null;
  /** Pagamento ao vendedor já liquidado (lote PAID) neste CR. */
  paidToSellerAmount: number;
  receipts: OutlookReceiptInput[];
};

/** Dados do título na origem usados pela previsão e pela auditoria read-only. */
export type OutlookTitleFacts = {
  dueDate: string | null;
  /** Saldo em aberto oficial; null = título fora do universo operacional (não encontrado ou removido na origem). */
  balance: number | null;
  /** balanceReceivable como veio da origem, sem tratamento (auditoria). */
  balanceRaw: number | null;
  amountReceivable: number | null;
  amountReceived: number | null;
  invoiceNumber: string | null;
  settlementDate: string | null;
  cancelled: boolean;
  /** `contasReceber.status` como veio do Nomus (true = baixado, false = em aberto). Só auditoria. */
  nomusStatus?: boolean | null;
  suspended: boolean;
  sourcePresenceStatus: string | null;
  /** Sacado é empresa do grupo (fora da comissão). */
  groupCompany?: boolean;
};

export type OutlookQuery = {
  fromMonth: string | null;
  toMonth: string | null;
  canonicalSellerId: string | null;
  customerId: string | null;
  orderCode: string | null;
  status: string | null;
  page: number;
  pageSize: number;
  /** Escopo próprio do vendedor logado. null = visão global. */
  ownNomusSellerId: number | null;
  sellerLocked: boolean;
};

export type OutlookReceiptEvent = {
  externalId: number;
  receiptDate: string;
  month: string;
  receivedAmount: number;
  eligibleAmount: number;
  excessAmount: number;
  realizedCommission: number;
  releasedCommission: number;
  paidCommission: number;
  coverageSource: OutlookCoverageSource | null;
};

export type OutlookLineStatus =
  | "PREVISTA"
  | "PARCIALMENTE_RECEBIDA"
  | "REALIZADA"
  | "LIBERADA"
  | "PAGA"
  | "VENCIDA_NAO_RECEBIDA"
  | "CUSTOMER_EXCLUDED"
  | "SEM_VENDEDOR"
  | "CANCELADA"
  | "INCONSISTENCIA_SEM_RECEBIMENTO"
  | "TITULO_NAO_ENCONTRADO";

export type OutlookLine = {
  scheduleId: string;
  salesOrderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  nfeNumber: string | null;
  receivableId: number;
  receivableCode: string | null;
  installmentNumber: number;
  dueDate: string | null;
  dueMonth: string | null;
  nominalAmount: number;
  balanceReceivable: number | null;
  /** Saldo em aberto limitado ao nominal (juros não contam). null = título não encontrado. */
  openPrincipal: number | null;
  eligibleReceived: number;
  allocatedCommission: number;
  sharePercent: number;
  realizedCommission: number;
  /** Comissão futura: vinculada ao saldo ainda em aberto do título. */
  forecastCommission: number;
  /**
   * Comissão que não é futura (o título não tem saldo que a sustente) nem
   * realizada (não há evento de recebimento): desconto, baixa sem recebimento,
   * evento faltando ou título não encontrado. Fica fora dos totais.
   */
  unreconciledCommission: number;
  releasedCommission: number;
  paidCommission: number;
  balanceToPay: number;
  awaitingClosing: number;
  status: OutlookLineStatus;
  daysOverdue: number | null;
  inconsistency: string | null;
  receipts: OutlookReceiptEvent[];
};

/** Realizado (já aconteceu) e previsto (ainda a receber) nunca são somados: são universos diferentes. */
export type OutlookMonth = {
  month: string;
  label: string;
  kind: "past" | "current" | "future";
  realized: number;
  forecast: number;
  released: number;
  paid: number;
  balanceToPay: number;
};

export type OutlookCards = {
  /** Histórico: comissão dos recebimentos do período. Já aconteceu. */
  realized: number;
  /** Comissão ainda a receber: vinculada ao saldo dos CRs em aberto. */
  forecast: number;
  released: number;
  paid: number;
  /** Liberada e ainda não paga ao vendedor. */
  balanceToPay: number;
  /** Realizada aguardando fechamento. */
  awaitingClosing: number;
  /** Parte do `forecast` cujo título já venceu. */
  overdueForecast: number;
  /** Comissão fora da previsão por falta de saldo em aberto e de evento de recebimento. */
  unreconciled: number;
};

export type OutlookPayload = {
  note: string;
  today: string;
  cards: OutlookCards;
  months: OutlookMonth[];
  lines: OutlookLine[];
  page: number;
  pageSize: number;
  totalLines: number;
  sellerLocked: boolean;
};

const MONTH_LABELS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export function outlookMonthLabel(month: string): string {
  const [year, mon] = month.split("-");
  const index = Number(mon) - 1;
  const name = MONTH_LABELS[index] ?? mon;
  return `${name}/${(year ?? "").slice(2)}`;
}

function monthOf(date: string | null): string | null {
  if (!date || date.length < 7) return null;
  return date.slice(0, 7);
}

function compareDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function civilDayDiff(later: string, earlier: string): number {
  const a = Date.parse(`${later}T00:00:00Z`);
  const b = Date.parse(`${earlier}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((a - b) / 86_400_000);
}

function inMonthRange(month: string, from: string | null, to: string | null): boolean {
  if (from && month < from) return false;
  if (to && month > to) return false;
  return true;
}

function economicStatus(input: {
  scheduleStatus: string;
  voided: boolean;
  customerExcluded: boolean;
  titleMissing: boolean;
  sellerMissing: boolean;
  inconsistency: boolean;
  allocated: number;
  realized: number;
  forecast: number;
  released: number;
  paid: number;
  overdue: boolean;
}): OutlookLineStatus {
  if (input.voided) return "CANCELADA";
  if (input.customerExcluded || input.scheduleStatus === "CUSTOMER_EXCLUDED") return "CUSTOMER_EXCLUDED";
  if (
    input.scheduleStatus === "SUPERSEDED" ||
    input.scheduleStatus === "STALE" ||
    input.scheduleStatus === "ORPHAN" ||
    input.scheduleStatus === "CANCELLED"
  ) {
    return "CANCELADA";
  }
  if (input.sellerMissing) return "SEM_VENDEDOR";
  if (input.inconsistency) return "INCONSISTENCIA_SEM_RECEBIMENTO";
  if (input.titleMissing && input.realized <= 0) return "TITULO_NAO_ENCONTRADO";
  if (input.allocated <= 0 && input.realized <= 0) return "PREVISTA";
  if (input.realized > 0 && input.forecast <= 0 && input.paid + 0.001 >= input.realized) return "PAGA";
  if (input.realized > 0 && input.forecast <= 0 && input.released + 0.001 >= input.realized && input.paid + 0.001 < input.realized) {
    return "LIBERADA";
  }
  if (input.realized > 0 && input.forecast <= 0) return "REALIZADA";
  if (input.realized > 0 && input.forecast > 0) return "PARCIALMENTE_RECEBIDA";
  if (input.overdue && input.forecast > 0) return "VENCIDA_NAO_RECEBIDA";
  return "PREVISTA";
}

const VOID_SUPERSEDED_SNAPSHOT =
  "Schedule de uma versão substituída do pedido. Só a versão vigente conta, como no fechamento.";
const VOID_DUPLICATE_SCHEDULE =
  "O título tem mais de um schedule vigente. Vale o mais recente, o mesmo que o fechamento escolhe.";
const VOID_TITLE_CANCELLED = "Título cancelado na origem. Fica fora do fechamento e não gera comissão a receber.";
const VOID_TITLE_SUSPENDED =
  "Título com cobrança suspensa na origem. Fica fora do fechamento e não gera comissão a receber.";

/**
 * Schedules que não podem contar, com o motivo. Espelha a seleção do fechamento
 * (keepSchedulesFromActiveSnapshot + pickMaterializedScheduleForReceivable):
 * uma comissão por título, sempre da versão vigente do pedido, e título
 * cancelado ou suspenso fora.
 */
function resolveVoidReasons(facts: readonly OutlookScheduleInput[]): Map<string, string> {
  const reasons = new Map<string, string>();
  const currentByReceivable = new Map<number, OutlookScheduleInput[]>();
  for (const fact of facts) {
    if (!isCommissionSnapshotActive(fact.orderSnapshotStatus)) {
      reasons.set(fact.scheduleId, VOID_SUPERSEDED_SNAPSHOT);
      continue;
    }
    if (fact.titleCancelled) reasons.set(fact.scheduleId, VOID_TITLE_CANCELLED);
    else if (fact.titleSuspended) reasons.set(fact.scheduleId, VOID_TITLE_SUSPENDED);
    const list = currentByReceivable.get(fact.receivableId) ?? [];
    list.push(fact);
    currentByReceivable.set(fact.receivableId, list);
  }
  for (const list of currentByReceivable.values()) {
    if (list.length < 2) continue;
    // Mesma ordem do motor: mais recente primeiro; ACTIVE vence os demais desfechos.
    const ordered = [...list].sort(
      (a, b) =>
        compareDate(b.scheduleCreatedAt ?? "", a.scheduleCreatedAt ?? "") || compareDate(a.scheduleId, b.scheduleId)
    );
    const winner = ordered.find((row) => row.scheduleStatus === "ACTIVE") ?? ordered[0]!;
    for (const row of ordered) {
      if (row !== winner && !reasons.has(row.scheduleId)) reasons.set(row.scheduleId, VOID_DUPLICATE_SCHEDULE);
    }
  }
  return reasons;
}

function projectSchedule(fact: OutlookScheduleInput, today: string, voidReason: string | null): OutlookLine {
  const nominal = roundMoney(Math.max(0, fact.nominalAmount));
  const storedAllocated = roundMoney(Math.max(0, fact.allocatedCommission));
  const customerExcluded = fact.customerExcludedByActiveRule === true || fact.groupCompany === true;
  const excluded =
    voidReason != null ||
    customerExcluded ||
    fact.scheduleStatus === "CUSTOMER_EXCLUDED" ||
    fact.scheduleStatus === "SUPERSEDED" ||
    fact.scheduleStatus === "STALE" ||
    fact.scheduleStatus === "ORPHAN" ||
    fact.scheduleStatus === "CANCELLED";
  const sellerMissing =
    !excluded &&
    (fact.sellerResolutionStatus === "NO_SELLER" ||
      fact.sellerResolutionStatus === "SELLER_UNRESOLVED" ||
      (fact.canonicalSellerId == null && fact.rawSellerId == null));
  const allocated = excluded || sellerMissing ? 0 : storedAllocated;

  const seen = new Set<number>();
  const receipts = [...fact.receipts]
    .filter((row) => {
      if (seen.has(row.externalId)) return false;
      seen.add(row.externalId);
      return true;
    })
    .sort((a, b) => compareDate(a.receiptDate, b.receiptDate) || a.externalId - b.externalId);

  // Saldo oficial do título, limitado ao nominal: juros e multa no saldo não aumentam a comissão.
  const titleFound = fact.balanceReceivable != null;
  const openPrincipal = titleFound
    ? roundMoney(Math.min(nominal, Math.max(0, fact.balanceReceivable ?? 0)))
    : null;

  // Título sem saldo e sem nenhum evento de recebimento: baixado/cancelado na origem.
  const settledWithoutReceipt = receipts.length === 0 && titleFound && openPrincipal === 0 && nominal > 0;

  let eligibleUsed = 0;
  const drafted = receipts.map((row) => {
    const room = roundMoney(nominal - eligibleUsed);
    const gross = roundMoney(Math.max(0, row.receivedAmount));
    const eligible = settledWithoutReceipt ? 0 : roundMoney(Math.min(gross, Math.max(0, room)));
    eligibleUsed = roundMoney(eligibleUsed + eligible);
    return {
      row,
      eligible,
      excess: roundMoney(Math.max(0, gross - eligible)),
    };
  });

  const realizedTarget =
    nominal > 0 ? roundMoney((allocated * eligibleUsed) / nominal) : 0;
  const realizedCap = roundMoney(Math.min(allocated, realizedTarget));
  let assigned = 0;
  let lastEligible = -1;
  drafted.forEach((row, index) => {
    if (row.eligible > 0) lastEligible = index;
  });

  const events: OutlookReceiptEvent[] = drafted.map((row, index) => {
    let realized = 0;
    if (!settledWithoutReceipt && row.eligible > 0 && nominal > 0) {
      if (index === lastEligible) {
        realized = roundMoney(realizedCap - assigned);
      } else {
        realized = roundMoney((allocated * row.eligible) / nominal);
        assigned = roundMoney(assigned + realized);
      }
    }
    const covered = row.row.coverageSource != null;
    const released = covered ? realized : 0;
    const legacyPaid =
      row.row.coverageSource === "NOMUS_LEGACY" || row.row.coverageSource === "MANUAL_ADJUSTMENT"
        ? roundMoney(row.row.coveredCommissionAmount ?? realized)
        : 0;
    return {
      externalId: row.row.externalId,
      receiptDate: row.row.receiptDate,
      month: monthOf(row.row.receiptDate) ?? "",
      receivedAmount: roundMoney(Math.max(0, row.row.receivedAmount)),
      eligibleAmount: row.eligible,
      excessAmount: row.excess,
      realizedCommission: realized,
      releasedCommission: released,
      paidCommission: roundMoney(Math.min(legacyPaid, realized)),
      coverageSource: row.row.coverageSource,
    };
  });

  const realized = settledWithoutReceipt
    ? 0
    : roundMoney(events.reduce((sum, row) => sum + row.realizedCommission, 0));
  // O que os eventos de recebimento deixam por realizar é só o teto. O futuro é a
  // parte da comissão proporcional ao saldo ainda em aberto (mesma regra canônica
  // de proporção pelo principal usada na liberação).
  const remainingByReceipts = roundMoney(Math.max(0, allocated - realized));
  const futureByBalance =
    openPrincipal == null
      ? 0
      : computeCommissionReleasedFromReceivablePrincipal({
          commissionExpectedAmount: allocated,
          receivableOriginalAmount: nominal,
          receivedAmount: openPrincipal,
        });
  const forecast = roundMoney(Math.min(remainingByReceipts, futureByBalance));
  // Sobra de centavo do rateio não é divergência.
  const gap = roundMoney(remainingByReceipts - forecast);
  const unreconciled = gap > 0.01 ? gap : 0;
  const inconsistency = voidReason
    ? voidReason
    : fact.groupCompany
    ? "Empresa do grupo: fora da comissão, como no fechamento."
    : fact.customerExcludedByActiveRule
    ? "Cliente com regra ativa em Exceções por cliente: sem comissão, como no fechamento."
    : excluded || sellerMissing
    ? null
    : settledWithoutReceipt
    ? "Título baixado na origem sem evento de recebimento. A previsão não inventa receiptDate nem comissão futura."
    : !titleFound && unreconciled > 0
      ? "Título não encontrado no contas a receber sincronizado. Sem saldo oficial não há comissão futura."
      : unreconciled > 0
        ? `Saldo em aberto do título (${formatBrl(openPrincipal ?? 0)}) menor que o que falta pelos eventos de recebimento ` +
          `(${formatBrl(roundMoney(nominal - eligibleUsed))}). ${formatBrl(unreconciled)} de comissão ficam fora da previsão: ` +
          "desconto, abatimento ou recebimento sem evento sincronizado."
        : null;
  const releasedFromReceipts = roundMoney(
    events.reduce((sum, row) => sum + row.releasedCommission, 0)
  );
  const legacyPaid = roundMoney(events.reduce((sum, row) => sum + row.paidCommission, 0));
  const batchPaid = roundMoney(Math.max(0, fact.paidToSellerAmount));
  const released = roundMoney(Math.min(realized, Math.max(releasedFromReceipts, Math.min(batchPaid, realized))));
  const paid = roundMoney(Math.min(realized, legacyPaid + batchPaid));
  const balanceToPay = roundMoney(Math.max(0, released - Math.min(paid, released)));
  const awaitingClosing = roundMoney(Math.max(0, realized - released));
  const dueMonth = monthOf(fact.dueDate);
  const overdue = Boolean(fact.dueDate && fact.dueDate < today && forecast > 0);
  const status = economicStatus({
    scheduleStatus: fact.scheduleStatus,
    voided: voidReason != null,
    customerExcluded,
    titleMissing: !titleFound,
    sellerMissing,
    inconsistency: settledWithoutReceipt,
    allocated,
    realized,
    forecast,
    released,
    paid,
    overdue,
  });

  return {
    scheduleId: fact.scheduleId,
    salesOrderId: fact.salesOrderId,
    orderCode: fact.orderCode,
    customerId: fact.customerId,
    customerName: fact.customerName,
    canonicalSellerId: fact.canonicalSellerId,
    canonicalSellerName: fact.canonicalSellerName,
    rawSellerId: fact.rawSellerId,
    nfeNumber: fact.nfeNumber,
    receivableId: fact.receivableId,
    receivableCode: fact.receivableCode,
    installmentNumber: fact.installmentNumber,
    dueDate: fact.dueDate,
    dueMonth,
    nominalAmount: nominal,
    balanceReceivable: fact.balanceReceivable,
    openPrincipal,
    eligibleReceived: settledWithoutReceipt ? 0 : eligibleUsed,
    allocatedCommission: allocated,
    sharePercent: fact.sharePercent,
    realizedCommission: realized,
    forecastCommission: forecast,
    unreconciledCommission: unreconciled,
    releasedCommission: released,
    paidCommission: roundMoney(Math.min(paid, realized)),
    balanceToPay,
    awaitingClosing,
    status,
    daysOverdue: overdue && fact.dueDate ? civilDayDiff(today, fact.dueDate) : null,
    inconsistency,
    receipts: events,
  };
}

function lineVisible(line: OutlookLine, query: OutlookQuery): boolean {
  if (query.ownNomusSellerId != null && line.rawSellerId !== query.ownNomusSellerId) return false;
  if (query.canonicalSellerId && line.canonicalSellerId !== query.canonicalSellerId) return false;
  if (query.customerId && line.customerId !== query.customerId) return false;
  if (query.orderCode && !line.orderCode.toLowerCase().includes(query.orderCode.toLowerCase())) return false;
  if (query.status && line.status !== query.status) return false;
  if (!query.fromMonth && !query.toMonth) return true;
  const months = new Set<string>();
  for (const receipt of line.receipts) {
    if (receipt.month) months.add(receipt.month);
  }
  if (line.forecastCommission > 0 && line.dueMonth) months.add(line.dueMonth);
  // Sem recebimento nem previsto (sem vendedor, cliente excluído, cancelada, baixa
  // sem recebimento): o vencimento situa a linha no período.
  if (months.size === 0 && line.dueMonth) months.add(line.dueMonth);
  if (months.size === 0) return false;
  for (const month of months) {
    if (inMonthRange(month, query.fromMonth, query.toMonth)) return true;
  }
  return false;
}

function monthKind(month: string, todayMonth: string): OutlookMonth["kind"] {
  if (month < todayMonth) return "past";
  if (month > todayMonth) return "future";
  return "current";
}

/** Todas as linhas projetadas, sem filtro nem paginação (tela e auditoria usam a mesma regra). */
export function projectCommissionPortfolioOutlookLines(
  facts: readonly OutlookScheduleInput[],
  today: string
): OutlookLine[] {
  const voidReasons = resolveVoidReasons(facts);
  return facts.map((fact) => projectSchedule(fact, today, voidReasons.get(fact.scheduleId) ?? null));
}

export function buildCommissionPortfolioOutlook(
  facts: readonly OutlookScheduleInput[],
  query: OutlookQuery,
  today: string
): OutlookPayload {
  const projected = projectCommissionPortfolioOutlookLines(facts, today).filter((line) => lineVisible(line, query));
  const from = query.fromMonth;
  const to = query.toMonth;

  const cards: OutlookCards = {
    realized: 0,
    forecast: 0,
    released: 0,
    paid: 0,
    balanceToPay: 0,
    awaitingClosing: 0,
    overdueForecast: 0,
    unreconciled: 0,
  };
  const monthMap = new Map<string, OutlookMonth>();

  const touch = (month: string) => {
    const current = monthMap.get(month);
    if (current) return current;
    const created: OutlookMonth = {
      month,
      label: outlookMonthLabel(month),
      kind: monthKind(month, today.slice(0, 7)),
      realized: 0,
      forecast: 0,
      released: 0,
      paid: 0,
      balanceToPay: 0,
    };
    monthMap.set(month, created);
    return created;
  };

  for (const line of projected) {
    let lastPaidMonth: string | null = null;
    let awaitingInPeriod = 0;
    for (const receipt of line.receipts) {
      if (!receipt.month || !inMonthRange(receipt.month, from, to)) continue;
      const bucket = touch(receipt.month);
      bucket.realized = roundMoney(bucket.realized + receipt.realizedCommission);
      bucket.released = roundMoney(bucket.released + receipt.releasedCommission);
      bucket.paid = roundMoney(bucket.paid + receipt.paidCommission);
      cards.realized = roundMoney(cards.realized + receipt.realizedCommission);
      cards.released = roundMoney(cards.released + receipt.releasedCommission);
      cards.paid = roundMoney(cards.paid + receipt.paidCommission);
      awaitingInPeriod = roundMoney(
        awaitingInPeriod + Math.max(0, receipt.realizedCommission - receipt.releasedCommission)
      );
      lastPaidMonth = receipt.month;
    }
    const paidOnReceipts = roundMoney(
      line.receipts.reduce((sum, receipt) => sum + receipt.paidCommission, 0)
    );
    const batchPaid = roundMoney(Math.max(0, line.paidCommission - paidOnReceipts));
    if (batchPaid > 0 && lastPaidMonth) {
      const bucket = touch(lastPaidMonth);
      bucket.paid = roundMoney(bucket.paid + batchPaid);
      cards.paid = roundMoney(cards.paid + batchPaid);
    }
    if (line.forecastCommission > 0 && line.dueMonth && inMonthRange(line.dueMonth, from, to)) {
      const bucket = touch(line.dueMonth);
      bucket.forecast = roundMoney(bucket.forecast + line.forecastCommission);
      cards.forecast = roundMoney(cards.forecast + line.forecastCommission);
      if (line.daysOverdue != null) {
        cards.overdueForecast = roundMoney(cards.overdueForecast + line.forecastCommission);
      }
    }
    if (line.unreconciledCommission > 0 && line.dueMonth && inMonthRange(line.dueMonth, from, to)) {
      cards.unreconciled = roundMoney(cards.unreconciled + line.unreconciledCommission);
    }
    // Só o realizado de recebimentos do período: um recebimento fora do filtro
    // (ex.: antes do primeiro mês da previsão) não entra, mesmo com a linha visível.
    cards.awaitingClosing = roundMoney(
      cards.awaitingClosing + Math.min(line.awaitingClosing, awaitingInPeriod)
    );
  }

  cards.balanceToPay = roundMoney(Math.max(0, cards.released - cards.paid));

  const months = [...monthMap.values()]
    .sort((a, b) => compareDate(a.month, b.month))
    .map((row) => ({
      ...row,
      balanceToPay: roundMoney(Math.max(0, row.released - row.paid)),
    }));

  const pageSize = Math.min(100, Math.max(1, query.pageSize || 25));
  const page = Math.max(1, query.page || 1);
  const start = (page - 1) * pageSize;

  return {
    note: COMMISSION_PORTFOLIO_OUTLOOK_NOTE,
    today,
    cards,
    months,
    lines: projected.slice(start, start + pageSize),
    page,
    pageSize,
    totalLines: projected.length,
    sellerLocked: query.sellerLocked || query.ownNomusSellerId != null,
  };
}

export function outlookInvariantsHold(line: OutlookLine): boolean {
  if (line.realizedCommission < 0 || line.forecastCommission < 0 || line.unreconciledCommission < 0) return false;
  if (line.forecastCommission > roundMoney(line.allocatedCommission + 0.001)) return false;
  if (
    roundMoney(line.realizedCommission + line.forecastCommission + line.unreconciledCommission) >
    roundMoney(line.allocatedCommission + 0.011)
  ) {
    return false;
  }
  // Sem saldo em aberto na origem não existe comissão futura.
  if (line.forecastCommission > 0 && !(line.openPrincipal != null && line.openPrincipal > 0)) return false;
  if (line.eligibleReceived > roundMoney(line.nominalAmount + 0.001)) return false;
  if (line.paidCommission > roundMoney(line.realizedCommission + 0.001)) return false;
  const ids = line.receipts.map((row) => row.externalId);
  if (new Set(ids).size !== ids.length) return false;
  return true;
}
