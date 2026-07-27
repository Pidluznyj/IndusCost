/**
 * Motor determinístico de exceções da Tesouraria.
 * Funções puras / testáveis — sem Express, sem Prisma, sem I/O.
 *
 * Fluxo:
 * 1. receber fatos já carregados (seeds)
 * 2. gerar candidatos por tipo (regras fixas)
 * 3. ordenar por uniqueKey (determinístico)
 * 4. planejar upserts de todos os candidatos
 * 5. planejar auto-resolve só quando a causa sumiu e o tipo permite
 *
 * Dinheiro: strings decimais (kit Tesouraria) — sem float.
 */

import { compareCivilDates } from "@/src/lib/financeCivilDate.js";
import type {
  TreasuryExceptionEntityKind,
  TreasuryExceptionSeverity,
  TreasuryExceptionStatus,
  TreasuryExceptionType,
} from "../contracts/treasuryEnums.js";
import {
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import { isTreasuryExceptionOpenCause } from "./treasuryExceptionRules.js";

export const TREASURY_EXCEPTION_ALGORITHM_VERSION = "1.0.0" as const;

export const TREASURY_EXCEPTION_AUTO_RESOLVE_RESOLUTION =
  "Causa sanada automaticamente pelo motor de exceções." as const;

/** Tipos cuja resolução automática é segura quando a causa deixa de existir. */
export const TREASURY_EXCEPTION_SAFE_AUTO_RESOLVE_TYPES: readonly TreasuryExceptionType[] =
  [
    "EXPECTED_RECEIPT_NOT_RECEIVED",
    "EXPECTED_PAYMENT_NOT_MADE",
    "OVERDUE_RECEIVABLE_WITHOUT_ACTION",
    "EXPIRED_PROMISE",
    "CRITICAL_PAYMENT_NOT_PROGRAMMED",
    "ACCOUNT_BELOW_MINIMUM",
    "ACCOUNT_PROJECTION_NEGATIVE",
    "CONSOLIDATED_PROJECTION_NEGATIVE",
    "STALE_BALANCE",
    "BANK_MOVEMENT_UNIDENTIFIED",
    "RECONCILIATION_DIFFERENCE",
    "TRANSFER_IN_TRANSIT",
    "TITLE_WITHOUT_RESPONSIBLE",
    "SYNC_DELAYED",
  ];

/** Tipos que nunca auto-resolvem (investigação / trilha humana). */
export const TREASURY_EXCEPTION_UNSAFE_AUTO_RESOLVE_TYPES: readonly TreasuryExceptionType[] =
  ["SUSPECTED_DUPLICATE", "FINANCIAL_CHANGE_AFTER_CLOSING", "MANUAL"];

export function allowsTreasuryExceptionSafeAutoResolve(
  type: TreasuryExceptionType
): boolean {
  return (
    TREASURY_EXCEPTION_SAFE_AUTO_RESOLVE_TYPES as readonly string[]
  ).includes(type);
}

// ---------------------------------------------------------------------------
// Seeds (snapshot já carregado)
// ---------------------------------------------------------------------------

export type TreasuryExceptionEngineReceivableSeed = {
  officialTitleId: string;
  nomusExternalId?: string | number | null;
  openAmount: string;
  /** Data civil em que o recebimento era esperado. */
  expectedDate: string | null;
  dueDate: string | null;
  responsibleUserId?: string | null;
  /** Há ação de cobrança aberta / recente registrada. */
  hasCollectionAction: boolean;
  isCancelled?: boolean;
  /** Já realizado / liquidado (saldo aberto zero). */
  isSettled?: boolean;
};

export type TreasuryExceptionEnginePayableSeed = {
  officialTitleId: string;
  nomusExternalId?: string | number | null;
  openAmount: string;
  expectedDate: string | null;
  dueDate: string | null;
  responsibleUserId?: string | null;
  isProgrammed: boolean;
  isCritical: boolean;
  isCancelled?: boolean;
  isSettled?: boolean;
};

export type TreasuryExceptionEnginePromiseSeed = {
  id: string;
  officialTitleId: string;
  promisedDate: string;
  status: string;
  promisedAmount: string;
};

export type TreasuryExceptionEngineAccountSeed = {
  accountId: string;
  code?: string;
  availableBalance: string;
  minimumBalance: string;
  /** ISO timestamp do último saldo conhecido. */
  lastBalanceAtIso: string | null;
  staleAfterHours: number;
};

export type TreasuryExceptionEngineProjectionDaySeed = {
  /** null = consolidado. */
  accountId: string | null;
  civilDate: string;
  closingBalance: string;
};

export type TreasuryExceptionEngineTransferSeed = {
  id: string;
  status: string;
  amount: string;
  fromAccountId: string;
  toAccountId: string;
};

export type TreasuryExceptionEngineBankMovementSeed = {
  id: string;
  accountId: string;
  amount: string;
  identified: boolean;
};

export type TreasuryExceptionEngineReconciliationDiffSeed = {
  id: string;
  accountId: string;
  differenceAmount: string;
};

export type TreasuryExceptionEngineSyncFreshnessSeed = {
  side: "AR" | "AP";
  lastSuccessAtIso: string | null;
  maxAgeHours: number;
};

export type TreasuryExceptionEngineDuplicateSuspectSeed = {
  key: string;
  entityKind: TreasuryExceptionEntityKind;
  entityIds: string[];
  amount: string;
};

export type TreasuryExceptionEnginePostClosingChangeSeed = {
  id: string;
  entityKind: TreasuryExceptionEntityKind;
  entityId: string;
  closedCivilDate: string;
  changedAtIso: string;
  amount?: string | null;
};

export type TreasuryExceptionEngineOpenRow = {
  id: string;
  uniqueKey: string;
  type: TreasuryExceptionType;
  status: TreasuryExceptionStatus;
  version: number;
};

export type TreasuryExceptionEngineInput = {
  companyCode: string;
  asOfCivilDate: string;
  detectedAtIso: string;
  /** Epoch ms de referência para stale/sync (injetado — determinístico). */
  nowEpochMs: number;
  receivables?: TreasuryExceptionEngineReceivableSeed[];
  payables?: TreasuryExceptionEnginePayableSeed[];
  promises?: TreasuryExceptionEnginePromiseSeed[];
  accounts?: TreasuryExceptionEngineAccountSeed[];
  projectionDays?: TreasuryExceptionEngineProjectionDaySeed[];
  transfers?: TreasuryExceptionEngineTransferSeed[];
  bankMovements?: TreasuryExceptionEngineBankMovementSeed[];
  reconciliationDiffs?: TreasuryExceptionEngineReconciliationDiffSeed[];
  syncFreshness?: TreasuryExceptionEngineSyncFreshnessSeed[];
  duplicateSuspects?: TreasuryExceptionEngineDuplicateSuspectSeed[];
  postClosingChanges?: TreasuryExceptionEnginePostClosingChangeSeed[];
  openExceptions?: TreasuryExceptionEngineOpenRow[];
};

export type TreasuryExceptionCandidate = {
  uniqueKey: string;
  type: TreasuryExceptionType;
  severity: TreasuryExceptionSeverity;
  entityKind: TreasuryExceptionEntityKind;
  entityId: string;
  accountId: string | null;
  nomusExternalId: string | null;
  title: string;
  description: string;
  amount: TreasuryMoneyString | null;
  dueAt: string | null;
  responsibleUserId: string | null;
  allowsSafeAutoResolve: boolean;
  metadata: Record<string, unknown>;
};

export type TreasuryExceptionAutoResolvePlan = {
  id: string;
  uniqueKey: string;
  type: TreasuryExceptionType;
  version: number;
  resolution: string;
};

export type TreasuryExceptionEnginePlan = {
  upserts: TreasuryExceptionCandidate[];
  autoResolves: TreasuryExceptionAutoResolvePlan[];
};

export type TreasuryExceptionEngineResult = {
  algorithmVersion: typeof TREASURY_EXCEPTION_ALGORITHM_VERSION;
  companyCode: string;
  asOfCivilDate: string;
  candidates: TreasuryExceptionCandidate[];
  plan: TreasuryExceptionEnginePlan;
};

function moneyOrNull(value: string | null | undefined): TreasuryMoneyString | null {
  if (value == null || value === "") return null;
  return normalizeTreasuryMoneyString(value);
}

function isPositiveOpen(amount: string): boolean {
  return compareTreasuryMoney(normalizeTreasuryMoneyString(amount), "0.00") > 0;
}

function isNegative(amount: string): boolean {
  return compareTreasuryMoney(normalizeTreasuryMoneyString(amount), "0.00") < 0;
}

function isNonZero(amount: string): boolean {
  return compareTreasuryMoney(normalizeTreasuryMoneyString(amount), "0.00") !== 0;
}

function isBeforeOrOn(a: string, b: string): boolean {
  return compareCivilDates(a, b) <= 0;
}

function isStrictlyBefore(a: string, b: string): boolean {
  return compareCivilDates(a, b) < 0;
}

function hoursSince(iso: string | null, nowEpochMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (nowEpochMs - t) / (1000 * 60 * 60);
}

function buildUniqueKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((p) => (p == null || p === "" ? "_" : String(p).trim()))
    .join("|");
}

