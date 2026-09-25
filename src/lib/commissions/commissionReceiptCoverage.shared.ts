/**
 * Cobertura de comissão por EVENTO de recebimento — tipos, estados e regras puras
 * (seguro para frontend). Responde, para cada recebimento:
 *   quando foi recebido, qual a competência natural, se já foi contemplado,
 *   por quem (Nomus legado ou fechamento IndusCost), em qual fechamento e valor,
 *   por que ainda não foi, e se pode entrar no fechamento atual.
 *
 * Nomus legado = tabela CommissionReceiptCoverage (importação).
 * IndusCost = fechamento CLOSED; a cobertura INDUSCOST_CLOSING é gravada na MESMA
 * transação do ledger e existe para a garantia de banco (índice único parcial:
 * um recebimento só tem UMA cobertura COVERED).
 */
import {
  formatCommissionYearMonthLabel,
  resolveReceiptCutoverPeriod,
  type CommissionYearMonth,
} from "./commissionCoverageCutover.js";

export type CommissionCoverageSource = "NOMUS_LEGACY" | "INDUSCOST_CLOSING" | "MANUAL_ADJUSTMENT";
export type CommissionCoverageStatus = "COVERED" | "PENDING" | "IGNORED" | "SUPERSEDED";
export type CommissionCoverageAssociationMethod =
  | "RECEIPT_ID"
  | "RECEIVABLE_ID"
  | "RECEIVABLE_AMOUNT_DATE"
  | "MANUAL"
  | "INDUSCOST_LEDGER";
export type CommissionLedgerInclusionType =
  | "NORMAL"
  | "LATE_CARRYOVER"
  | "LEGACY_CARRYOVER"
  | "MANUAL_ADJUSTMENT";

/** Estado resolvido de um evento de recebimento quanto à cobertura de comissão. */
export type CommissionCoverageState =
  | "LEGACY_OUTSIDE_RECONCILIATION_WINDOW"
  | "LEGACY_COVERED"
  | "LEGACY_UNMATCHED"
  | "LEGACY_PENDING_CANDIDATE"
  | "AMBIGUOUS"
  | "INDUSCOST_COVERED"
  | "POST_CUTOVER_PENDING";

/** Registro de cobertura ativo (COVERED) usado na resolução. */
export type CommissionCoverageRecord = {
  id: string;
  receiptExternalId: number | null;
  receivableExternalId: number;
  coverageSource: CommissionCoverageSource;
  coverageStatus: CommissionCoverageStatus;
  coveredYear: number | null;
  coveredMonth: number | null;
  closingId: string | null;
  legacyImportId: string | null;
  coveredReceivedAmount: number;
  coveredCommissionAmount: number | null;
  associationMethod: CommissionCoverageAssociationMethod;
};

export const COMMISSION_COVERAGE_STATE_LABELS: Record<CommissionCoverageState, string> = {
  LEGACY_OUTSIDE_RECONCILIATION_WINDOW: "Histórico Nomus fora da janela de transição",
  LEGACY_COVERED: "Coberto pelo Nomus (histórico)",
  LEGACY_UNMATCHED: "Linha do relatório Nomus sem recebimento correspondente",
  LEGACY_PENDING_CANDIDATE: "Não encontrado na cobertura Nomus",
  AMBIGUOUS: "Associação histórica ambígua",
  INDUSCOST_COVERED: "Coberto por fechamento IndusCost",
  POST_CUTOVER_PENDING: "Pendência de período anterior",
};

export const COMMISSION_LEDGER_INCLUSION_TYPE_LABELS: Record<CommissionLedgerInclusionType, string> = {
  NORMAL: "Normal",
  LATE_CARRYOVER: "Pendência pós-cutover",
  LEGACY_CARRYOVER: "Pendência legada (pré-cutover)",
  MANUAL_ADJUSTMENT: "Ajuste manual",
};

export const COMMISSION_COVERAGE_SOURCE_LABELS: Record<CommissionCoverageSource, string> = {
  NOMUS_LEGACY: "Nomus (histórico)",
  INDUSCOST_CLOSING: "Fechamento IndusCost",
  MANUAL_ADJUSTMENT: "Ajuste manual",
};

