/**
 * Motor determinístico de projeção de caixa (Tesouraria).
 * Funções puras / testáveis — sem Express, sem Prisma, sem I/O.
 *
 * Fluxo:
 * 1–9  insumos já carregados no input
 * 10 remover cancelados
 * 11 resolver saldo aberto
 * 12 resolver data por cenário
 * 13 agrupar por dia e conta
 * 14 calcular saldos
 * 15 identificar risco
 * 16 retornar composição rastreável
 *
 * Dinheiro: strings decimais (kit Tesouraria) — sem float.
 */

import { addCivilDays, compareCivilDates } from "@/src/lib/financeCivilDate.js";
import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import { isTreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type {
  TreasuryLedgerDirection,
  TreasuryProjectionItemKind,
  TreasuryProjectionLayer,
  TreasuryProjectionRiskCode,
} from "../contracts/treasuryEnums.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  negateTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import {
  resolveTreasuryApplicationLiquidityForDay,
  resolveTreasuryCreditAvailable,
  type TreasuryProjectionApplicationSeed,
} from "./treasuryProjectionLiquidity.js";

export type { TreasuryProjectionApplicationSeed };
import {
  resolvePayableMovementDate,
  resolveReceivableMovementDate,
} from "./treasuryMovementDateRules.js";
import {
  resolveTreasuryFinancialIdentities,
  type TreasuryFinancialClaim,
} from "./treasuryFinancialIdentityRules.js";

export const TREASURY_PROJECTION_ALGORITHM_VERSION = "1.3.0" as const;

// ---------------------------------------------------------------------------
// Inputs (snapshot já carregado — o motor não busca dados)
// ---------------------------------------------------------------------------

export type TreasuryProjectionAccountBase = {
  accountId: string;
  code: string;
  name?: string;
  includeInConsolidated: boolean;
  allowNegativeBalance?: boolean;
  minimumBalance: string;
  /** Saldo-base disponível no início do período (civil periodFrom). */
  openingBalance: string;
  blockedBalance?: string;
  investmentsBalance?: string;
  creditLimit?: string;
  usedLimit?: string;
};

export type TreasuryProjectionReceivableSeed = {
  id: string;
  officialTitleId: string;
  nomusExternalId: number;
  accountId: string | null;
  dueDate: string | null;
  expectedDate?: string | null;
  confirmedDate?: string | null;
  realizedDate?: string | null;
  activePromiseDate?: string | null;
  activePromiseStatus?: string | null;
  manualDate?: string | null;
  originalAmount: string;
  openBalance: string;
  settledAmount?: string | null;
  installmentNumber?: number | null;
  isCancelled?: boolean;
  salesOrderExternalId?: number | null;
  nfeExternalId?: number | null;
};

export type TreasuryProjectionPayableSeed = {
  id: string;
  officialTitleId: string;
  nomusExternalId: number;
  accountId: string | null;
  dueDate: string | null;
  expectedDate?: string | null;
  confirmedDate?: string | null;
  realizedDate?: string | null;
  scheduledDate?: string | null;
  programmingStatus?: string | null;
  manualDate?: string | null;
  originalAmount: string;
  openBalance: string;
  settledAmount?: string | null;
  installmentNumber?: number | null;
  isCancelled?: boolean;
};

export type TreasuryProjectionExpectationOverlay = {
  officialTitleId: string;
  expectedDate?: string | null;
  confirmedDate?: string | null;
  accountId?: string | null;
  isCancelled?: boolean;
};

export type TreasuryProjectionPromiseOverlay = {
  officialTitleId: string;
  promisedDate: string;
  status: string;
  promisedAmount?: string | null;
  isCancelled?: boolean;
};

export type TreasuryProjectionProgrammingOverlay = {
  officialTitleId: string;
  scheduledDate?: string | null;
  scheduledAmount?: string | null;
  programmingStatus?: string | null;
  accountId?: string | null;
  isCancelled?: boolean;
};

export type TreasuryProjectionSettlementSeed = {
  id: string;
  side: "AR" | "AP";
  officialTitleId: string;
  accountId: string | null;
  civilDate: string;
  amount: string;
  isReconciled?: boolean;
  isCancelled?: boolean;
};

export type TreasuryProjectionLedgerSeed = {
  id: string;
  accountId: string;
  civilDate: string;
  amount: string;
  direction: TreasuryLedgerDirection;
  nature?: string;
  status: "ACTIVE" | "REVERSED" | string;
  transferGroupId?: string | null;
  /** Quando preenchido, evita duplicar baixa oficial do mesmo título. */
  officialTitleId?: string | null;
  linkedSettlementId?: string | null;
  isCancelled?: boolean;
};

export type TreasuryProjectionTransferSeed = {
  id: string;
  transferGroupId: string;
  fromAccountId: string;
  toAccountId: string;
  civilDate: string;
  amount: string;
  isCancelled?: boolean;
  /**
   * Quando omitido, comportamento legado: ambas as pernas em `civilDate`, realizadas.
   * Com status: SENT sem `inCivilDate` = recurso em trânsito (só saída).
   */
  status?:
    | "FORECAST"
    | "SCHEDULED"
    | "SENT"
    | "RECEIVED"
    | "RECONCILED"
    | "CANCELLED";
  outCivilDate?: string | null;
  inCivilDate?: string | null;
  outRealized?: boolean;
  inRealized?: boolean;
};