function candidate(
  partial: Omit<TreasuryExceptionCandidate, "allowsSafeAutoResolve"> & {
    allowsSafeAutoResolve?: boolean;
  }
): TreasuryExceptionCandidate {
  const allows =
    partial.allowsSafeAutoResolve ??
    allowsTreasuryExceptionSafeAutoResolve(partial.type);
  return { ...partial, allowsSafeAutoResolve: allows };
}

function detectExpectedReceiptNotReceived(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const r of input.receivables ?? []) {
    if (r.isCancelled || r.isSettled) continue;
    if (!isPositiveOpen(r.openAmount)) continue;
    if (!r.expectedDate) continue;
    if (!isBeforeOrOn(r.expectedDate, input.asOfCivilDate)) continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "EXPECTED_RECEIPT_NOT_RECEIVED",
          input.companyCode,
          r.officialTitleId,
          r.expectedDate,
        ]),
        type: "EXPECTED_RECEIPT_NOT_RECEIVED",
        severity: "WARNING",
        entityKind: "RECEIVABLE",
        entityId: r.officialTitleId,
        accountId: null,
        nomusExternalId:
          r.nomusExternalId != null ? String(r.nomusExternalId) : null,
        title: "Recebimento esperado não recebido",
        description: `Recebimento esperado em ${r.expectedDate} ainda em aberto.`,
        amount: moneyOrNull(r.openAmount),
        dueAt: r.expectedDate,
        responsibleUserId: r.responsibleUserId ?? null,
        metadata: {
          engineType: "EXPECTED_RECEIPT_NOT_RECEIVED",
          expectedDate: r.expectedDate,
        },
      })
    );
  }
  return out;
}

