/**
 * Análise de inadimplência comercial — regras PURAS.
 *
 * Fonte única: títulos já sincronizados em `NomusAccountsReceivable`.
 * A população de CRs efetivamente vencidos é a do motor oficial de Contas a
 * Receber (`filterOfficialArOverdueTitles`). Esta camada aplica a política
 * comercial sobre essa população: 3 dias corridos de tolerância bloqueante,
 * protesto, identidade e sincronização.
 *
 * Não grava título, não cria ledger e não aplica a tolerância de 3 dias
 * úteis da conciliação de baixa (`financeSettlementReconciliation`) nem a
 * janela visual D+1..D+3 da Tesouraria.
 *
 * Protesto só entra quando o payload Nomus traz um campo explícito.
 * Texto livre de descrição/comentário não vira protesto.
 */

import { isValidCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import {
  computeDaysOverdue,
  decimalFieldToNumber,
  isFinanceArReceivedOrSettled,
  roundMoney,
  startOfLocalDay,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import { deduplicateFinanceArRows } from "@/src/lib/financeAccountsReceivableDeduplication.js";
import { filterOfficialArOverdueTitles } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import { isFinanceArGhostTitle } from "@/src/lib/financeInternalGroupExclusions.js";
import { suppressInferiorPreNfNomusArRows } from "@/src/lib/finance/financeArOperationalPortfolio.js";
import {
  isNomusArStaleForReports,
  type NomusArReportSyncCutoff,
} from "@/src/lib/financeNomusArReportFreshness.js";
import { asBoolean, toInt } from "@/src/lib/nomusAccountsReceivableParser.js";
import {
  resolveCustomerFinancialIdentity,
  type CustomerFinancialIdentityResolution,
} from "./customerSalesBlock.js";

/**
 * Folga comercial bloqueante, em dias corridos, após o CR efetivo do motor
 * oficial. D+1..D+3 podem aparecer como vencidos no Financeiro; a partir de
 * D+4 integram a inadimplência comercial. Distinta da conciliação de baixa
 * (3 dias úteis) e da janela visual da Tesouraria.
 */
export const COMMERCIAL_DELINQUENCY_TOLERANCE_DAYS = 3;

/** Filtro neutro: a decisão comercial não recorta mês/status da carteira oficial. */
export const COMMERCIAL_OFFICIAL_AR_OVERDUE_FILTERS: FinanceArDashboardFilters = {
  status: "all",
};

export const COMMERCIAL_DELINQUENCY_SOURCE = "NomusAccountsReceivable" as const;

export type CommercialDelinquencyStatus = "REGULAR" | "OVERDUE" | "PROTESTED" | "UNKNOWN";

export type CommercialDelinquencyUnknownReason =
  | "IDENTITY_CNPJ_INVALID"
  | "IDENTITY_AMBIGUOUS_CNPJ"
  | "IDENTITY_MISSING_NOMUS_PERSON"
  | "IDENTITY_CONFLICT_NOMUS_PERSON"
  | "IDENTITY_CNPJ_PERSON_MISMATCH"
  | "SYNC_UNAVAILABLE"
  | "SYNC_FAILED"
  | "SYNC_INCOMPLETE"
  | "SYNC_STALE"
  | "PROTEST_UNREADABLE";

export type CommercialDelinquencySyncRunStatus =
  | "SUCCESS"
  | "FAILED"
  | "INCONCLUSIVE"
  | "RUNNING";

export type CommercialDelinquencyTitleInput = {
  externalId: number;
  personId: number | null;
  personName?: string | null;
  personCnpj: string | null;
  companyName?: string | null;
  description: string | null;
  comments?: string | null;
  dueDate: Date | null;
  settlementDate: Date | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  paymentMethodName?: string | null;
  bankAccountName?: string | null;
  suspendCollection: boolean | null;
  nomusStatus: boolean | null;
  syncedAt: Date;
  sourcePresenceStatus: string | null;
  /** Payload Nomus já persistido. Lido só para campos explícitos. */
  rawPayload?: unknown;
};

export type CommercialDelinquencyExclusionReason =
  | "DUPLICATE_EXTERNAL_ID"
  | "REMOVED_FROM_SOURCE"
  | "CANCELLED"
  | "GHOST"
  | "SETTLED"
  | "STALE"
  | "SUPERSEDED_PRE_INVOICE"
  | "SUPERSEDED_REISSUE"
  | "SUPERSEDED_RENEGOTIATION";

export type CommercialDelinquencyOverdueTitle = {
  externalId: number;
  description: string | null;
  sourceInvoiceNumber: string | null;
  dueDate: string | null;
  daysOverdue: number;
  balanceReceivable: number;
  protested: boolean;
};

export type CommercialDelinquencyAnalysis = {
  status: CommercialDelinquencyStatus;
  unknownReason: CommercialDelinquencyUnknownReason | null;
  /** Null quando o retrato não é confiável — zero significaria “nada em aberto”. */
  overdueTitleCount: number | null;
  overdueAmount: number | null;
  openAmount: number | null;
  maxDaysOverdue: number | null;
  lastSyncedAt: string | null;
  evidence: CommercialDelinquencyEvidence;
  /** Retrato dos títulos já classificados como vencidos. Não altera a decisão. */
  overdueTitles?: CommercialDelinquencyOverdueTitle[];
};

export type CommercialDelinquencyEvidence = {
  source: typeof COMMERCIAL_DELINQUENCY_SOURCE;
  toleranceDays: number;
  toleranceUnit: "CALENDAR_DAYS";
  referenceDate: string;
  cnpj: string | null;
  nomusPersonId: number | null;
  identity: CustomerFinancialIdentityResolution["kind"] | "INVALID_CNPJ" | "AMBIGUOUS_CNPJ" | "CNPJ_MISMATCH";
  syncRunStatus: CommercialDelinquencySyncRunStatus | null;
  payloadComplete: boolean | null;
  sourceMaxSyncedAt: string | null;
  includedTitleIds: number[];
  /** CRs efetivamente vencidos segundo o motor oficial, antes da tolerância comercial. */
  officialOverdueTitleIds?: number[];
  overdueTitleIds: number[];
  protestedTitleIds: number[];
  /** Protesto explícito em título já baixado. Não volta a contar como saldo. */
  settledProtestedTitleIds?: number[];
  protestReading: "NOT_IN_SOURCE" | "CLEAR" | "PROTESTED" | "UNRECOGNIZED";
  exclusions: Array<{ externalId: number; reason: CommercialDelinquencyExclusionReason }>;
};

export type AnalyzeCommercialDelinquencyInput = {
  customerId: string;
  taxId: string | null | undefined;
  nomusExternalPersonId: number | null | undefined;
  salesOrderExternalCustomerIds: ReadonlyArray<number | null | undefined>;
  /** Outros Customer.id com o mesmo CNPJ normalizado. */
  peerCustomerIdsWithSameCnpj: readonly string[];
  titles: readonly CommercialDelinquencyTitleInput[];
  syncCutoff: NomusArReportSyncCutoff | null;
  latestRunStatus: CommercialDelinquencySyncRunStatus | null;
  payloadComplete: boolean | null;
  referenceDate: Date;
};

/**
 * Campos de protesto aceitos somente se vierem no objeto raiz do payload.
 * Nenhum deles faz parte do contrato mapeado hoje; a ausência não é protesto.
 */
export const NOMUS_AR_PROTEST_PAYLOAD_KEYS = [
  "protestado",
  "tituloProtestado",
  "emProtesto",
  "situacaoProtesto",
  "statusProtesto",
] as const;

/** Vínculo explícito de título substituído por renegociação, se o Nomus enviar. */
export const NOMUS_AR_RENEGOTIATION_ORIGIN_KEYS = [
  "idContaReceberOrigem",
  "idTituloOrigem",
  "idContaReceberSubstituido",
  "idTituloSubstituido",
  "idContaReceberAnterior",
] as const;

const CANCEL_PAYLOAD_KEYS = ["cancelado", "excluido", "cancelled"] as const;

const PROTESTED_TEXT = new Set(["protestado", "em protesto", "em_protesto", "titulo protestado"]);
const CLEAR_PROTEST_TEXT = new Set([
  "sem protesto",
  "nao protestado",
  "não protestado",
  "nao",
  "não",
]);

function civilDateKey(date: Date): string {
  const day = startOfLocalDay(date);
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function iso(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function foldText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export type NomusArProtestReading = "NOT_PRESENT" | "PROTESTED" | "NOT_PROTESTED" | "UNRECOGNIZED";

/** Lê protesto só de chave explícita no raiz do payload. Não olha descrição nem comentário. */
export function readNomusArProtest(rawPayload: unknown): NomusArProtestReading {
  const root = asRecord(rawPayload);
  if (!root) return "NOT_PRESENT";
  const readings: NomusArProtestReading[] = [];
  for (const key of NOMUS_AR_PROTEST_PAYLOAD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(root, key)) continue;
    const value = root[key];
    if (value == null || value === "") continue;
    if (typeof value === "string") {
      const folded = foldText(value);
      if (PROTESTED_TEXT.has(folded)) {
        readings.push("PROTESTED");
        continue;
      }
      if (CLEAR_PROTEST_TEXT.has(folded)) {
        readings.push("NOT_PROTESTED");
        continue;
      }
    }
    const flag = typeof value === "number" ? null : asBoolean(value);
    if (flag === true) readings.push("PROTESTED");
    else if (flag === false) readings.push("NOT_PROTESTED");
    else readings.push("UNRECOGNIZED");
  }
  if (readings.length === 0) return "NOT_PRESENT";
  const distinct = new Set(readings);
  if (distinct.size > 1) return "UNRECOGNIZED";
  return readings[0]!;
}

export function readNomusArCancellation(rawPayload: unknown): boolean {
  const root = asRecord(rawPayload);
  if (!root) return false;
  for (const key of CANCEL_PAYLOAD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(root, key)) continue;
    if (asBoolean(root[key]) === true) return true;
  }
  return false;
}

export function readNomusArRenegotiationOriginIds(rawPayload: unknown): number[] {
  const root = asRecord(rawPayload);
  if (!root) return [];
  const ids: number[] = [];
  for (const key of NOMUS_AR_RENEGOTIATION_ORIGIN_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(root, key)) continue;
    const id = toInt(root[key]);
    if (id != null && id > 0) ids.push(id);
  }
  return [...new Set(ids)];
}

function emptyEvidence(
  input: AnalyzeCommercialDelinquencyInput,
  identity: CommercialDelinquencyEvidence["identity"],
  nomusPersonId: number | null
): CommercialDelinquencyEvidence {
  return {
    source: COMMERCIAL_DELINQUENCY_SOURCE,
    toleranceDays: COMMERCIAL_DELINQUENCY_TOLERANCE_DAYS,
    toleranceUnit: "CALENDAR_DAYS",
    referenceDate: civilDateKey(input.referenceDate),
    cnpj: normalizeCnpj(input.taxId) || null,
    nomusPersonId,
    identity,
    syncRunStatus: input.latestRunStatus,
    payloadComplete: input.payloadComplete,
    sourceMaxSyncedAt: iso(input.syncCutoff?.maxSyncedAt),
    includedTitleIds: [],
    officialOverdueTitleIds: [],
    overdueTitleIds: [],
    protestedTitleIds: [],
    settledProtestedTitleIds: [],
    protestReading: "NOT_IN_SOURCE",
    exclusions: [],
  };
}

function unknownResult(
  input: AnalyzeCommercialDelinquencyInput,
  reason: CommercialDelinquencyUnknownReason,
  identity: CommercialDelinquencyEvidence["identity"],
  nomusPersonId: number | null,
  lastSyncedAt: string | null,
  evidencePatch?: Partial<CommercialDelinquencyEvidence>
): CommercialDelinquencyAnalysis {
  return {
    status: "UNKNOWN",
    unknownReason: reason,
    overdueTitleCount: null,
    overdueAmount: null,
    openAmount: null,
    maxDaysOverdue: null,
    lastSyncedAt,
    overdueTitles: [],
    evidence: { ...emptyEvidence(input, identity, nomusPersonId), ...evidencePatch },
  };
}

export function commercialDelinquencyTitleToDashboardRow(
  title: CommercialDelinquencyTitleInput
): FinanceArDashboardRow {
  return {
    externalId: title.externalId,
    companyName: title.companyName ?? null,
    personId: title.personId,
    personName: title.personName ?? null,
    personCnpj: title.personCnpj,
    description: title.description,
    comments: title.comments ?? null,
    dueDate: title.dueDate,
    competenceDate: null,
    settlementDate: title.settlementDate,
    amountReceivable: title.amountReceivable,
    amountReceived: title.amountReceived,
    balanceReceivable: title.balanceReceivable,
    paymentMethodName: title.paymentMethodName ?? null,
    bankAccountName: title.bankAccountName ?? null,
    sourceInvoiceId: title.sourceInvoiceId,
    sourceInvoiceNumber: title.sourceInvoiceNumber,
    suspendCollection: title.suspendCollection,
    nomusStatus: title.nomusStatus,
    syncedAt: title.syncedAt,
    sourcePresenceStatus: title.sourcePresenceStatus,
  };
}

function toDashboardRow(title: CommercialDelinquencyTitleInput): FinanceArDashboardRow {
  return commercialDelinquencyTitleToDashboardRow(title);
}

/** População oficial de CRs vencidos — mesma autoridade do Financeiro e da trava de boleto. */
export function selectOfficialArOverdueForCommercial(
  rows: FinanceArDashboardRow[],
  referenceDate: Date,
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceArDashboardRow[] {
  return filterOfficialArOverdueTitles(
    rows,
    COMMERCIAL_OFFICIAL_AR_OVERDUE_FILTERS,
    referenceDate,
    syncCutoff
  );
}

/** Aplica a tolerância comercial de 3 dias corridos sobre CRs já classificados pelo motor oficial. */
export function applyCommercialDelinquencyCalendarTolerance(
  officialOverdue: readonly FinanceArDashboardRow[],
  referenceDate: Date
): FinanceArDashboardRow[] {
  return officialOverdue.filter(
    (row) =>
      row.dueDate != null &&
      computeDaysOverdue(row.dueDate, referenceDate) > COMMERCIAL_DELINQUENCY_TOLERANCE_DAYS
  );
}

function collapseDuplicateExternalIds(
  titles: readonly CommercialDelinquencyTitleInput[]
): { rows: CommercialDelinquencyTitleInput[]; exclusions: CommercialDelinquencyEvidence["exclusions"] } {
  const exclusions: CommercialDelinquencyEvidence["exclusions"] = [];
  const byId = new Map<number, CommercialDelinquencyTitleInput>();
  for (const title of titles) {
    const current = byId.get(title.externalId);
    if (!current) {
      byId.set(title.externalId, title);
      continue;
    }
    const currentWins = current.syncedAt.getTime() > title.syncedAt.getTime();
    const dropped = currentWins ? title : current;
    if (!currentWins) byId.set(title.externalId, title);
    exclusions.push({ externalId: dropped.externalId, reason: "DUPLICATE_EXTERNAL_ID" });
  }
  return { rows: [...byId.values()], exclusions };
}

function latestSyncedAt(titles: readonly { syncedAt: Date }[], cutoff: NomusArReportSyncCutoff | null): string | null {
  let max: Date | null = cutoff?.maxSyncedAt ?? null;
  for (const title of titles) {
    if (!max || title.syncedAt.getTime() > max.getTime()) max = title.syncedAt;
  }
  return iso(max);
}

function syncBlock(
  input: AnalyzeCommercialDelinquencyInput,
  personTitles: readonly CommercialDelinquencyTitleInput[]
): CommercialDelinquencyUnknownReason | null {
  if (input.latestRunStatus === "FAILED") return "SYNC_FAILED";
  if (input.latestRunStatus === "INCONCLUSIVE" || input.latestRunStatus === "RUNNING") {
    return "SYNC_INCOMPLETE";
  }
  if (input.latestRunStatus === "SUCCESS" && input.payloadComplete === false) return "SYNC_INCOMPLETE";
  if (input.syncCutoff == null) return "SYNC_UNAVAILABLE";
  if (personTitles.length === 0) return null;
  const anyCurrent = personTitles.some(
    (title) => !isNomusArStaleForReports(title, input.syncCutoff)
  );
  if (!anyCurrent) return "SYNC_STALE";
  return null;
}

/**
 * Retrato de inadimplência de um cliente. Não declara REGULAR quando a
 * identidade ou a sincronização não sustentam o retrato.
 */
export function analyzeCommercialDelinquency(
  input: AnalyzeCommercialDelinquencyInput
): CommercialDelinquencyAnalysis {
  const cnpj = normalizeCnpj(input.taxId);
  if (!isValidCnpj(cnpj)) {
    return unknownResult(input, "IDENTITY_CNPJ_INVALID", "INVALID_CNPJ", null, latestSyncedAt(input.titles, input.syncCutoff));
  }

  const peers = input.peerCustomerIdsWithSameCnpj.filter((id) => id !== input.customerId);
  if (peers.length > 0) {
    return unknownResult(
      input,
      "IDENTITY_AMBIGUOUS_CNPJ",
      "AMBIGUOUS_CNPJ",
      null,
      latestSyncedAt(input.titles, input.syncCutoff)
    );
  }

  const identity = resolveCustomerFinancialIdentity({
    nomusExternalPersonId: input.nomusExternalPersonId,
    salesOrderExternalCustomerIds: input.salesOrderExternalCustomerIds,
  });
  if (identity.kind === "MISSING") {
    return unknownResult(
      input,
      "IDENTITY_MISSING_NOMUS_PERSON",
      "MISSING",
      null,
      latestSyncedAt(input.titles, input.syncCutoff)
    );
  }
  if (identity.kind === "CONFLICT") {
    return unknownResult(
      input,
      "IDENTITY_CONFLICT_NOMUS_PERSON",
      "CONFLICT",
      null,
      latestSyncedAt(input.titles, input.syncCutoff)
    );
  }

  const personId = identity.personId;
  const personTitles = input.titles.filter((title) => title.personId === personId);
  const lastSync = latestSyncedAt(personTitles, input.syncCutoff);
  const blocked = syncBlock(input, personTitles);
  if (blocked) {
    return unknownResult(input, blocked, "RESOLVED", personId, lastSync);
  }

  const mismatched = personTitles.filter((title) => {
    const titleCnpj = normalizeCnpj(title.personCnpj);
    return titleCnpj.length > 0 && titleCnpj !== cnpj;
  });
  if (mismatched.length > 0) {
    return unknownResult(input, "IDENTITY_CNPJ_PERSON_MISMATCH", "CNPJ_MISMATCH", personId, lastSync);
  }

  const collapsed = collapseDuplicateExternalIds(personTitles);
  const exclusions = [...collapsed.exclusions];
  const active: CommercialDelinquencyTitleInput[] = [];
  const settledRows: FinanceArDashboardRow[] = [];
  const settledProtestedTitleIds: number[] = [];

  for (const title of collapsed.rows) {
    if (title.sourcePresenceStatus === "MISSING_CONFIRMED") {
      exclusions.push({ externalId: title.externalId, reason: "REMOVED_FROM_SOURCE" });
      continue;
    }
    if (readNomusArCancellation(title.rawPayload)) {
      exclusions.push({ externalId: title.externalId, reason: "CANCELLED" });
      continue;
    }
    if (
      isFinanceArGhostTitle({
        amountReceivable: title.amountReceivable,
        amountReceived: title.amountReceived,
        balanceReceivable: title.balanceReceivable,
      })
    ) {
      exclusions.push({ externalId: title.externalId, reason: "GHOST" });
      continue;
    }
    if (isFinanceArReceivedOrSettled(title)) {
      if (readNomusArProtest(title.rawPayload) === "PROTESTED") {
        settledProtestedTitleIds.push(title.externalId);
      }
      exclusions.push({ externalId: title.externalId, reason: "SETTLED" });
      settledRows.push(toDashboardRow(title));
      continue;
    }
    if (isNomusArStaleForReports(title, input.syncCutoff)) {
      exclusions.push({ externalId: title.externalId, reason: "STALE" });
      continue;
    }
    active.push(title);
  }

  const beforePortfolioIds = new Set(active.map((title) => title.externalId));
  const deduped = deduplicateFinanceArRows(active.map(toDashboardRow));
  const afterPreInvoice = new Set(deduped.rows.map((row) => row.externalId));
  for (const id of beforePortfolioIds) {
    if (!afterPreInvoice.has(id)) {
      exclusions.push({ externalId: id, reason: "SUPERSEDED_PRE_INVOICE" });
    }
  }

  const afterReissue = suppressInferiorPreNfNomusArRows(deduped.rows);
  const afterReissueIds = new Set(afterReissue.map((row) => row.externalId));
  for (const id of afterPreInvoice) {
    if (!afterReissueIds.has(id)) {
      exclusions.push({ externalId: id, reason: "SUPERSEDED_REISSUE" });
    }
  }

  const byId = new Map(active.map((title) => [title.externalId, title]));
  const renegotiatedOrigins = new Set<number>();
  for (const row of afterReissue) {
    const title = byId.get(row.externalId);
    if (!title) continue;
    for (const originId of readNomusArRenegotiationOriginIds(title.rawPayload)) {
      if (afterReissueIds.has(originId)) renegotiatedOrigins.add(originId);
    }
  }
  for (const originId of renegotiatedOrigins) {
    exclusions.push({ externalId: originId, reason: "SUPERSEDED_RENEGOTIATION" });
  }

  const effective = afterReissue.filter((row) => !renegotiatedOrigins.has(row.externalId));
  const open = effective.filter((row) => row.balanceReceivable > 0);
  const officialUniverse = [...effective, ...settledRows];
  const officialOverdue = selectOfficialArOverdueForCommercial(
    officialUniverse,
    input.referenceDate,
    input.syncCutoff
  );
  const overdue = applyCommercialDelinquencyCalendarTolerance(officialOverdue, input.referenceDate);

  let protestReading: CommercialDelinquencyEvidence["protestReading"] = "NOT_IN_SOURCE";
  const protestedTitleIds: number[] = [];
  let unreadableProtest = false;
  let sawProtestField = false;
  for (const row of open) {
    const title = byId.get(row.externalId);
    const reading = readNomusArProtest(title?.rawPayload);
    if (reading === "NOT_PRESENT") continue;
    sawProtestField = true;
    if (reading === "PROTESTED") protestedTitleIds.push(row.externalId);
    if (reading === "UNRECOGNIZED") unreadableProtest = true;
  }
  if (protestedTitleIds.length > 0 && !unreadableProtest) protestReading = "PROTESTED";
  else if (unreadableProtest) protestReading = "UNRECOGNIZED";
  else if (sawProtestField) protestReading = "CLEAR";

  const evidence: CommercialDelinquencyEvidence = {
    ...emptyEvidence(input, "RESOLVED", personId),
    includedTitleIds: open.map((row) => row.externalId).sort((a, b) => a - b),
    officialOverdueTitleIds: officialOverdue.map((row) => row.externalId).sort((a, b) => a - b),
    overdueTitleIds: overdue.map((row) => row.externalId).sort((a, b) => a - b),
    protestedTitleIds: [...protestedTitleIds].sort((a, b) => a - b),
    settledProtestedTitleIds: [...settledProtestedTitleIds].sort((a, b) => a - b),
    protestReading,
    exclusions,
  };

  if (protestedTitleIds.length > 0) {
    return metricsResult("PROTESTED", open, overdue, input.referenceDate, lastSync, evidence);
  }
  if (overdue.length > 0) {
    return metricsResult("OVERDUE", open, overdue, input.referenceDate, lastSync, evidence);
  }
  if (unreadableProtest) {
    return unknownResult(input, "PROTEST_UNREADABLE", "RESOLVED", personId, lastSync, evidence);
  }
  return metricsResult("REGULAR", open, overdue, input.referenceDate, lastSync, evidence);
}

function metricsResult(
  status: Exclude<CommercialDelinquencyStatus, "UNKNOWN">,
  open: FinanceArDashboardRow[],
  overdue: FinanceArDashboardRow[],
  referenceDate: Date,
  lastSyncedAt: string | null,
  evidence: CommercialDelinquencyEvidence
): CommercialDelinquencyAnalysis {
  let maxDays = 0;
  for (const row of overdue) {
    maxDays = Math.max(maxDays, computeDaysOverdue(row.dueDate, referenceDate));
  }
  return {
    status,
    unknownReason: null,
    overdueTitleCount: overdue.length,
    overdueAmount: roundMoney(overdue.reduce((sum, row) => sum + row.balanceReceivable, 0)),
    openAmount: roundMoney(open.reduce((sum, row) => sum + row.balanceReceivable, 0)),
    maxDaysOverdue: overdue.length === 0 ? 0 : maxDays,
    lastSyncedAt,
    evidence,
    overdueTitles: presentOverdueTitles(overdue, referenceDate, evidence.protestedTitleIds),
  };
}

function presentOverdueTitles(
  overdue: FinanceArDashboardRow[],
  referenceDate: Date,
  protestedTitleIds: readonly number[]
): CommercialDelinquencyOverdueTitle[] {
  const protested = new Set(protestedTitleIds);
  return overdue
    .map((row) => ({
      externalId: row.externalId,
      description: row.description,
      sourceInvoiceNumber: row.sourceInvoiceNumber,
      dueDate: row.dueDate ? civilDateKey(row.dueDate) : null,
      daysOverdue: computeDaysOverdue(row.dueDate, referenceDate),
      balanceReceivable: roundMoney(row.balanceReceivable),
      protested: protested.has(row.externalId),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balanceReceivable - a.balanceReceivable || a.externalId - b.externalId);
}

/** Converte Decimal do Prisma sem alterar o mapper oficial. */
export function commercialDelinquencyMoney(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return decimalFieldToNumber(value as never);
}
