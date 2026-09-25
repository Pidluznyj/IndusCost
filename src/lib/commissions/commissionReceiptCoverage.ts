/**
 * Cobertura de comissão — regras puras do lado do servidor (dependem do motor).
 *
 *   - pendência de período anterior = linha do MESMO motor avaliada na competência
 *     natural, restrita aos eventos ainda não cobertos (sem motor paralelo);
 *   - ao entrar num fechamento, year/month = fechamento e natural* = competência
 *     original (o receiptDate nunca muda);
 *   - a cobertura INDUSCOST_CLOSING nasce na mesma transação do ledger CLOSED.
 */
import { roundMoney } from "./commission-money.js";
import {
  aggregateCommissionReceiptPreview,
  type CommissionReceiptPreviewLine,
  type CommissionReceiptPreviewResult,
} from "./commissionReceiptEngine.js";
import { buildCommissionReceiptLedgerLineKey } from "./commissionReceiptLedger.js";
import {
  formatCommissionYearMonthKey,
  formatCommissionYearMonthLabel,
  resolveReceiptNaturalYearMonth,
  type CommissionYearMonth,
} from "./commissionCoverageCutover.js";
import {
  assessCarryoverRowInclusion,
  isCoverageFinalLineStatus,
  isNotCommissionableLineStatus,
  type CommissionCoverageState,
  type CommissionLedgerInclusionType,
  type ReceiptClosingCarryoverRow,
} from "./commissionReceiptCoverage.shared.js";

export type CarryoverInclusionType = Extract<
  CommissionLedgerInclusionType,
  "LATE_CARRYOVER" | "LEGACY_CARRYOVER"
>;

export function inclusionTypeForCoverageState(state: CommissionCoverageState): CarryoverInclusionType {
  return state === "POST_CUTOVER_PENDING" ? "LATE_CARRYOVER" : "LEGACY_CARRYOVER";
}

/**
 * Linha do motor (avaliada na competência natural) → linha do fechamento atual.
 * Chave nova com o discriminador de pendência: nunca colide com a linha normal do
 * mesmo título no mesmo fechamento. Valores, status e receiptDate intactos.
 */
export function toCarryoverPreviewLine(
  line: CommissionReceiptPreviewLine,
  closing: CommissionYearMonth,
  inclusionType: CarryoverInclusionType
): CommissionReceiptPreviewLine {
  const naturalYear = line.naturalYear ?? line.year;
  const naturalMonth = line.naturalMonth ?? line.month;
  return {
    ...line,
    year: closing.year,
    month: closing.month,
    naturalYear,
    naturalMonth,
    inclusionType,
    ledgerLineKey: buildCommissionReceiptLedgerLineKey({
      year: closing.year,
      month: closing.month,
      nomusReceivableId: line.nomusReceivableId,
      commissionRecordId: line.commissionRecordId,
      commissionPaymentScheduleId: line.commissionPaymentScheduleId,
      commissionReceivableScheduleId: line.commissionReceivableScheduleId,
      installmentNumber: line.installmentNumber,
      nomusOrderItemId: line.nomusOrderItemId,
      ruleId: line.ruleId,
      carryover: { naturalYear, naturalMonth, inclusionType },
    }),
  };
}

export type CarryoverCandidateEvent = {
  receiptExternalId: number;
  receivableExternalId: number;
  /** Dia civil `YYYY-MM-DD`. */
  receiptDate: string;
  receivedAmount: number;
  syncedAt: Date | null;
  state: CommissionCoverageState;
};

const STATE_SEVERITY: Record<CommissionCoverageState, number> = {
  AMBIGUOUS: 3,
  LEGACY_PENDING_CANDIDATE: 2,
  POST_CUTOVER_PENDING: 1,
  LEGACY_OUTSIDE_RECONCILIATION_WINDOW: 0,
  LEGACY_COVERED: 0,
  LEGACY_UNMATCHED: 0,
  INDUSCOST_COVERED: 0,
};