function detectExpectedPaymentNotMade(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const p of input.payables ?? []) {
    if (p.isCancelled || p.isSettled) continue;
    if (!isPositiveOpen(p.openAmount)) continue;
    if (!p.expectedDate) continue;
    if (!isBeforeOrOn(p.expectedDate, input.asOfCivilDate)) continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "EXPECTED_PAYMENT_NOT_MADE",
          input.companyCode,
          p.officialTitleId,
          p.expectedDate,
        ]),
        type: "EXPECTED_PAYMENT_NOT_MADE",
        severity: "WARNING",
        entityKind: "PAYABLE",
        entityId: p.officialTitleId,
        accountId: null,
        nomusExternalId:
          p.nomusExternalId != null ? String(p.nomusExternalId) : null,
        title: "Pagamento esperado não realizado",
        description: `Pagamento esperado em ${p.expectedDate} ainda em aberto.`,
        amount: moneyOrNull(p.openAmount),
        dueAt: p.expectedDate,
        responsibleUserId: p.responsibleUserId ?? null,
        metadata: {
          engineType: "EXPECTED_PAYMENT_NOT_MADE",
          expectedDate: p.expectedDate,
        },
      })
    );
  }
  return out;
}

function detectOverdueReceivableWithoutAction(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const r of input.receivables ?? []) {
    if (r.isCancelled || r.isSettled) continue;
    if (!isPositiveOpen(r.openAmount)) continue;
    if (!r.dueDate) continue;
    if (!isStrictlyBefore(r.dueDate, input.asOfCivilDate)) continue;
    if (r.hasCollectionAction) continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "OVERDUE_RECEIVABLE_WITHOUT_ACTION",
          input.companyCode,
          r.officialTitleId,
        ]),
        type: "OVERDUE_RECEIVABLE_WITHOUT_ACTION",
        severity: "CRITICAL",
        entityKind: "RECEIVABLE",
        entityId: r.officialTitleId,
        accountId: null,
        nomusExternalId:
          r.nomusExternalId != null ? String(r.nomusExternalId) : null,
        title: "Recebível vencido sem ação",
        description: `Título vencido em ${r.dueDate} sem ação de cobrança registrada.`,
        amount: moneyOrNull(r.openAmount),
        dueAt: r.dueDate,
        responsibleUserId: r.responsibleUserId ?? null,
        metadata: {
          engineType: "OVERDUE_RECEIVABLE_WITHOUT_ACTION",
          dueDate: r.dueDate,
        },
      })
    );
  }
  return out;
}