/**
 * Estado de um recebimento. Cobertura COVERED sempre vence (não importa a janela);
 * sem cobertura, a janela decide: antes de 01/08/2026 nunca vira pendência; na
 * janela de transição é candidato legado (ou ambíguo, se a importação do Nomus não
 * conseguiu associar com segurança); depois do cutover é pendência IndusCost.
 */
export function resolveCommissionReceiptCoverageState(input: {
  receiptDate: Date | string;
  activeCoverage: Pick<CommissionCoverageRecord, "coverageSource"> | null;
  ambiguousLegacyAssociation?: boolean;
}): CommissionCoverageState {
  if (input.activeCoverage) {
    return input.activeCoverage.coverageSource === "NOMUS_LEGACY"
      ? "LEGACY_COVERED"
      : "INDUSCOST_COVERED";
  }
  const period = resolveReceiptCutoverPeriod(input.receiptDate);
  if (period === "LEGACY_OUTSIDE_RECONCILIATION_WINDOW") return "LEGACY_OUTSIDE_RECONCILIATION_WINDOW";
  if (period === "LEGACY_RECONCILIATION_WINDOW") {
    return input.ambiguousLegacyAssociation ? "AMBIGUOUS" : "LEGACY_PENDING_CANDIDATE";
  }
  return "POST_CUTOVER_PENDING";
}

export function isPendingCoverageState(state: CommissionCoverageState): boolean {
  return state === "LEGACY_PENDING_CANDIDATE" || state === "POST_CUTOVER_PENDING" || state === "AMBIGUOUS";
}

/**
 * Status de linha que significam "contemplado de forma final" num fechamento CLOSED:
 * comissionável ou não comissionável por regra (exclusão, grupo, sem vínculo de venda,
 * comissão zero). Exceções resolvíveis (sem schedule, vendedor não resolvido, sem
 * regra, erro…) NÃO cobrem: o recebimento continua pendente até ser resolvido.
 */
export const COMMISSION_COVERAGE_FINAL_LINE_STATUSES = [
  "COMMISSIONABLE",
  "CUSTOMER_EXCLUDED",
  "GROUP_COMPANY_EXCLUDED",
  "NO_SALES_LINK",
  "ZERO_AMOUNT",
] as const;

/** Não comissionável por regra — nunca vira pendência (coverage não muda regra). */
export const COMMISSION_NOT_COMMISSIONABLE_LINE_STATUSES = [
  "CUSTOMER_EXCLUDED",
  "GROUP_COMPANY_EXCLUDED",
  "NO_SALES_LINK",
  "ZERO_AMOUNT",
] as const;

export function isCoverageFinalLineStatus(status: string): boolean {
  return (COMMISSION_COVERAGE_FINAL_LINE_STATUSES as readonly string[]).includes(status);
}

export function isNotCommissionableLineStatus(status: string): boolean {
  return (COMMISSION_NOT_COMMISSIONABLE_LINE_STATUSES as readonly string[]).includes(status);
}

const SELLER_BLOCKING_RESOLUTIONS = new Set(["SELLER_UNRESOLVED", "NO_SELLER"]);

/* ------------------------------------------------------------------ */
/*  Pendências de períodos anteriores (grid do fechamento)             */
/* ------------------------------------------------------------------ */

export type ReceiptClosingCarryoverOrigin = "LEGACY_NOMUS" | "INDUSCOST";

/** Uma linha do grid = um título (CR) numa competência natural anterior. */
export type ReceiptClosingCarryoverRow = {
  /** `CR|AAAA-MM` — identidade estável da linha no grid. */
  rowKey: string;
  receivableExternalId: number;
  /** Eventos de recebimento pendentes do título nessa competência. */
  receiptExternalIds: number[];
  receiptDate: string | null;
  naturalYear: number;
  naturalMonth: number;
  state: CommissionCoverageState;
  origin: ReceiptClosingCarryoverOrigin;
  inclusionType: Extract<CommissionLedgerInclusionType, "LATE_CARRYOVER" | "LEGACY_CARRYOVER">;
  situation: string;
  includable: boolean;
  blockedReason: string | null;
  selected: boolean;
  nfeNumber: string | null;
  orderCode: string | null;
  customerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  sellerResolutionStatus: string | null;
  installmentNumber: number | null;
  installmentTotal?: number | null;
  /** Σ dos eventos pendentes (recebido bruto do período). */
  receivedAmount: number;
  receivableOriginalAmount: number | null;
  commissionableBaseAmount: number;
  commissionAmount: number;
  lineStatus: string;
  statusReason: string | null;
  commissionReceivableScheduleId: string | null;
};