export type TreasuryProjectionEngineInput = {
  scenario: TreasuryProjectionLayer;
  asOfCivilDate: TreasuryCivilDate;
  periodFrom: TreasuryCivilDate;
  periodTo: TreasuryCivilDate;
  accounts: TreasuryProjectionAccountBase[];
  receivables: TreasuryProjectionReceivableSeed[];
  payables: TreasuryProjectionPayableSeed[];
  settlements: TreasuryProjectionSettlementSeed[];
  expectations: TreasuryProjectionExpectationOverlay[];
  promises: TreasuryProjectionPromiseOverlay[];
  programming: TreasuryProjectionProgrammingOverlay[];
  ledgerEntries: TreasuryProjectionLedgerSeed[];
  transfers: TreasuryProjectionTransferSeed[];
  applications?: TreasuryProjectionApplicationSeed[];
  /** Conta padrão quando o título não tem conta operacional. */
  fallbackAccountId?: string | null;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type TreasuryProjectionCompositionItemResult = {
  itemKind: TreasuryProjectionItemKind;
  amount: TreasuryMoneyString;
  label: string;
  officialTitleId: string | null;
  nomusExternalId: number | null;
  ledgerEntryId: string | null;
  transferGroupId: string | null;
  sourceRef: string;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

export type TreasuryProjectionDayLineResult = {
  accountId: string;
  civilDate: TreasuryCivilDate;
  openingBalance: TreasuryMoneyString;
  inflows: TreasuryMoneyString;
  outflows: TreasuryMoneyString;
  transfers: TreasuryMoneyString;
  realized: TreasuryMoneyString;
  closingBalance: TreasuryMoneyString;
  availableBalance: TreasuryMoneyString;
  blockedBalance: TreasuryMoneyString;
  investmentsBalance: TreasuryMoneyString;
  investmentsMaturedToday: TreasuryMoneyString;
  totalPosition: TreasuryMoneyString;
  creditLimit: TreasuryMoneyString;
  usedLimit: TreasuryMoneyString;
  creditAvailable: TreasuryMoneyString;
  uncertainReceivables: TreasuryMoneyString;
  minimumBalance: TreasuryMoneyString;
  riskAmount: TreasuryMoneyString;
  riskCode: TreasuryProjectionRiskCode;
  itemCount: number;
  composition: TreasuryProjectionCompositionItemResult[];
};

export type TreasuryProjectionEngineResult = {
  algorithmVersion: typeof TREASURY_PROJECTION_ALGORITHM_VERSION;
  scenario: TreasuryProjectionLayer;
  asOfCivilDate: TreasuryCivilDate;
  periodFrom: TreasuryCivilDate;
  periodTo: TreasuryCivilDate;
  dayLines: TreasuryProjectionDayLineResult[];
  skipped: { id: string; reason: string }[];
  lineCount: number;
  itemCount: number;
};

export type TreasuryProjectionMovement = {
  id: string;
  accountId: string;
  civilDate: TreasuryCivilDate;
  amount: TreasuryMoneyString;
  direction: "INFLOW" | "OUTFLOW";
  itemKind: TreasuryProjectionItemKind;
  isRealized: boolean;
  isUncertain: boolean;
  affectsConsolidated: boolean;
  officialTitleId: string | null;
  nomusExternalId: number | null;
  ledgerEntryId: string | null;
  transferGroupId: string | null;
  sourceRef: string;
  label: string;
  metadata: Record<string, unknown>;
};

function money(value: string | null | undefined): TreasuryMoneyString {
  return normalizeTreasuryMoneyString(value == null || value === "" ? "0" : value);
}

function assertPeriod(from: string, to: string): void {
  if (!isTreasuryCivilDate(from) || !isTreasuryCivilDate(to)) {
    throw new Error("Período de projeção inválido (datas civis YYYY-MM-DD).");
  }
  if (compareCivilDates(from, to) > 0) {
    throw new Error("periodFrom não pode ser posterior a periodTo.");
  }
}

/** Gera lista inclusive de dias civis [from, to]. */
export function enumerateTreasuryProjectionCivilDates(
  periodFrom: TreasuryCivilDate,
  periodTo: TreasuryCivilDate
): TreasuryCivilDate[] {
  assertPeriod(periodFrom, periodTo);
  const dates: TreasuryCivilDate[] = [];
  let cursor: string | null = periodFrom;
  while (cursor && compareCivilDates(cursor, periodTo) <= 0) {
    dates.push(cursor);
    cursor = addCivilDays(cursor, 1);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// 10 — remover cancelados
// ---------------------------------------------------------------------------

export function removeCancelledProjectionItems<T extends { isCancelled?: boolean }>(
  items: readonly T[]
): T[] {
  return items.filter((i) => !i.isCancelled);
}

export function removeCancelledLedgerEntries(
  entries: readonly TreasuryProjectionLedgerSeed[]
): TreasuryProjectionLedgerSeed[] {
  return entries.filter(
    (e) => !e.isCancelled && e.status === "ACTIVE" && !e.transferGroupId
  );
}

// ---------------------------------------------------------------------------
// Overlays (5–7 aplicados sobre sementes)
// ---------------------------------------------------------------------------

export function applyExpectationOverlays(
  receivables: readonly TreasuryProjectionReceivableSeed[],
  expectations: readonly TreasuryProjectionExpectationOverlay[]
): TreasuryProjectionReceivableSeed[] {
  const byTitle = new Map(
    removeCancelledProjectionItems(expectations).map((e) => [
      e.officialTitleId,
      e,
    ])
  );
  return receivables.map((r) => {
    const o = byTitle.get(r.officialTitleId);
    if (!o) return { ...r };
    return {
      ...r,
      expectedDate: o.expectedDate ?? r.expectedDate,
      confirmedDate: o.confirmedDate ?? r.confirmedDate,
      accountId: o.accountId ?? r.accountId,
    };
  });
}

export function applyPromiseOverlays(
  receivables: readonly TreasuryProjectionReceivableSeed[],
  promises: readonly TreasuryProjectionPromiseOverlay[]
): TreasuryProjectionReceivableSeed[] {
  const active = removeCancelledProjectionItems(promises).filter((p) =>
    ["ACTIVE", "PARTIALLY_FULFILLED"].includes(p.status)
  );
  // Uma promessa ativa por título (determinístico: data mais próxima, depois id).
  const best = new Map<string, TreasuryProjectionPromiseOverlay>();
  for (const p of [...active].sort((a, b) => {
    const d = compareCivilDates(a.promisedDate, b.promisedDate);
    if (d !== 0) return d;
    return a.officialTitleId.localeCompare(b.officialTitleId);
  })) {
    if (!best.has(p.officialTitleId)) best.set(p.officialTitleId, p);
  }
  return receivables.map((r) => {
    const p = best.get(r.officialTitleId);
    if (!p) return { ...r };
    // Promessa parcial: limita saldo projetável (espelha programação de CP).
    const cappedOpen =
      p.promisedAmount != null && p.promisedAmount !== ""
        ? compareTreasuryMoney(money(p.promisedAmount), money(r.openBalance)) < 0
          ? money(p.promisedAmount)
          : money(r.openBalance)
        : r.openBalance;
    return {
      ...r,
      activePromiseDate: p.promisedDate,
      activePromiseStatus: p.status,
      openBalance: cappedOpen,
    };
  });
}

/** Dedup determinístico por título+parcela (evita double-count de seeds repetidas). */
export function dedupeProjectionTitleSeeds<
  T extends {
    id: string;
    officialTitleId: string;
    installmentNumber?: number | null;
  },
>(seeds: readonly T[]): T[] {
  const seen = new Map<string, T>();
  const ordered = [...seeds].sort((a, b) => a.id.localeCompare(b.id));
  for (const s of ordered) {
    const inst =
      s.installmentNumber == null || !Number.isFinite(s.installmentNumber)
        ? "none"
        : String(Math.trunc(s.installmentNumber));
    const key = `${s.officialTitleId}|inst:${inst}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function applyProgrammingOverlays(
  payables: readonly TreasuryProjectionPayableSeed[],
  programming: readonly TreasuryProjectionProgrammingOverlay[]
): TreasuryProjectionPayableSeed[] {
  const byTitle = new Map(
    removeCancelledProjectionItems(programming).map((p) => [
      p.officialTitleId,
      p,
    ])
  );
  return payables.map((r) => {
    const o = byTitle.get(r.officialTitleId);
    if (!o) return { ...r };
    return {
      ...r,
      scheduledDate: o.scheduledDate ?? r.scheduledDate,
      programmingStatus: o.programmingStatus ?? r.programmingStatus,
      accountId: o.accountId ?? r.accountId,
      // Programação parcial: saldo projetável ≤ open; se scheduledAmount < open, usa scheduled.
      openBalance:
        o.scheduledAmount != null && o.scheduledAmount !== ""
          ? compareTreasuryMoney(money(o.scheduledAmount), money(r.openBalance)) <
            0
            ? money(o.scheduledAmount)
            : money(r.openBalance)
          : r.openBalance,
    };
  });
}

// ---------------------------------------------------------------------------
// 11 — resolver saldo aberto
// ---------------------------------------------------------------------------

export function resolveProjectionOpenBalance(input: {
  originalAmount: string;
  openBalance: string;
  settledAmount?: string | null;
}): TreasuryMoneyString {
  const open = money(input.openBalance);
  if (compareTreasuryMoney(open, "0.00") < 0) return "0.00";
  return open;
}

// ---------------------------------------------------------------------------
// Conta efetiva
// ---------------------------------------------------------------------------

export function resolveProjectionAccountId(input: {
  accountId: string | null | undefined;
  fallbackAccountId?: string | null;
}): string | null {
  if (input.accountId) return input.accountId;
  if (input.fallbackAccountId) return input.fallbackAccountId;
  return null;
}

// ---------------------------------------------------------------------------
// 12 — movimentos a partir de títulos + baixas + ledger + transferências
// ---------------------------------------------------------------------------

function inPeriod(
  date: string,
  periodFrom: string,
  periodTo: string
): boolean {
  return (
    compareCivilDates(date, periodFrom) >= 0 &&
    compareCivilDates(date, periodTo) <= 0
  );
}

export function buildReceivableProjectionMovements(input: {
  scenario: TreasuryProjectionLayer;
  asOfCivilDate: TreasuryCivilDate;
  periodFrom: TreasuryCivilDate;
  periodTo: TreasuryCivilDate;
  receivables: readonly TreasuryProjectionReceivableSeed[];
  settlements: readonly TreasuryProjectionSettlementSeed[];
  fallbackAccountId?: string | null;
  accountConsolidatedById?: Map<string, boolean>;
}): { movements: TreasuryProjectionMovement[]; skipped: { id: string; reason: string }[] } {
  const movements: TreasuryProjectionMovement[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const settlementsByTitle = new Map<string, TreasuryProjectionSettlementSeed[]>();
  for (const s of input.settlements.filter((x) => x.side === "AR")) {
    const list = settlementsByTitle.get(s.officialTitleId) ?? [];
    list.push(s);
    settlementsByTitle.set(s.officialTitleId, list);
  }

  const receivables = dedupeProjectionTitleSeeds(input.receivables);

  for (const r of receivables) {
    const accountId = resolveProjectionAccountId({
      accountId: r.accountId,
      fallbackAccountId: input.fallbackAccountId,
    });
    if (!accountId) {
      skipped.push({ id: r.id, reason: "Recebível sem conta financeira." });
      continue;
    }

    const open = resolveProjectionOpenBalance(r);
    const titleSettlements = settlementsByTitle.get(r.officialTitleId) ?? [];
    const affectsConsolidated =
      input.accountConsolidatedById?.get(accountId) ?? true;

    const claims: TreasuryFinancialClaim[] = [
      {
        id: `forecast:${r.id}`,
        source: "FORECAST",
        side: "AR",
        amount: money(r.originalAmount),
        openBalance: open,
        settledAmount: money(r.settledAmount),
        installmentNumber: r.installmentNumber ?? null,
        officialTitleId: r.officialTitleId,
        nomusExternalId: r.nomusExternalId,
        salesOrderExternalId: r.salesOrderExternalId,
        nfeExternalId: r.nfeExternalId,
        isCancelled: false,
      },
      ...titleSettlements.map(
        (s): TreasuryFinancialClaim => ({
          id: s.id,
          source: s.isReconciled
            ? "RECONCILED_MOVEMENT"
            : "OFFICIAL_SETTLEMENT",
          side: "AR",
          amount: money(s.amount),
          settledAmount: money(s.amount),
          installmentNumber: r.installmentNumber ?? null,
          officialTitleId: r.officialTitleId,
          nomusExternalId: r.nomusExternalId,
          isCancelled: Boolean(s.isCancelled),
        })
      ),
    ];

    const identity = resolveTreasuryFinancialIdentities(claims);

    for (const slice of identity.slices) {
      if (!slice.includeInCashProjection) continue;

      if (slice.role === "REALIZED") {
        const settlement = titleSettlements.find((s) => s.id === slice.claimId);
        const civilDate = settlement?.civilDate ?? r.realizedDate;
        if (!civilDate || !isTreasuryCivilDate(civilDate)) {
          skipped.push({
            id: slice.claimId,
            reason: "Baixa AR sem data civil.",
          });
          continue;
        }
        if (!inPeriod(civilDate, input.periodFrom, input.periodTo)) continue;
        const settleAccountId = settlement?.accountId ?? accountId;
        const settleConsolidated =
          input.accountConsolidatedById?.get(settleAccountId) ??
          affectsConsolidated;
        movements.push({
          id: slice.claimId,
          accountId: settleAccountId,
          civilDate,
          amount: slice.amount,
          direction: "INFLOW",
          itemKind: "REALIZED",
          isRealized: true,
          isUncertain: false,
          affectsConsolidated:
            slice.affectsConsolidated && settleConsolidated,
          officialTitleId: r.officialTitleId,
          nomusExternalId: r.nomusExternalId,
          ledgerEntryId: null,
          transferGroupId: null,
          sourceRef: slice.logicalKey,
          label: `Recebimento AR ${r.nomusExternalId}`,
          metadata: { source: slice.source, role: slice.role },
        });
        continue;
      }

      if (slice.role === "FORECAST") {
        const dateRes = resolveReceivableMovementDate({
          scenario: input.scenario,
          asOfCivilDate: input.asOfCivilDate,
          movement: {
            dueDate: r.dueDate,
            expectedDate: r.expectedDate,
            confirmedDate: r.confirmedDate,
            realizedDate: r.realizedDate,
            activePromiseDate: r.activePromiseDate,
            activePromiseStatus: r.activePromiseStatus,
            manualDate: r.manualDate,
          },
        });
        if (!dateRes.includeInProjection || !dateRes.resolvedDate) {
          skipped.push({
            id: r.id,
            reason: dateRes.detail,
          });
          continue;
        }
        if (
          !inPeriod(dateRes.resolvedDate, input.periodFrom, input.periodTo)
        ) {
          continue;
        }
        const uncertain =
          dateRes.source === "ACTIVE_PROMISE" ||
          dateRes.source === "EXPECTED_DATE";
        movements.push({
          id: `ar-forecast:${r.id}`,
          accountId,
          civilDate: dateRes.resolvedDate,
          amount: slice.amount,
          direction: "INFLOW",
          itemKind: uncertain ? "UNCERTAIN_RECEIVABLE" : "RECEIVABLE",
          isRealized: false,
          isUncertain: uncertain,
          affectsConsolidated,
          officialTitleId: r.officialTitleId,
          nomusExternalId: r.nomusExternalId,
          ledgerEntryId: null,
          transferGroupId: null,
          sourceRef: slice.logicalKey,
          label: `Recebível ${r.nomusExternalId}`,
          metadata: {
            dateSource: dateRes.source,
            scenario: input.scenario,
          },
        });
      }
    }
  }

  return { movements, skipped };
}

export function buildPayableProjectionMovements(input: {
  scenario: TreasuryProjectionLayer;
  asOfCivilDate: TreasuryCivilDate;
  periodFrom: TreasuryCivilDate;
  periodTo: TreasuryCivilDate;
  payables: readonly TreasuryProjectionPayableSeed[];
  settlements: readonly TreasuryProjectionSettlementSeed[];
  fallbackAccountId?: string | null;
  accountConsolidatedById?: Map<string, boolean>;
}): { movements: TreasuryProjectionMovement[]; skipped: { id: string; reason: string }[] } {
  const movements: TreasuryProjectionMovement[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const settlementsByTitle = new Map<string, TreasuryProjectionSettlementSeed[]>();
  for (const s of input.settlements.filter((x) => x.side === "AP")) {
    const list = settlementsByTitle.get(s.officialTitleId) ?? [];
    list.push(s);
    settlementsByTitle.set(s.officialTitleId, list);
  }

  const payables = dedupeProjectionTitleSeeds(input.payables);

  for (const p of payables) {
    const accountId = resolveProjectionAccountId({
      accountId: p.accountId,
      fallbackAccountId: input.fallbackAccountId,
    });
    if (!accountId) {
      skipped.push({ id: p.id, reason: "Pagável sem conta financeira." });
      continue;
    }

    const open = resolveProjectionOpenBalance(p);
    const titleSettlements = settlementsByTitle.get(p.officialTitleId) ?? [];
    const affectsConsolidated =
      input.accountConsolidatedById?.get(accountId) ?? true;

    const claims: TreasuryFinancialClaim[] = [
      {
        id: `forecast:${p.id}`,
        source: "FORECAST",
        side: "AP",
        amount: money(p.originalAmount),
        openBalance: open,
        settledAmount: money(p.settledAmount),
        installmentNumber: p.installmentNumber ?? null,
        officialTitleId: p.officialTitleId,
        nomusExternalId: p.nomusExternalId,
        isCancelled: false,
      },
      ...titleSettlements.map(
        (s): TreasuryFinancialClaim => ({
          id: s.id,
          source: s.isReconciled
            ? "RECONCILED_MOVEMENT"
            : "OFFICIAL_SETTLEMENT",
          side: "AP",
          amount: money(s.amount),
          settledAmount: money(s.amount),
          installmentNumber: p.installmentNumber ?? null,
          officialTitleId: p.officialTitleId,
          nomusExternalId: p.nomusExternalId,
          isCancelled: Boolean(s.isCancelled),
        })
      ),
    ];

    const identity = resolveTreasuryFinancialIdentities(claims);

    for (const slice of identity.slices) {
      if (!slice.includeInCashProjection) continue;

      if (slice.role === "REALIZED") {
        const settlement = titleSettlements.find((s) => s.id === slice.claimId);
        const civilDate = settlement?.civilDate ?? p.realizedDate;
        if (!civilDate || !isTreasuryCivilDate(civilDate)) {
          skipped.push({
            id: slice.claimId,
            reason: "Baixa AP sem data civil.",
          });
          continue;
        }
        if (!inPeriod(civilDate, input.periodFrom, input.periodTo)) continue;
        const settleAccountId = settlement?.accountId ?? accountId;
        const settleConsolidated =
          input.accountConsolidatedById?.get(settleAccountId) ??
          affectsConsolidated;
        movements.push({
          id: slice.claimId,
          accountId: settleAccountId,
          civilDate,
          amount: slice.amount,
          direction: "OUTFLOW",
          itemKind: "REALIZED",
          isRealized: true,
          isUncertain: false,
          affectsConsolidated:
            slice.affectsConsolidated && settleConsolidated,
          officialTitleId: p.officialTitleId,
          nomusExternalId: p.nomusExternalId,
          ledgerEntryId: null,
          transferGroupId: null,
          sourceRef: slice.logicalKey,
          label: `Pagamento AP ${p.nomusExternalId}`,
          metadata: { source: slice.source, role: slice.role },
        });
        continue;
      }

      if (slice.role === "FORECAST") {
        const dateRes = resolvePayableMovementDate({
          scenario: input.scenario,
          asOfCivilDate: input.asOfCivilDate,
          movement: {
            dueDate: p.dueDate,
            expectedDate: p.expectedDate,
            confirmedDate: p.confirmedDate,
            scheduledDate: p.scheduledDate,
            realizedDate: p.realizedDate,
            programmingStatus: p.programmingStatus,
            manualDate: p.manualDate,
          },
        });
        if (!dateRes.includeInProjection || !dateRes.resolvedDate) {
          skipped.push({ id: p.id, reason: dateRes.detail });
          continue;
        }
        if (
          !inPeriod(dateRes.resolvedDate, input.periodFrom, input.periodTo)
        ) {
          continue;
        }
        movements.push({
          id: `ap-forecast:${p.id}`,
          accountId,
          civilDate: dateRes.resolvedDate,
          amount: slice.amount,
          direction: "OUTFLOW",
          itemKind: "PAYABLE",
          isRealized: false,
          isUncertain: false,
          affectsConsolidated,
          officialTitleId: p.officialTitleId,
          nomusExternalId: p.nomusExternalId,
          ledgerEntryId: null,
          transferGroupId: null,
          sourceRef: slice.logicalKey,
          label: `Pagável ${p.nomusExternalId}`,
          metadata: {
            dateSource: dateRes.source,
            scenario: input.scenario,
          },
        });
      }
    }
  }

  return { movements, skipped };
}

export function buildLedgerProjectionMovements(input: {
  periodFrom: TreasuryCivilDate;
  periodTo: TreasuryCivilDate;
  ledgerEntries: readonly TreasuryProjectionLedgerSeed[];
  /** Ids de baixas oficiais — ledger linkado não duplica caixa. */
  settlementIds?: ReadonlySet<string>;
  settledTitleIds?: ReadonlySet<string>;
  accountConsolidatedById?: Map<string, boolean>;
}): { movements: TreasuryProjectionMovement[]; skipped: { id: string; reason: string }[] } {
  const movements: TreasuryProjectionMovement[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const settlementIds = input.settlementIds ?? new Set<string>();
  const settledTitleIds = input.settledTitleIds ?? new Set<string>();

  for (const e of removeCancelledLedgerEntries(input.ledgerEntries)) {
    if (!inPeriod(e.civilDate, input.periodFrom, input.periodTo)) continue;
    if (!isTreasuryCivilDate(e.civilDate)) continue;
    if (e.linkedSettlementId && settlementIds.has(e.linkedSettlementId)) {
      skipped.push({
        id: e.id,
        reason: "Lançamento linkado a baixa oficial — evita dupla contagem.",
      });
      continue;
    }
    if (e.officialTitleId && settledTitleIds.has(e.officialTitleId)) {
      skipped.push({
        id: e.id,
        reason:
          "Lançamento do mesmo título de baixa oficial — evita dupla contagem.",
      });
      continue;
    }
    const nature = (e.nature ?? "").toUpperCase();
    if (
      nature.includes("SETTLEMENT") ||
      nature.includes("BAIXA") ||
      nature === "OFFICIAL_SETTLEMENT"
    ) {
      skipped.push({
        id: e.id,
        reason: "Lançamento com nature de baixa — use settlements.",
      });
      continue;
    }
    const amount = money(e.amount);
    const direction: "INFLOW" | "OUTFLOW" =
      e.direction === "CREDIT" ? "INFLOW" : "OUTFLOW";
    const affectsConsolidated =
      input.accountConsolidatedById?.get(e.accountId) ?? true;
    movements.push({
      id: e.id,
      accountId: e.accountId,
      civilDate: e.civilDate,
      amount,
      direction,
      itemKind: "MANUAL_ENTRY",
      isRealized: true,
      isUncertain: false,
      affectsConsolidated,
      officialTitleId: e.officialTitleId ?? null,
      nomusExternalId: null,
      ledgerEntryId: e.id,
      transferGroupId: null,
      sourceRef: `LEDGER|${e.id}|${e.civilDate}`,
      label: e.nature ? `Lançamento ${e.nature}` : "Lançamento manual",
      metadata: { direction: e.direction, nature: e.nature ?? null },
    });
  }
  return { movements, skipped };
}

export function buildTransferProjectionMovements(input: {
  periodFrom: TreasuryCivilDate;
  periodTo: TreasuryCivilDate;
  transfers: readonly TreasuryProjectionTransferSeed[];
  /** Contas presentes no saldo-base — ambas as pernas exigidas. */
  knownAccountIds?: ReadonlySet<string>;
}): { movements: TreasuryProjectionMovement[]; skipped: { id: string; reason: string }[] } {
  const movements: TreasuryProjectionMovement[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const known = input.knownAccountIds;

  for (const t of removeCancelledProjectionItems(input.transfers)) {
    if (t.status === "CANCELLED") {
      skipped.push({ id: t.id, reason: "Transferência cancelada." });
      continue;
    }
    if (
      known &&
      (!known.has(t.fromAccountId) || !known.has(t.toAccountId))
    ) {
      skipped.push({
        id: t.id,
        reason:
          "Transferência ignorada: origem ou destino ausente do saldo-base (preserva invariante consolidado).",
      });
      continue;
    }

    const outCivilDate = t.outCivilDate ?? t.civilDate;
    const inCivilDate =
      t.inCivilDate === undefined ? t.civilDate : t.inCivilDate;
    // Legado (sem status): ambas realizadas. Com status: usar flags ou derivar.
    const outRealized =
      t.outRealized ??
      (t.status == null ||
        t.status === "SENT" ||
        t.status === "RECEIVED" ||
        t.status === "RECONCILED");
    const inRealized =
      t.inRealized ??
      (t.status == null ||
        t.status === "RECEIVED" ||
        t.status === "RECONCILED");
    const amount = money(t.amount);
    const fundsInTransit = t.status === "SENT" && inCivilDate == null;

    if (outCivilDate && isTreasuryCivilDate(outCivilDate)) {
      if (inPeriod(outCivilDate, input.periodFrom, input.periodTo)) {
        movements.push({
          id: `${t.id}:out`,
          accountId: t.fromAccountId,
          civilDate: outCivilDate,
          amount,
          direction: "OUTFLOW",
          itemKind: "TRANSFER",
          isRealized: outRealized,
          isUncertain: false,
          affectsConsolidated: false,
          officialTitleId: null,
          nomusExternalId: null,
          ledgerEntryId: null,
          transferGroupId: t.transferGroupId,
          sourceRef: `TRANSFER|${t.transferGroupId}|OUT|inst:none`,
          label: "Transferência saída",
          metadata: {
            leg: "OUT",
            transferId: t.id,
            status: t.status ?? null,
            fundsInTransit,
          },
        });
      }
    }

    if (inCivilDate && isTreasuryCivilDate(inCivilDate)) {
      if (inPeriod(inCivilDate, input.periodFrom, input.periodTo)) {
        movements.push({
          id: `${t.id}:in`,
          accountId: t.toAccountId,
          civilDate: inCivilDate,
          amount,
          direction: "INFLOW",
          itemKind: "TRANSFER",
          isRealized: inRealized,
          isUncertain: false,
          affectsConsolidated: false,
          officialTitleId: null,
          nomusExternalId: null,
          ledgerEntryId: null,
          transferGroupId: t.transferGroupId,
          sourceRef: `TRANSFER|${t.transferGroupId}|IN|inst:none`,
          label: "Transferência entrada",
          metadata: {
            leg: "IN",
            transferId: t.id,
            status: t.status ?? null,
            fundsInTransit: false,
          },
        });
      }
    } else if (fundsInTransit) {
      skipped.push({
        id: `${t.id}:in`,
        reason:
          "Entrada omitida: recurso em trânsito (enviada, ainda não recebida).",
      });
    }
  }
  return { movements, skipped };
}

// ---------------------------------------------------------------------------
// 13 — agrupar por dia e conta
// ---------------------------------------------------------------------------

export function groupProjectionMovementsByDayAndAccount(
  movements: readonly TreasuryProjectionMovement[]
): Map<string, TreasuryProjectionMovement[]> {
  const map = new Map<string, TreasuryProjectionMovement[]>();
  const sorted = [...movements].sort((a, b) => {
    const byAccount = a.accountId.localeCompare(b.accountId);
    if (byAccount !== 0) return byAccount;
    const byDate = compareCivilDates(a.civilDate, b.civilDate);
    if (byDate !== 0) return byDate;
    return a.sourceRef.localeCompare(b.sourceRef);
  });
  for (const m of sorted) {
    const key = `${m.accountId}|${m.civilDate}`;
    const list = map.get(key);
    if (list) list.push(m);
    else map.set(key, [m]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 14–15 — saldos + risco
// ---------------------------------------------------------------------------

export function identifyProjectionRisk(input: {
  availableBalance: string;
  minimumBalance: string;
  uncertainReceivables: string;
  allowNegativeBalance?: boolean;
}): {
  riskCode: TreasuryProjectionRiskCode;
  riskAmount: TreasuryMoneyString;
} {
  const available = money(input.availableBalance);
  const minimum = money(input.minimumBalance);
  const uncertain = money(input.uncertainReceivables);

  if (
    compareTreasuryMoney(available, "0.00") < 0 &&
    !input.allowNegativeBalance
  ) {
    return {
      riskCode: "CRITICAL",
      riskAmount: negateTreasuryMoney(available),
    };
  }

  if (compareTreasuryMoney(available, minimum) < 0) {
    const shortfall = subtractTreasuryMoney(minimum, available);
    return {
      riskCode:
        compareTreasuryMoney(uncertain, "0.00") > 0 ? "HIGH" : "MEDIUM",
      riskAmount: shortfall,
    };
  }

  if (compareTreasuryMoney(uncertain, "0.00") > 0) {
    return { riskCode: "LOW", riskAmount: "0.00" };
  }

  return { riskCode: "NONE", riskAmount: "0.00" };
}

export function buildDayLineComposition(
  movements: readonly TreasuryProjectionMovement[]
): TreasuryProjectionCompositionItemResult[] {
  return movements.map((m, index) => ({
    itemKind: m.itemKind,
    amount:
      m.direction === "INFLOW" ? m.amount : negateTreasuryMoney(m.amount),
    label: m.label,
    officialTitleId: m.officialTitleId,
    nomusExternalId: m.nomusExternalId,
    ledgerEntryId: m.ledgerEntryId,
    transferGroupId: m.transferGroupId,
    sourceRef: m.sourceRef,
    sortOrder: index,
    metadata: {
      ...m.metadata,
      direction: m.direction,
      isRealized: m.isRealized,
      isUncertain: m.isUncertain,
      affectsConsolidated: m.affectsConsolidated,
    },
  }));
}

export function calculateProjectionDayLine(input: {
  account: TreasuryProjectionAccountBase;
  civilDate: TreasuryCivilDate;
  openingBalance: string;
  openingInvestments?: string;
  movements: readonly TreasuryProjectionMovement[];
  applications?: readonly TreasuryProjectionApplicationSeed[];
}): TreasuryProjectionDayLineResult {
  let inflows = "0.00";
  let outflows = "0.00";
  let transfers = "0.00";
  let realized = "0.00";
  let uncertainReceivables = "0.00";

  for (const m of input.movements) {
    if (m.itemKind === "TRANSFER") {
      transfers =
        m.direction === "INFLOW"
          ? addTreasuryMoney(transfers, m.amount)
          : subtractTreasuryMoney(transfers, m.amount);
      continue;
    }
    if (m.direction === "INFLOW") {
      inflows = addTreasuryMoney(inflows, m.amount);
    } else {
      outflows = addTreasuryMoney(outflows, m.amount);
    }
    if (m.isRealized) {
      realized = addTreasuryMoney(realized, m.amount);
    }
    if (m.isUncertain && m.direction === "INFLOW") {
      uncertainReceivables = addTreasuryMoney(uncertainReceivables, m.amount);
    }
  }

  const applications = input.applications ?? [];
  const liquidity = resolveTreasuryApplicationLiquidityForDay({
    applications,
    accountId: input.account.accountId,
    civilDate: input.civilDate,
  });

  const opening = money(input.openingBalance);
  const openingInvestments = money(input.openingInvestments);
  const maturingToday = liquidity.maturingToday;

  let availableBalance = addTreasuryMoney(opening, inflows);
  availableBalance = subtractTreasuryMoney(availableBalance, outflows);
  availableBalance = addTreasuryMoney(availableBalance, transfers);
  availableBalance = addTreasuryMoney(availableBalance, maturingToday);

  const blockedBalance = money(input.account.blockedBalance);
  const investmentsBalance =
    applications.length > 0
      ? liquidity.stillLocked
      : subtractTreasuryMoney(openingInvestments, maturingToday);

  const totalPosition = addTreasuryMoney(
    addTreasuryMoney(availableBalance, blockedBalance),
    investmentsBalance
  );

  const creditLimit = money(input.account.creditLimit);
  const usedLimit = money(input.account.usedLimit);
  const creditAvailable = resolveTreasuryCreditAvailable({
    creditLimit,
    usedLimit,
  });

  const minimum = money(input.account.minimumBalance);
  const risk = identifyProjectionRisk({
    availableBalance,
    minimumBalance: minimum,
    uncertainReceivables,
    allowNegativeBalance: input.account.allowNegativeBalance,
  });
  const composition = buildDayLineComposition(input.movements);
  const closingBalance = availableBalance;

  return {
    accountId: input.account.accountId,
    civilDate: input.civilDate,
    openingBalance: opening,
    inflows,
    outflows,
    transfers,
    realized,
    closingBalance,
    availableBalance,
    blockedBalance,
    investmentsBalance,
    investmentsMaturedToday: maturingToday,
    totalPosition,
    creditLimit,
    usedLimit,
    creditAvailable,
    uncertainReceivables,
    minimumBalance: minimum,
    riskAmount: risk.riskAmount,
    riskCode: risk.riskCode,
    itemCount: composition.length,
    composition,
  };
}

// ---------------------------------------------------------------------------
// 16 — orquestração determinística
// ---------------------------------------------------------------------------

export function runTreasuryProjectionEngine(
  input: TreasuryProjectionEngineInput
): TreasuryProjectionEngineResult {
  assertPeriod(input.periodFrom, input.periodTo);
  if (!isTreasuryCivilDate(input.asOfCivilDate)) {
    throw new Error("asOfCivilDate inválido.");
  }

  // 1 — saldo-base por conta (input.accounts)
  const accounts = [...input.accounts].sort((a, b) =>
    a.accountId.localeCompare(b.accountId)
  );
  const accountById = new Map(accounts.map((a) => [a.accountId, a]));
  const knownAccountIds = new Set(accounts.map((a) => a.accountId));
  const accountConsolidatedById = new Map(
    accounts.map((a) => [a.accountId, a.includeInConsolidated] as const)
  );

  // 10 — remover cancelados
  const receivablesActive = removeCancelledProjectionItems(input.receivables);
  const payablesActive = removeCancelledProjectionItems(input.payables);
  const settlementsActive = removeCancelledProjectionItems(input.settlements);
  const applicationsActive = removeCancelledProjectionItems(
    input.applications ?? []
  );
  // Índice por conta — evita O(contas×dias×apps) no roll-forward.
  const applicationsByAccount = new Map<
    string,
    typeof applicationsActive
  >();
  for (const app of applicationsActive) {
    const list = applicationsByAccount.get(app.accountId) ?? [];
    list.push(app);
    applicationsByAccount.set(app.accountId, list);
  }

  // 5–7 — overlays
  const withExpectations = applyExpectationOverlays(
    receivablesActive,
    input.expectations
  );
  const withPromises = applyPromiseOverlays(withExpectations, input.promises);
  const withProgramming = applyProgrammingOverlays(
    payablesActive,
    input.programming
  );

  // 2–4 + 11–12 — títulos / baixas → movimentos
  const ar = buildReceivableProjectionMovements({
    scenario: input.scenario,
    asOfCivilDate: input.asOfCivilDate,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    receivables: withPromises,
    settlements: settlementsActive,
    fallbackAccountId: input.fallbackAccountId,
    accountConsolidatedById,
  });
  const ap = buildPayableProjectionMovements({
    scenario: input.scenario,
    asOfCivilDate: input.asOfCivilDate,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    payables: withProgramming,
    settlements: settlementsActive,
    fallbackAccountId: input.fallbackAccountId,
    accountConsolidatedById,
  });

  const settlementIds = new Set(settlementsActive.map((s) => s.id));
  const settledTitleIds = new Set(
    settlementsActive.map((s) => s.officialTitleId)
  );

  // 8–9 — lançamentos e transferências
  const ledger = buildLedgerProjectionMovements({
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    ledgerEntries: input.ledgerEntries,
    settlementIds,
    settledTitleIds,
    accountConsolidatedById,
  });
  const transfers = buildTransferProjectionMovements({
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    transfers: input.transfers,
    knownAccountIds,
  });

  const allMovements = [
    ...ar.movements,
    ...ap.movements,
    ...ledger.movements,
    ...transfers.movements,
  ];
  const skipped = [
    ...ar.skipped,
    ...ap.skipped,
    ...ledger.skipped,
    ...transfers.skipped,
  ];

  // 13 — agrupar
  const grouped = groupProjectionMovementsByDayAndAccount(allMovements);
  const dates = enumerateTreasuryProjectionCivilDates(
    input.periodFrom,
    input.periodTo
  );

  // 14–15 — roll-forward por conta/dia
  const dayLines: TreasuryProjectionDayLineResult[] = [];
  for (const account of accounts) {
    let opening = money(account.openingBalance);
    let openingInvestments = money(account.investmentsBalance);
    const accountApps = applicationsByAccount.get(account.accountId) ?? [];
    for (const civilDate of dates) {
      const key = `${account.accountId}|${civilDate}`;
      const dayMovements = grouped.get(key) ?? [];
      const line = calculateProjectionDayLine({
        account,
        civilDate,
        openingBalance: opening,
        openingInvestments,
        movements: dayMovements,
        applications: accountApps,
      });
      dayLines.push(line);
      opening = line.availableBalance;
      openingInvestments = line.investmentsBalance;
    }
  }

  const itemCount = dayLines.reduce((n, l) => n + l.itemCount, 0);

  return {
    algorithmVersion: TREASURY_PROJECTION_ALGORITHM_VERSION,
    scenario: input.scenario,
    asOfCivilDate: input.asOfCivilDate,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    dayLines,
    skipped,
    lineCount: dayLines.length,
    itemCount,
  };
}