function detectExpiredPromise(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const pr of input.promises ?? []) {
    const st = pr.status.trim().toUpperCase();
    if (st === "FULFILLED" || st === "CANCELLED" || st === "BROKEN") continue;
    if (!isStrictlyBefore(pr.promisedDate, input.asOfCivilDate)) continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "EXPIRED_PROMISE",
          input.companyCode,
          pr.id,
        ]),
        type: "EXPIRED_PROMISE",
        severity: "WARNING",
        entityKind: "RECEIVABLE",
        entityId: pr.officialTitleId,
        accountId: null,
        nomusExternalId: null,
        title: "Promessa vencida",
        description: `Promessa ${pr.id} com data ${pr.promisedDate} vencida.`,
        amount: moneyOrNull(pr.promisedAmount),
        dueAt: pr.promisedDate,
        responsibleUserId: null,
        metadata: {
          engineType: "EXPIRED_PROMISE",
          promiseId: pr.id,
          promiseStatus: pr.status,
        },
      })
    );
  }
  return out;
}

function detectCriticalPaymentNotProgrammed(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const p of input.payables ?? []) {
    if (p.isCancelled || p.isSettled) continue;
    if (!p.isCritical) continue;
    if (!isPositiveOpen(p.openAmount)) continue;
    if (p.isProgrammed) continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "CRITICAL_PAYMENT_NOT_PROGRAMMED",
          input.companyCode,
          p.officialTitleId,
        ]),
        type: "CRITICAL_PAYMENT_NOT_PROGRAMMED",
        severity: "CRITICAL",
        entityKind: "PAYABLE",
        entityId: p.officialTitleId,
        accountId: null,
        nomusExternalId:
          p.nomusExternalId != null ? String(p.nomusExternalId) : null,
        title: "Pagamento crítico não programado",
        description: "Pagamento crítico em aberto sem programação.",
        amount: moneyOrNull(p.openAmount),
        dueAt: p.dueDate,
        responsibleUserId: p.responsibleUserId ?? null,
        metadata: { engineType: "CRITICAL_PAYMENT_NOT_PROGRAMMED" },
      })
    );
  }
  return out;
}

function detectAccountBelowMinimum(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const a of input.accounts ?? []) {
    const available = normalizeTreasuryMoneyString(a.availableBalance);
    const minimum = normalizeTreasuryMoneyString(a.minimumBalance);
    if (compareTreasuryMoney(available, minimum) >= 0) continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "ACCOUNT_BELOW_MINIMUM",
          input.companyCode,
          a.accountId,
        ]),
        type: "ACCOUNT_BELOW_MINIMUM",
        severity: "CRITICAL",
        entityKind: "ACCOUNT",
        entityId: a.accountId,
        accountId: a.accountId,
        nomusExternalId: null,
        title: "Conta abaixo do mínimo",
        description: `Saldo disponível ${available} abaixo do mínimo ${minimum}.`,
        amount: available,
        dueAt: input.asOfCivilDate,
        responsibleUserId: null,
        metadata: {
          engineType: "ACCOUNT_BELOW_MINIMUM",
          minimumBalance: minimum,
          availableBalance: available,
          code: a.code ?? null,
        },
      })
    );
  }
  return out;
}