export type ReceiptClosingCarryoverSummary = {
  eligibleCount: number;
  eligibleReceivedAmount: number;
  eligibleCommissionableBase: number;
  eligibleCommissionAmount: number;
  selectedCount: number;
  selectedCommissionAmount: number;
  ambiguousCount: number;
  blockedCount: number;
  legacyAwaitingImportCount: number;
};

export type ReceiptClosingLegacyImportMonthStatus = {
  year: number;
  month: number;
  imported: boolean;
};

export type ReceiptClosingCarryoverSection = {
  closingYear: number;
  closingMonth: number;
  rows: ReceiptClosingCarryoverRow[];
  summary: ReceiptClosingCarryoverSummary;
  legacyImportStatus: ReceiptClosingLegacyImportMonthStatus[];
  /** Receipts pedidos na seleção que não puderam ser incluídos (com motivo). */
  selectionErrors: Array<{ receiptExternalId: number; reason: string }>;
};

/** Composição da comissão do fechamento: competência atual + pendências. */
export type ReceiptClosingCommissionComposition = {
  currentCompetenceCommission: number;
  carryoverCommission: number;
  totalCommission: number;
  carryoverLineCount: number;
  carryoverReceivedAmount: number;
};

export const RECEIPT_CLOSING_CARRYOVER_HELP =
  "Recebimentos elegíveis de competências anteriores que ainda não foram contemplados por uma fonte oficial de comissão.";

/**
 * Pode entrar no fechamento? Só pendência confiável:
 *   - estado pendente (não coberto) e não ambíguo;
 *   - legado: cobertura do Nomus importada de todos os meses da competência natural
 *     até o cutover (senão pode ter sido paga no Nomus — risco de duplicidade);
 *   - linha comissionável, com schedule e vendedor resolvido.
 */
export function assessCarryoverRowInclusion(input: {
  state: CommissionCoverageState;
  lineStatus: string;
  statusReason: string | null;
  commissionReceivableScheduleId: string | null;
  canonicalSellerId: string | null;
  sellerResolutionStatus: string | null;
  missingLegacyImports: CommissionYearMonth[];
  statusLabel: (status: string) => string;
}): { includable: boolean; blockedReason: string | null } {
  if (input.state === "AMBIGUOUS") {
    return {
      includable: false,
      blockedReason: "Associação histórica ambígua na importação do Nomus — revise antes de incluir.",
    };
  }
  if (input.state !== "LEGACY_PENDING_CANDIDATE" && input.state !== "POST_CUTOVER_PENDING") {
    return { includable: false, blockedReason: "Recebimento já coberto por uma fonte oficial." };
  }
  if (input.state === "LEGACY_PENDING_CANDIDATE" && input.missingLegacyImports.length > 0) {
    return {
      includable: false,
      blockedReason: `Falta confirmação histórica: importe a cobertura do Nomus de ${input.missingLegacyImports
        .map(formatCommissionYearMonthLabel)
        .join(", ")}.`,
    };
  }
  if (input.lineStatus !== "COMMISSIONABLE") {
    const label = input.statusLabel(input.lineStatus);
    const reason = input.statusReason?.trim() || null;
    return {
      includable: false,
      // Motivo do motor que já começa com o rótulo ("Vendedor não resolvido (…)") não repete.
      blockedReason: !reason
        ? label
        : reason.toLowerCase().startsWith(label.toLowerCase())
          ? reason
          : `${label}: ${reason}`,
    };
  }
  if (!input.commissionReceivableScheduleId) {
    return { includable: false, blockedReason: "Sem schedule de comissão — não inventa comissão." };
  }
  if (
    !input.canonicalSellerId ||
    (input.sellerResolutionStatus != null && SELLER_BLOCKING_RESOLUTIONS.has(input.sellerResolutionStatus))
  ) {
    return { includable: false, blockedReason: "Vendedor não resolvido — resolva antes de incluir." };
  }
  return { includable: true, blockedReason: null };
}