function describePostCutoverSituation(
  events: CarryoverCandidateEvent[],
  naturalClosing: { closedAt: string | null } | null,
  natural: CommissionYearMonth
): string {
  if (!naturalClosing) {
    return `Pendência de período anterior (${formatCommissionYearMonthLabel(natural)} sem fechamento)`;
  }
  const closedAt = naturalClosing.closedAt ? Date.parse(naturalClosing.closedAt) : Number.NaN;
  const syncedAfter = events.some(
    (event) => event.syncedAt != null && Number.isFinite(closedAt) && event.syncedAt.getTime() > closedAt
  );
  return syncedAfter
    ? "Recebimento sincronizado após fechamento"
    : `Não contemplado no fechamento de ${formatCommissionYearMonthLabel(natural)}`;
}

/**
 * Linhas do grid "Pendências de períodos anteriores": uma por título e competência
 * natural, a partir das linhas do motor. Não comissionável por regra (exclusão,
 * grupo, sem vínculo de venda, comissão zero) não é pendência e fica de fora.
 */
export function buildCarryoverRows(input: {
  candidates: readonly CarryoverCandidateEvent[];
  /** Linhas do motor por competência natural (`AAAA-MM`). */
  linesByNaturalMonth: ReadonlyMap<string, readonly CommissionReceiptPreviewLine[]>;
  /** Fechamento CLOSED da competência natural, quando existe. */
  naturalMonthClosings: ReadonlyMap<string, { closedAt: string | null }>;
  missingLegacyImports: (natural: CommissionYearMonth) => CommissionYearMonth[];
  selectedReceiptIds: ReadonlySet<number>;
  statusLabel: (status: string) => string;
}): ReceiptClosingCarryoverRow[] {
  const eventsByKey = new Map<string, CarryoverCandidateEvent[]>();
  for (const event of input.candidates) {
    const natural = resolveReceiptNaturalYearMonth(event.receiptDate);
    if (!natural) continue;
    const key = `${event.receivableExternalId}|${formatCommissionYearMonthKey(natural)}`;
    const list = eventsByKey.get(key) ?? [];
    list.push(event);
    eventsByKey.set(key, list);
  }

  const rows: ReceiptClosingCarryoverRow[] = [];
  for (const [monthKey, lines] of input.linesByNaturalMonth) {
    const natural: CommissionYearMonth = {
      year: Number(monthKey.slice(0, 4)),
      month: Number(monthKey.slice(5, 7)),
    };
    const byReceivable = new Map<number, CommissionReceiptPreviewLine[]>();
    for (const line of lines) {
      const list = byReceivable.get(line.nomusReceivableId) ?? [];
      list.push(line);
      byReceivable.set(line.nomusReceivableId, list);
    }
    for (const [receivableId, group] of byReceivable) {
      const events = eventsByKey.get(`${receivableId}|${monthKey}`) ?? [];
      if (events.length === 0) continue;
      const primary = group.find((line) => line.status === "COMMISSIONABLE") ?? group[0]!;
      if (isNotCommissionableLineStatus(primary.status)) continue;
      const state = events.reduce<CommissionCoverageState>(
        (worst, event) => (STATE_SEVERITY[event.state] > STATE_SEVERITY[worst] ? event.state : worst),
        events[0]!.state
      );
      const receiptExternalIds = [...new Set(events.map((event) => event.receiptExternalId))].sort(
        (a, b) => a - b
      );
      const receivedAmount = roundMoney(events.reduce((sum, event) => sum + event.receivedAmount, 0));
      const commissionAmount = roundMoney(
        group
          .filter((line) => line.status === "COMMISSIONABLE")
          .reduce((sum, line) => sum + line.releasedCommissionAmount, 0)
      );
      const commissionableBaseAmount = roundMoney(
        group
          .filter((line) => line.status === "COMMISSIONABLE")
          .reduce((sum, line) => sum + (line.commissionPrincipalAmount ?? line.commissionableBaseAmount), 0)
      );
      const missingLegacyImports =
        state === "LEGACY_PENDING_CANDIDATE" ? input.missingLegacyImports(natural) : [];
      const inclusion = assessCarryoverRowInclusion({
        state,
        lineStatus: primary.status,
        statusReason: primary.statusReason,
        commissionReceivableScheduleId: primary.commissionReceivableScheduleId,
        canonicalSellerId: primary.canonicalSellerId,
        sellerResolutionStatus: primary.sellerResolutionStatus,
        missingLegacyImports,
        statusLabel: input.statusLabel,
      });
      const situation =
        state === "POST_CUTOVER_PENDING"
          ? describePostCutoverSituation(events, input.naturalMonthClosings.get(monthKey) ?? null, natural)
          : state === "AMBIGUOUS"
            ? "Associação histórica ambígua"
            : "Não encontrado na cobertura Nomus";
      rows.push({
        rowKey: `${receivableId}|${monthKey}`,
        receivableExternalId: receivableId,
        receiptExternalIds,
        receiptDate: primary.receiptDate ?? events.map((event) => event.receiptDate).sort().at(-1) ?? null,
        naturalYear: natural.year,
        naturalMonth: natural.month,
        state,
        origin: state === "POST_CUTOVER_PENDING" ? "INDUSCOST" : "LEGACY_NOMUS",
        inclusionType: inclusionTypeForCoverageState(state),
        situation,
        includable: inclusion.includable,
        blockedReason: inclusion.blockedReason,
        selected:
          inclusion.includable && receiptExternalIds.every((id) => input.selectedReceiptIds.has(id)),
        nfeNumber: primary.nfeNumber,
        orderCode: primary.orderCode,
        customerName: primary.customerName,
        canonicalSellerId: primary.canonicalSellerId,
        canonicalSellerName: primary.canonicalSellerName,
        rawSellerId: primary.rawSellerId,
        rawSellerName: primary.rawSellerName,
        sellerResolutionStatus: primary.sellerResolutionStatus,
        installmentNumber: primary.installmentNumber,
        installmentTotal: null,
        receivedAmount,
        receivableOriginalAmount: Number.isFinite(primary.receivableAmount) ? primary.receivableAmount : null,
        commissionableBaseAmount,
        commissionAmount,
        lineStatus: primary.status,
        statusReason: primary.statusReason,
        commissionReceivableScheduleId: primary.commissionReceivableScheduleId,
      });
    }
  }
  rows.sort(
    (a, b) =>
      a.naturalYear - b.naturalYear ||
      a.naturalMonth - b.naturalMonth ||
      (a.nfeNumber ?? "").localeCompare(b.nfeNumber ?? "", "pt-BR", { numeric: true }) ||
      a.receivableExternalId - b.receivableExternalId
  );
  return rows;
}