function detectProjectionNegative(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const d of input.projectionDays ?? []) {
    if (!isNegative(d.closingBalance)) continue;
    if (d.accountId == null) {
      out.push(
        candidate({
          uniqueKey: buildUniqueKey([
            "CONSOLIDATED_PROJECTION_NEGATIVE",
            input.companyCode,
            d.civilDate,
          ]),
          type: "CONSOLIDATED_PROJECTION_NEGATIVE",
          severity: "CRITICAL",
          entityKind: "PROJECTION",
          entityId: `consolidated:${d.civilDate}`,
          accountId: null,
          nomusExternalId: null,
          title: "Projeção consolidada negativa",
          description: `Saldo projetado consolidado negativo em ${d.civilDate}.`,
          amount: moneyOrNull(d.closingBalance),
          dueAt: d.civilDate,
          responsibleUserId: null,
          metadata: {
            engineType: "CONSOLIDATED_PROJECTION_NEGATIVE",
            civilDate: d.civilDate,
          },
        })
      );
      continue;
    }
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "ACCOUNT_PROJECTION_NEGATIVE",
          input.companyCode,
          d.accountId,
          d.civilDate,
        ]),
        type: "ACCOUNT_PROJECTION_NEGATIVE",
        severity: "WARNING",
        entityKind: "PROJECTION",
        entityId: `${d.accountId}:${d.civilDate}`,
        accountId: d.accountId,
        nomusExternalId: null,
        title: "Projeção negativa por conta",
        description: `Saldo projetado negativo na conta em ${d.civilDate}.`,
        amount: moneyOrNull(d.closingBalance),
        dueAt: d.civilDate,
        responsibleUserId: null,
        metadata: {
          engineType: "ACCOUNT_PROJECTION_NEGATIVE",
          civilDate: d.civilDate,
          accountId: d.accountId,
        },
      })
    );
  }
  return out;
}

function detectStaleBalance(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const a of input.accounts ?? []) {
    const hours = hoursSince(a.lastBalanceAtIso, input.nowEpochMs);
    if (hours == null || hours <= a.staleAfterHours) continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "STALE_BALANCE",
          input.companyCode,
          a.accountId,
        ]),
        type: "STALE_BALANCE",
        severity: "WARNING",
        entityKind: "ACCOUNT",
        entityId: a.accountId,
        accountId: a.accountId,
        nomusExternalId: null,
        title: "Saldo desatualizado",
        description: `Último saldo há mais de ${a.staleAfterHours}h.`,
        amount: moneyOrNull(a.availableBalance),
        dueAt: input.asOfCivilDate,
        responsibleUserId: null,
        metadata: {
          engineType: "STALE_BALANCE",
          lastBalanceAtIso: a.lastBalanceAtIso,
          staleAfterHours: a.staleAfterHours,
          ageHours: Math.floor(hours),
        },
      })
    );
  }
  return out;
}

function detectBankMovementUnidentified(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const m of input.bankMovements ?? []) {
    if (m.identified) continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "BANK_MOVEMENT_UNIDENTIFIED",
          input.companyCode,
          m.id,
        ]),
        type: "BANK_MOVEMENT_UNIDENTIFIED",
        severity: "WARNING",
        entityKind: "RECONCILIATION",
        entityId: m.id,
        accountId: m.accountId,
        nomusExternalId: null,
        title: "Movimento bancário sem identificação",
        description: "Movimento bancário ainda sem identificação.",
        amount: moneyOrNull(m.amount),
        dueAt: input.asOfCivilDate,
        responsibleUserId: null,
        metadata: { engineType: "BANK_MOVEMENT_UNIDENTIFIED", movementId: m.id },
      })
    );
  }
  return out;
}

function detectReconciliationDifference(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const d of input.reconciliationDiffs ?? []) {
    if (!isNonZero(d.differenceAmount)) continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "RECONCILIATION_DIFFERENCE",
          input.companyCode,
          d.id,
        ]),
        type: "RECONCILIATION_DIFFERENCE",
        severity: "CRITICAL",
        entityKind: "RECONCILIATION",
        entityId: d.id,
        accountId: d.accountId,
        nomusExternalId: null,
        title: "Diferença de conciliação",
        description: "Diferença de conciliação diferente de zero.",
        amount: moneyOrNull(d.differenceAmount),
        dueAt: input.asOfCivilDate,
        responsibleUserId: null,
        metadata: {
          engineType: "RECONCILIATION_DIFFERENCE",
          diffId: d.id,
        },
      })
    );
  }
  return out;
}