export function summarizeCarryoverRows(rows: readonly ReceiptClosingCarryoverRow[]): ReceiptClosingCarryoverSummary {
  const round = (n: number) => Math.round(n * 100) / 100;
  const summary: ReceiptClosingCarryoverSummary = {
    eligibleCount: 0,
    eligibleReceivedAmount: 0,
    eligibleCommissionableBase: 0,
    eligibleCommissionAmount: 0,
    selectedCount: 0,
    selectedCommissionAmount: 0,
    ambiguousCount: 0,
    blockedCount: 0,
    legacyAwaitingImportCount: 0,
  };
  for (const row of rows) {
    if (row.state === "AMBIGUOUS") summary.ambiguousCount += 1;
    if (row.includable) {
      summary.eligibleCount += 1;
      summary.eligibleReceivedAmount = round(summary.eligibleReceivedAmount + row.receivedAmount);
      summary.eligibleCommissionableBase = round(summary.eligibleCommissionableBase + row.commissionableBaseAmount);
      summary.eligibleCommissionAmount = round(summary.eligibleCommissionAmount + row.commissionAmount);
    } else {
      summary.blockedCount += 1;
      if (row.state === "LEGACY_PENDING_CANDIDATE" && row.blockedReason?.startsWith("Falta confirmação histórica")) {
        summary.legacyAwaitingImportCount += 1;
      }
    }
    if (row.selected) {
      summary.selectedCount += 1;
      summary.selectedCommissionAmount = round(summary.selectedCommissionAmount + row.commissionAmount);
    }
  }
  return summary;
}

/**
 * Seleção enviada pelo navegador → linhas do grid. O navegador só manda IDs de
 * recebimento; valores, vendedor e competência vêm sempre do servidor. Linha só
 * entra inteira (todos os eventos do título naquela competência).
 */
export function resolveCarryoverSelection(
  rows: readonly ReceiptClosingCarryoverRow[],
  selectedReceiptIds: readonly number[]
): {
  selectedRows: ReceiptClosingCarryoverRow[];
  errors: Array<{ receiptExternalId: number; reason: string }>;
} {
  const wanted = new Set(selectedReceiptIds.filter((id) => Number.isInteger(id) && id > 0));
  const errors: Array<{ receiptExternalId: number; reason: string }> = [];
  const selectedRows: ReceiptClosingCarryoverRow[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const hits = row.receiptExternalIds.filter((id) => wanted.has(id));
    if (hits.length === 0) continue;
    hits.forEach((id) => seen.add(id));
    if (hits.length !== row.receiptExternalIds.length) {
      for (const id of hits) {
        errors.push({
          receiptExternalId: id,
          reason: `Seleção parcial do título ${row.receivableExternalId} em ${formatCommissionYearMonthLabel({
            year: row.naturalYear,
            month: row.naturalMonth,
          })}: inclua todos os recebimentos da linha.`,
        });
      }
      continue;
    }
    if (!row.includable) {
      for (const id of hits) {
        errors.push({ receiptExternalId: id, reason: row.blockedReason ?? "Pendência não elegível." });
      }
      continue;
    }
    selectedRows.push(row);
  }
  for (const id of wanted) {
    if (!seen.has(id)) {
      errors.push({
        receiptExternalId: id,
        reason:
          "Recebimento não está entre as pendências deste fechamento (já coberto, fora da janela, da própria competência ou inexistente).",
      });
    }
  }
  return { selectedRows, errors };
}

/** Rótulo curto da origem para a coluna "Origem". */
export function formatCarryoverOrigin(origin: ReceiptClosingCarryoverOrigin): string {
  return origin === "LEGACY_NOMUS" ? "Pré-cutover / Nomus" : "IndusCost";
}

/** Parse tolerante de `1,2,3` (query) ou array (body) para IDs de recebimento. */
export function parseCarryoverReceiptIds(value: unknown): number[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : value == null
        ? []
        : [value];
  const out = new Set<number>();
  for (const item of raw) {
    const n = typeof item === "number" ? item : Number(String(item).trim());
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Etiqueta curta da linha incluída como pendência de período anterior (ex.: "Retroativa 08/2026"). */
export function formatCarryoverLineTag(line: {
  inclusionType?: CommissionLedgerInclusionType | null;
  naturalYear?: number | null;
  naturalMonth?: number | null;
}): string | null {
  if (!line.inclusionType || line.inclusionType === "NORMAL") return null;
  if (!line.naturalYear || !line.naturalMonth) return "Retroativa";
  return `Retroativa ${formatCommissionYearMonthLabel({ year: line.naturalYear, month: line.naturalMonth })}`;
}