function mergeCounts(
  a: Record<string, number>,
  b: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = (out[key] ?? 0) + value;
  return out;
}

/**
 * Prévia do fechamento = competência atual + pendências selecionadas. Totais somados
 * por componente (a pendência é outro evento do título: não pode ser deduplicada
 * contra a linha normal do mesmo CR).
 */
export function mergeCarryoverLinesIntoPreview(
  normal: CommissionReceiptPreviewResult,
  carryoverLines: readonly CommissionReceiptPreviewLine[]
): CommissionReceiptPreviewResult {
  if (carryoverLines.length === 0) return normal;
  const carryover = aggregateCommissionReceiptPreview(
    [...carryoverLines],
    { year: normal.year, month: normal.month },
    new Set(carryoverLines.map((line) => `${line.nomusReceivableId}|${line.naturalYear}-${line.naturalMonth}`)).size
  );
  const sellerKey = (row: { sellerId: string | null; sellerName: string | null }) =>
    row.sellerId ?? row.sellerName ?? "—";
  const bySeller = new Map(normal.bySeller.map((row) => [sellerKey(row), { ...row }]));
  for (const row of carryover.bySeller) {
    const current = bySeller.get(sellerKey(row));
    if (!current) {
      bySeller.set(sellerKey(row), { ...row });
      continue;
    }
    current.receivedAmount = roundMoney(current.receivedAmount + row.receivedAmount);
    current.commissionableBase = roundMoney(current.commissionableBase + row.commissionableBase);
    current.expectedCommission = roundMoney(current.expectedCommission + row.expectedCommission);
    current.releasedCommission = roundMoney(current.releasedCommission + row.releasedCommission);
    current.receivableCount += row.receivableCount;
  }
  const customerKey = (row: { customerExternalId: number | null; customerName: string | null }) =>
    String(row.customerExternalId ?? row.customerName ?? "—");
  const byCustomer = new Map(normal.byCustomer.map((row) => [customerKey(row), { ...row }]));
  for (const row of carryover.byCustomer) {
    const current = byCustomer.get(customerKey(row));
    if (!current) {
      byCustomer.set(customerKey(row), { ...row });
      continue;
    }
    current.receivedAmount = roundMoney(current.receivedAmount + row.receivedAmount);
    current.commissionableBase = roundMoney(current.commissionableBase + row.commissionableBase);
    current.expectedCommission = roundMoney(current.expectedCommission + row.expectedCommission);
    current.releasedCommission = roundMoney(current.releasedCommission + row.releasedCommission);
    current.receivableCount += row.receivableCount;
  }
  return {
    ...normal,
    totalReceivables: normal.totalReceivables + carryover.totalReceivables,
    totalReceivedAmount: roundMoney(normal.totalReceivedAmount + carryover.totalReceivedAmount),
    totalCommissionableBase: roundMoney(normal.totalCommissionableBase + carryover.totalCommissionableBase),
    totalExpectedCommission: roundMoney(normal.totalExpectedCommission + carryover.totalExpectedCommission),
    totalReleasedCommission: roundMoney(normal.totalReleasedCommission + carryover.totalReleasedCommission),
    totalExcludedAmount: roundMoney(normal.totalExcludedAmount + carryover.totalExcludedAmount),
    totalExceptionAmount: roundMoney(normal.totalExceptionAmount + carryover.totalExceptionAmount),
    countByStatus: mergeCounts(normal.countByStatus, carryover.countByStatus) as CommissionReceiptPreviewResult["countByStatus"],
    bySeller: [...bySeller.values()].sort((a, b) =>
      (a.sellerName ?? "").localeCompare(b.sellerName ?? "", "pt-BR")
    ),
    byCustomer: [...byCustomer.values()].sort((a, b) =>
      (a.customerName ?? "").localeCompare(b.customerName ?? "", "pt-BR")
    ),
    lines: [...normal.lines, ...carryoverLines],
  };
}