function detectTransferInTransit(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const t of input.transfers ?? []) {
    if (t.status.trim().toUpperCase() !== "SENT") continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "TRANSFER_IN_TRANSIT",
          input.companyCode,
          t.id,
        ]),
        type: "TRANSFER_IN_TRANSIT",
        severity: "INFO",
        entityKind: "TRANSFER",
        entityId: t.id,
        accountId: t.fromAccountId,
        nomusExternalId: null,
        title: "Transferência em trânsito",
        description: `Transferência ${t.id} enviada e ainda em trânsito.`,
        amount: moneyOrNull(t.amount),
        dueAt: input.asOfCivilDate,
        responsibleUserId: null,
        metadata: {
          engineType: "TRANSFER_IN_TRANSIT",
          fromAccountId: t.fromAccountId,
          toAccountId: t.toAccountId,
          status: t.status,
        },
      })
    );
  }
  return out;
}

function detectTitleWithoutResponsible(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const r of input.receivables ?? []) {
    if (r.isCancelled || r.isSettled) continue;
    if (!isPositiveOpen(r.openAmount)) continue;
    if (r.responsibleUserId && r.responsibleUserId.trim()) continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "TITLE_WITHOUT_RESPONSIBLE",
          input.companyCode,
          "RECEIVABLE",
          r.officialTitleId,
        ]),
        type: "TITLE_WITHOUT_RESPONSIBLE",
        severity: "WARNING",
        entityKind: "RECEIVABLE",
        entityId: r.officialTitleId,
        accountId: null,
        nomusExternalId:
          r.nomusExternalId != null ? String(r.nomusExternalId) : null,
        title: "Título sem responsável",
        description: "Recebível em aberto sem responsável atribuído.",
        amount: moneyOrNull(r.openAmount),
        dueAt: r.dueDate,
        responsibleUserId: null,
        metadata: {
          engineType: "TITLE_WITHOUT_RESPONSIBLE",
          side: "RECEIVABLE",
        },
      })
    );
  }
  for (const p of input.payables ?? []) {
    if (p.isCancelled || p.isSettled) continue;
    if (!isPositiveOpen(p.openAmount)) continue;
    if (p.responsibleUserId && p.responsibleUserId.trim()) continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "TITLE_WITHOUT_RESPONSIBLE",
          input.companyCode,
          "PAYABLE",
          p.officialTitleId,
        ]),
        type: "TITLE_WITHOUT_RESPONSIBLE",
        severity: "WARNING",
        entityKind: "PAYABLE",
        entityId: p.officialTitleId,
        accountId: null,
        nomusExternalId:
          p.nomusExternalId != null ? String(p.nomusExternalId) : null,
        title: "Título sem responsável",
        description: "Pagável em aberto sem responsável atribuído.",
        amount: moneyOrNull(p.openAmount),
        dueAt: p.dueDate,
        responsibleUserId: null,
        metadata: {
          engineType: "TITLE_WITHOUT_RESPONSIBLE",
          side: "PAYABLE",
        },
      })
    );
  }
  return out;
}

function detectSyncDelayed(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const s of input.syncFreshness ?? []) {
    const hours = hoursSince(s.lastSuccessAtIso, input.nowEpochMs);
    if (hours != null && hours <= s.maxAgeHours) continue;
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "SYNC_DELAYED",
          input.companyCode,
          s.side,
        ]),
        type: "SYNC_DELAYED",
        severity: "WARNING",
        entityKind: "OTHER",
        entityId: `sync:${s.side}`,
        accountId: null,
        nomusExternalId: null,
        title: "Sincronização atrasada",
        description:
          hours == null
            ? `Sem sucesso de sync ${s.side} registrado.`
            : `Sync ${s.side} atrasado (>${s.maxAgeHours}h).`,
        amount: null,
        dueAt: input.asOfCivilDate,
        responsibleUserId: null,
        metadata: {
          engineType: "SYNC_DELAYED",
          side: s.side,
          lastSuccessAtIso: s.lastSuccessAtIso,
          maxAgeHours: s.maxAgeHours,
          ageHours: hours == null ? null : Math.floor(hours),
        },
      })
    );
  }
  return out;
}