export type ReceiptEventForCoverage = {
  receivableExternalId: number;
  /** Dia civil `YYYY-MM-DD`. */
  receiptDate: string;
  receivedAmount: number;
};

export type InduscostCoverageRowInput = {
  receiptExternalId: number;
  receivableExternalId: number;
  coverageSource: "INDUSCOST_CLOSING";
  coverageStatus: "COVERED";
  naturalReceiptDate: string;
  naturalYear: number;
  naturalMonth: number;
  coveredYear: number;
  coveredMonth: number;
  closingId: string;
  ledgerLineId: string;
  coveredReceivedAmount: number;
  coveredCommissionAmount: number;
  associationMethod: "INDUSCOST_LEDGER";
  notes: string;
  createdBy: string;
};

/** Eventos que o fechamento contempla de forma final (cobrem pagamento). */
export function collectCoveredReceiptIdsFromLines(
  lines: ReadonlyArray<{ status: string; receiptIds?: number[] | null; receiptExternalIds?: number[] | null }>
): number[] {
  const ids = new Set<number>();
  for (const line of lines) {
    if (!isCoverageFinalLineStatus(line.status)) continue;
    for (const id of line.receiptExternalIds ?? line.receiptIds ?? []) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * Cobertura INDUSCOST_CLOSING de um fechamento: um registro por evento de
 * recebimento contemplado de forma final. A comissão do título na competência é
 * rateada entre os eventos pelo valor recebido (resto no último — soma exata).
 * Evento sem dados de recebimento aborta (nunca grava cobertura sem prova).
 */
export function buildInduscostCoverageRows(input: {
  closingId: string;
  closing: CommissionYearMonth;
  userId: string;
  ledgerRows: ReadonlyArray<{
    id: string;
    nomusReceivableId: number | null;
    receiptExternalIds: number[];
    status: string;
    releasedCommissionAmount: number;
    inclusionType: CommissionLedgerInclusionType;
  }>;
  receiptEvents: ReadonlyMap<number, ReceiptEventForCoverage>;
}): InduscostCoverageRowInput[] {
  type Group = {
    ledgerLineId: string;
    inclusionType: CommissionLedgerInclusionType;
    receiptIds: Set<number>;
    commission: number;
  };
  const groups = new Map<string, Group>();
  const claimed = new Set<number>();
  for (const row of input.ledgerRows) {
    if (!isCoverageFinalLineStatus(row.status)) continue;
    const ids = row.receiptExternalIds.filter((id) => !claimed.has(id));
    if (row.receiptExternalIds.length === 0) continue;
    const key = `${row.nomusReceivableId ?? "?"}|${[...row.receiptExternalIds].sort((a, b) => a - b).join(",")}`;
    const group =
      groups.get(key) ??
      ({ ledgerLineId: row.id, inclusionType: row.inclusionType, receiptIds: new Set<number>(), commission: 0 } satisfies Group);
    ids.forEach((id) => {
      group.receiptIds.add(id);
      claimed.add(id);
    });
    group.commission = roundMoney(group.commission + (row.status === "COMMISSIONABLE" ? row.releasedCommissionAmount : 0));
    groups.set(key, group);
  }

  const out: InduscostCoverageRowInput[] = [];
  for (const group of groups.values()) {
    const ids = [...group.receiptIds].sort((a, b) => a - b);
    const events = ids.map((id) => {
      const event = input.receiptEvents.get(id);
      if (!event) {
        throw new Error(
          `Recebimento ${id} sem dados de origem (NomusReceivableReceipt) — gere a prévia novamente antes de fechar.`
        );
      }
      return { id, event };
    });
    const totalReceived = events.reduce((sum, item) => sum + item.event.receivedAmount, 0);
    let allocated = 0;
    events.forEach(({ id, event }, index) => {
      const natural = resolveReceiptNaturalYearMonth(event.receiptDate);
      if (!natural) throw new Error(`Recebimento ${id} com data inválida.`);
      const isLast = index === events.length - 1;
      const share =
        isLast
          ? roundMoney(group.commission - allocated)
          : totalReceived > 0
            ? roundMoney((group.commission * event.receivedAmount) / totalReceived)
            : 0;
      allocated = roundMoney(allocated + share);
      out.push({
        receiptExternalId: id,
        receivableExternalId: event.receivableExternalId,
        coverageSource: "INDUSCOST_CLOSING",
        coverageStatus: "COVERED",
        naturalReceiptDate: event.receiptDate,
        naturalYear: natural.year,
        naturalMonth: natural.month,
        coveredYear: input.closing.year,
        coveredMonth: input.closing.month,
        closingId: input.closingId,
        ledgerLineId: group.ledgerLineId,
        coveredReceivedAmount: roundMoney(event.receivedAmount),
        coveredCommissionAmount: share,
        associationMethod: "INDUSCOST_LEDGER",
        notes: `Fechamento ${formatCommissionYearMonthLabel(input.closing)} (${group.inclusionType})`,
        createdBy: input.userId,
      });
    });
  }
  return out.sort((a, b) => a.receiptExternalId - b.receiptExternalId);
}

/**
 * Anti-duplicidade dentro do mesmo fechamento: um recebimento só pode pertencer a
 * uma "âncora" (título + tipo de inclusão + competência natural). Linhas de itens
 * do mesmo título compartilham os recebimentos — esperado; o mesmo recebimento em
 * duas âncoras (ex.: linha normal e pendência) não.
 */
export function findReceiptsInMultipleAnchors(
  lines: ReadonlyArray<
    Pick<
      CommissionReceiptPreviewLine,
      "nomusReceivableId" | "receiptIds" | "inclusionType" | "naturalYear" | "naturalMonth" | "year" | "month"
    >
  >
): number[] {
  const anchorByReceipt = new Map<number, string>();
  const duplicated = new Set<number>();
  for (const line of lines) {
    const anchor = `${line.nomusReceivableId}|${line.inclusionType ?? "NORMAL"}|${line.naturalYear ?? line.year}-${
      line.naturalMonth ?? line.month
    }`;
    for (const id of line.receiptIds ?? []) {
      const current = anchorByReceipt.get(id);
      if (current == null) anchorByReceipt.set(id, anchor);
      else if (current !== anchor) duplicated.add(id);
    }
  }
  return [...duplicated].sort((a, b) => a - b);
}