function detectSuspectedDuplicate(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const d of input.duplicateSuspects ?? []) {
    if (d.entityIds.length < 2) continue;
    const sortedIds = [...d.entityIds].map((x) => x.trim()).sort();
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "SUSPECTED_DUPLICATE",
          input.companyCode,
          d.key,
        ]),
        type: "SUSPECTED_DUPLICATE",
        severity: "CRITICAL",
        entityKind: d.entityKind,
        entityId: sortedIds[0]!,
        accountId: null,
        nomusExternalId: null,
        title: "Duplicidade suspeita",
        description: `Possível duplicidade entre ${sortedIds.length} entidades.`,
        amount: moneyOrNull(d.amount),
        dueAt: input.asOfCivilDate,
        responsibleUserId: null,
        allowsSafeAutoResolve: false,
        metadata: {
          engineType: "SUSPECTED_DUPLICATE",
          duplicateKey: d.key,
          entityIds: sortedIds,
        },
      })
    );
  }
  return out;
}

function detectFinancialChangeAfterClosing(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const out: TreasuryExceptionCandidate[] = [];
  for (const c of input.postClosingChanges ?? []) {
    out.push(
      candidate({
        uniqueKey: buildUniqueKey([
          "FINANCIAL_CHANGE_AFTER_CLOSING",
          input.companyCode,
          c.id,
        ]),
        type: "FINANCIAL_CHANGE_AFTER_CLOSING",
        severity: "CRITICAL",
        entityKind: c.entityKind,
        entityId: c.entityId,
        accountId: null,
        nomusExternalId: null,
        title: "Mudança financeira após fechamento",
        description: `Alteração após fechamento de ${c.closedCivilDate}.`,
        amount: moneyOrNull(c.amount ?? null),
        dueAt: c.closedCivilDate,
        responsibleUserId: null,
        allowsSafeAutoResolve: false,
        metadata: {
          engineType: "FINANCIAL_CHANGE_AFTER_CLOSING",
          changeId: c.id,
          closedCivilDate: c.closedCivilDate,
          changedAtIso: c.changedAtIso,
        },
      })
    );
  }
  return out;
}

function collectCandidates(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionCandidate[] {
  const all = [
    ...detectExpectedReceiptNotReceived(input),
    ...detectExpectedPaymentNotMade(input),
    ...detectOverdueReceivableWithoutAction(input),
    ...detectExpiredPromise(input),
    ...detectCriticalPaymentNotProgrammed(input),
    ...detectAccountBelowMinimum(input),
    ...detectProjectionNegative(input),
    ...detectStaleBalance(input),
    ...detectBankMovementUnidentified(input),
    ...detectReconciliationDifference(input),
    ...detectTransferInTransit(input),
    ...detectTitleWithoutResponsible(input),
    ...detectSyncDelayed(input),
    ...detectSuspectedDuplicate(input),
    ...detectFinancialChangeAfterClosing(input),
  ];
  all.sort((a, b) => (a.uniqueKey < b.uniqueKey ? -1 : a.uniqueKey > b.uniqueKey ? 1 : 0));
  return all;
}

function planAutoResolves(
  openExceptions: TreasuryExceptionEngineOpenRow[],
  activeKeys: Set<string>
): TreasuryExceptionAutoResolvePlan[] {
  const plans: TreasuryExceptionAutoResolvePlan[] = [];
  for (const row of openExceptions) {
    if (!isTreasuryExceptionOpenCause(row.status)) continue;
    if (activeKeys.has(row.uniqueKey)) continue;
    if (!allowsTreasuryExceptionSafeAutoResolve(row.type)) continue;
    plans.push({
      id: row.id,
      uniqueKey: row.uniqueKey,
      type: row.type,
      version: row.version,
      resolution: TREASURY_EXCEPTION_AUTO_RESOLVE_RESOLUTION,
    });
  }
  plans.sort((a, b) =>
    a.uniqueKey < b.uniqueKey ? -1 : a.uniqueKey > b.uniqueKey ? 1 : 0
  );
  return plans;
}

/**
 * Executa o motor: gera candidatos e plano de upsert/auto-resolve.
 * Idempotente e determinístico para o mesmo snapshot de entrada.
 */
export function runTreasuryExceptionEngine(
  input: TreasuryExceptionEngineInput
): TreasuryExceptionEngineResult {
  const candidates = collectCandidates(input);
  const activeKeys = new Set(candidates.map((c) => c.uniqueKey));
  const autoResolves = planAutoResolves(input.openExceptions ?? [], activeKeys);
  return {
    algorithmVersion: TREASURY_EXCEPTION_ALGORITHM_VERSION,
    companyCode: input.companyCode,
    asOfCivilDate: input.asOfCivilDate,
    candidates,
    plan: {
      upserts: candidates,
      autoResolves,
    },
  };
}
