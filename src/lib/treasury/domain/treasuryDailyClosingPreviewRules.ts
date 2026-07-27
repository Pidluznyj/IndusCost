/**
 * Regras puras — preview do fechamento diário (gates, ressalvas, hash).
 * Sem Prisma / sem I/O.
 */

import { createHash } from "node:crypto";
import type {
  TreasuryDailyClosingGateItemDto,
  TreasuryDailyClosingPendencyItemDto,
  TreasuryDailyClosingPreviewAccountDto,
  TreasuryDailyClosingPreviewDto,
} from "../contracts/treasuryDto.js";
import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type { TreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import {
  TREASURY_DAILY_CLOSING_ABSOLUTE_BLOCK_CODES,
  TREASURY_DAILY_CLOSING_CAVEAT_REQUIRED_CODES,
  type TreasuryClosingStatus,
  type TreasuryDailyClosingAbsoluteBlockCode,
  type TreasuryDailyClosingCaveatRequiredCode,
  type TreasuryDailyClosingWarningCode,
} from "../contracts/treasuryEnums.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  negateTreasuryMoney,
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

const ZERO: TreasuryMoneyString = "0.00";

export type TreasuryDailyClosingPreviewAccountFact = {
  accountId: string;
  code: string;
  name: string;
  includeInConsolidated: boolean;
  openingBalance: string;
  realizedInflows: string;
  realizedOutflows: string;
  pendenciesAmount: string;
  closingBalance: string;
  observedBalance: string | null;
  reconciledBalance: string | null;
  minimumBalance: string;
  allowNegativeBalance: boolean;
  lastBalanceAtIso: string | null;
  balanceAgeHours: number | null;
};

export type TreasuryDailyClosingPreviewPendencyFact = {
  side: "RECEIVABLE" | "PAYABLE";
  officialTitleId: string;
  nomusExternalId: number | null;
  counterpartyName: string | null;
  openAmount: string;
  dueDate: string | null;
  expectedDate: string | null;
  accountId: string | null;
};

export type TreasuryDailyClosingPreviewMovementFact = {
  id: string;
  accountId: string | null;
  amount: string;
  label: string;
};

export type TreasuryDailyClosingPreviewPromiseFact = {
  id: string;
  officialTitleId: string;
  promisedAmount: string;
  promisedDate: string;
  status: string;
};

export type TreasuryDailyClosingPreviewTransferFact = {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  status: string;
};

export type TreasuryDailyClosingPreviewFacts = {
  civilDate: TreasuryCivilDate;
  companyCode: string | null;
  generatedAtIso: TreasuryTimestampIso;
  staleBalanceHours: number;
  syncMaxAgeHours: number;
  syncAgeHours: number | null;
  currentClosingStatus: TreasuryClosingStatus | null;
  hasSourceData: boolean;
  openSuspectedDuplicateCount: number;
  accounts: TreasuryDailyClosingPreviewAccountFact[];
  pendingReceivables: TreasuryDailyClosingPreviewPendencyFact[];
  pendingPayables: TreasuryDailyClosingPreviewPendencyFact[];
  unreconciledMovements: TreasuryDailyClosingPreviewMovementFact[];
  expiredPromises: TreasuryDailyClosingPreviewPromiseFact[];
  transfersInTransit: TreasuryDailyClosingPreviewTransferFact[];
};

function money(value: string | null | undefined): TreasuryMoneyString {
  if (value == null || value === "") return ZERO;
  return normalizeTreasuryMoneyString(value);
}

function differenceOf(
  observed: string | null,
  reconciled: string | null
): TreasuryMoneyString | null {
  if (observed == null || reconciled == null) return null;
  const o = money(observed);
  const r = money(reconciled);
  return addTreasuryMoney(o, negateTreasuryMoney(r));
}

function isDueOnOrBefore(
  civilDate: string,
  dueDate: string | null,
  expectedDate: string | null
): boolean {
  const ref = expectedDate ?? dueDate;
  if (!ref) return true;
  return ref <= civilDate;
}

function gate(
  code: string,
  severity: "INFO" | "WARNING" | "CRITICAL",
  title: string,
  description: string,
  opts?: {
    amount?: string | null;
    accountId?: string | null;
    entityId?: string | null;
    requiresCaveat?: boolean;
    blocksClose?: boolean;
  }
): TreasuryDailyClosingGateItemDto {
  return {
    code,
    severity,
    title,
    description,
    amount: opts?.amount != null ? money(opts.amount) : null,
    accountId: opts?.accountId ?? null,
    entityId: opts?.entityId ?? null,
    requiresCaveat: opts?.requiresCaveat ?? false,
    blocksClose: opts?.blocksClose ?? false,
  };
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableSerialize(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`)
    .join(",")}}`;
}

/** Hash SHA-256 determinístico da fonte do preview. */
export function buildTreasuryDailyClosingSourceHash(
  parts: Record<string, unknown>
): string {
  return createHash("sha256").update(stableSerialize(parts)).digest("hex");
}

export function isTreasuryDailyClosingAbsoluteBlockCode(
  code: string
): code is TreasuryDailyClosingAbsoluteBlockCode {
  return (
    TREASURY_DAILY_CLOSING_ABSOLUTE_BLOCK_CODES as readonly string[]
  ).includes(code);
}

export function isTreasuryDailyClosingCaveatRequiredCode(
  code: string
): code is TreasuryDailyClosingCaveatRequiredCode {
  return (
    TREASURY_DAILY_CLOSING_CAVEAT_REQUIRED_CODES as readonly string[]
  ).includes(code);
}

export function buildTreasuryDailyClosingPreview(
  facts: TreasuryDailyClosingPreviewFacts
): TreasuryDailyClosingPreviewDto {
  const absoluteBlocks: TreasuryDailyClosingGateItemDto[] = [];
  const warnings: TreasuryDailyClosingGateItemDto[] = [];
  const staleBalances: TreasuryDailyClosingGateItemDto[] = [];
  const expiredPromises: TreasuryDailyClosingGateItemDto[] = [];
  const transfersInTransit: TreasuryDailyClosingGateItemDto[] = [];
  const unreconciledMovements: TreasuryDailyClosingGateItemDto[] = [];
  const caveatCodes = new Set<string>();

  if (!facts.hasSourceData) {
    absoluteBlocks.push(
      gate(
        "SOURCE_DATA_UNAVAILABLE",
        "CRITICAL",
        "Fonte de dados indisponível",
        "Não há base suficiente (contas/saldos) para calcular o fechamento.",
        { blocksClose: true }
      )
    );
  }

  if (facts.currentClosingStatus === "CLOSED") {
    absoluteBlocks.push(
      gate(
        "DAY_ALREADY_CLOSED",
        "CRITICAL",
        "Dia já fechado",
        "Já existe fechamento CLOSED para esta data. Reabra para nova versão.",
        { blocksClose: true }
      )
    );
  }

  if (facts.openSuspectedDuplicateCount > 0) {
    absoluteBlocks.push(
      gate(
        "OPEN_SUSPECTED_DUPLICATE",
        "CRITICAL",
        "Duplicidade suspeita em aberto",
        `${facts.openSuspectedDuplicateCount} exceção(ões) de duplicidade aberta(s). Resolva antes de fechar.`,
        { blocksClose: true }
      )
    );
  }

  if (
    facts.syncAgeHours != null &&
    facts.syncAgeHours > facts.syncMaxAgeHours
  ) {
    const item = gate(
      "SYNC_DELAYED",
      "WARNING",
      "Sincronização atrasada",
      `Última sync há ${facts.syncAgeHours.toFixed(1)}h (limite ${facts.syncMaxAgeHours}h).`,
      { requiresCaveat: true }
    );
    warnings.push(item);
    caveatCodes.add("SYNC_DELAYED");
  }

  const accounts: TreasuryDailyClosingPreviewAccountDto[] = [];
  let sumOpening = ZERO;
  let sumIn = ZERO;
  let sumOut = ZERO;
  let sumPend = ZERO;
  let sumClosing = ZERO;
  let sumObserved = ZERO;
  let sumReconciled: TreasuryMoneyString | null = ZERO;
  let hasAnyReconciled = false;

  for (const a of facts.accounts) {
    const observed = a.observedBalance == null ? null : money(a.observedBalance);
    const reconciled =
      a.reconciledBalance == null ? null : money(a.reconciledBalance);
    const diff = differenceOf(observed, reconciled);
    const stale =
      a.balanceAgeHours != null &&
      a.balanceAgeHours > facts.staleBalanceHours;

    if (observed == null) {
      absoluteBlocks.push(
        gate(
          "MISSING_OBSERVED_BALANCE",
          "CRITICAL",
          "Saldo observado ausente",
          `Conta ${a.code} sem snapshot de saldo observado.`,
          { accountId: a.accountId, blocksClose: true }
        )
      );
    } else if (
      !a.allowNegativeBalance &&
      compareTreasuryMoney(observed, ZERO) < 0
    ) {
      absoluteBlocks.push(
        gate(
          "NEGATIVE_BALANCE_FORBIDDEN",
          "CRITICAL",
          "Saldo negativo não permitido",
          `Conta ${a.code} com saldo observado negativo e allowNegativeBalance=false.`,
          {
            accountId: a.accountId,
            amount: observed,
            blocksClose: true,
          }
        )
      );
    }

    if (
      diff != null &&
      compareTreasuryMoney(diff, ZERO) !== 0
    ) {
      const item = gate(
        "RECONCILIATION_DIFFERENCE",
        "WARNING",
        "Diferença de conciliação",
        `Conta ${a.code}: observado ≠ conciliado (${diff}).`,
        {
          accountId: a.accountId,
          amount: diff,
          requiresCaveat: true,
        }
      );
      warnings.push(item);
      caveatCodes.add("RECONCILIATION_DIFFERENCE");
    }

    if (stale) {
      const item = gate(
        "STALE_BALANCE",
        "WARNING",
        "Saldo desatualizado",
        `Conta ${a.code}: último saldo há ${a.balanceAgeHours?.toFixed(1)}h (limite ${facts.staleBalanceHours}h).`,
        { accountId: a.accountId, requiresCaveat: true }
      );
      staleBalances.push(item);
      caveatCodes.add("STALE_BALANCE");
    }

    if (
      observed != null &&
      compareTreasuryMoney(observed, money(a.minimumBalance)) < 0
    ) {
      const item = gate(
        "ACCOUNT_BELOW_MINIMUM",
        "WARNING",
        "Saldo abaixo do mínimo",
        `Conta ${a.code} abaixo do mínimo operacional.`,
        {
          accountId: a.accountId,
          amount: observed,
          requiresCaveat: true,
        }
      );
      warnings.push(item);
      caveatCodes.add("ACCOUNT_BELOW_MINIMUM");
    }

    const accountDto: TreasuryDailyClosingPreviewAccountDto = {
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      openingBalance: money(a.openingBalance),
      realizedInflows: money(a.realizedInflows),
      realizedOutflows: money(a.realizedOutflows),
      pendenciesAmount: money(a.pendenciesAmount),
      closingBalance: money(a.closingBalance),
      observedBalance: observed,
      reconciledBalance: reconciled,
      differenceAmount: diff,
      minimumBalance: money(a.minimumBalance),
      allowNegativeBalance: a.allowNegativeBalance,
      balanceStale: stale,
      lastBalanceAt: a.lastBalanceAtIso,
    };
    accounts.push(accountDto);

    if (a.includeInConsolidated) {
      sumOpening = addTreasuryMoney(sumOpening, accountDto.openingBalance);
      sumIn = addTreasuryMoney(sumIn, accountDto.realizedInflows);
      sumOut = addTreasuryMoney(sumOut, accountDto.realizedOutflows);
      sumPend = addTreasuryMoney(sumPend, accountDto.pendenciesAmount);
      sumClosing = addTreasuryMoney(sumClosing, accountDto.closingBalance);
      if (observed != null) {
        sumObserved = addTreasuryMoney(sumObserved, observed);
      }
      if (reconciled != null) {
        hasAnyReconciled = true;
        sumReconciled = addTreasuryMoney(sumReconciled!, reconciled);
      }
    }
  }

  const pendingReceivables: TreasuryDailyClosingPendencyItemDto[] = [];
  for (const p of facts.pendingReceivables) {
    const due = isDueOnOrBefore(facts.civilDate, p.dueDate, p.expectedDate);
    pendingReceivables.push({
      side: "RECEIVABLE",
      officialTitleId: p.officialTitleId,
      nomusExternalId: p.nomusExternalId,
      counterpartyName: p.counterpartyName,
      openAmount: money(p.openAmount),
      dueDate: p.dueDate,
      expectedDate: p.expectedDate,
      accountId: p.accountId,
      dueOrExpectedOnOrBeforeCivilDate: due,
    });
    if (due) {
      caveatCodes.add("PENDING_RECEIVABLE");
    } else {
      warnings.push(
        gate(
          "PENDING_RECEIVABLE_FUTURE" satisfies TreasuryDailyClosingWarningCode,
          "INFO",
          "Recebimento futuro pendente",
          `Título ${p.officialTitleId} com vencimento/esperado após ${facts.civilDate}.`,
          {
            amount: p.openAmount,
            entityId: p.officialTitleId,
            accountId: p.accountId,
          }
        )
      );
    }
  }

  const pendingPayables: TreasuryDailyClosingPendencyItemDto[] = [];
  for (const p of facts.pendingPayables) {
    const due = isDueOnOrBefore(facts.civilDate, p.dueDate, p.expectedDate);
    pendingPayables.push({
      side: "PAYABLE",
      officialTitleId: p.officialTitleId,
      nomusExternalId: p.nomusExternalId,
      counterpartyName: p.counterpartyName,
      openAmount: money(p.openAmount),
      dueDate: p.dueDate,
      expectedDate: p.expectedDate,
      accountId: p.accountId,
      dueOrExpectedOnOrBeforeCivilDate: due,
    });
    if (due) {
      caveatCodes.add("PENDING_PAYABLE");
    } else {
      warnings.push(
        gate(
          "PENDING_PAYABLE_FUTURE" satisfies TreasuryDailyClosingWarningCode,
          "INFO",
          "Pagamento futuro pendente",
          `Título ${p.officialTitleId} com vencimento/programado após ${facts.civilDate}.`,
          {
            amount: p.openAmount,
            entityId: p.officialTitleId,
            accountId: p.accountId,
          }
        )
      );
    }
  }

  // Pendências do dia (due) viram itens de aviso com ressalva exigida.
  for (const p of pendingReceivables.filter((x) => x.dueOrExpectedOnOrBeforeCivilDate)) {
    warnings.push(
      gate(
        "PENDING_RECEIVABLE",
        "WARNING",
        "Recebimento pendente",
        `Recebimento aberto${p.counterpartyName ? ` — ${p.counterpartyName}` : ""}.`,
        {
          amount: p.openAmount,
          entityId: p.officialTitleId,
          accountId: p.accountId,
          requiresCaveat: true,
        }
      )
    );
  }
  for (const p of pendingPayables.filter((x) => x.dueOrExpectedOnOrBeforeCivilDate)) {
    warnings.push(
      gate(
        "PENDING_PAYABLE",
        "WARNING",
        "Pagamento pendente",
        `Pagamento aberto${p.counterpartyName ? ` — ${p.counterpartyName}` : ""}.`,
        {
          amount: p.openAmount,
          entityId: p.officialTitleId,
          accountId: p.accountId,
          requiresCaveat: true,
        }
      )
    );
  }

  for (const m of facts.unreconciledMovements) {
    const item = gate(
      "UNRECONCILED_MOVEMENT",
      "WARNING",
      "Movimento não conciliado",
      m.label,
      {
        amount: m.amount,
        accountId: m.accountId,
        entityId: m.id,
        requiresCaveat: true,
      }
    );
    unreconciledMovements.push(item);
    caveatCodes.add("UNRECONCILED_MOVEMENT");
  }

  for (const p of facts.expiredPromises) {
    const item = gate(
      "EXPIRED_PROMISE",
      "WARNING",
      "Promessa vencida",
      `Promessa ${p.id} (${p.status}) em ${p.promisedDate}.`,
      {
        amount: p.promisedAmount,
        entityId: p.id,
        requiresCaveat: true,
      }
    );
    expiredPromises.push(item);
    caveatCodes.add("EXPIRED_PROMISE");
  }

  for (const t of facts.transfersInTransit) {
    const item = gate(
      "TRANSFER_IN_TRANSIT",
      "WARNING",
      "Transferência em trânsito",
      `Transferência ${t.id} (SENT) de ${t.fromAccountId} para ${t.toAccountId}.`,
      {
        amount: t.amount,
        entityId: t.id,
        accountId: t.fromAccountId,
        requiresCaveat: true,
      }
    );
    transfersInTransit.push(item);
    caveatCodes.add("TRANSFER_IN_TRANSIT");
  }

  const requiredCaveatCodes = [...caveatCodes].sort();
  const hasAbsolute = absoluteBlocks.length > 0;
  const canCloseWithCaveats = !hasAbsolute;
  const canCloseWithoutCaveats =
    !hasAbsolute && requiredCaveatCodes.length === 0;

  const sourceHash = buildTreasuryDailyClosingSourceHash({
    civilDate: facts.civilDate,
    companyCode: facts.companyCode,
    accounts: facts.accounts.map((a) => ({
      id: a.accountId,
      observed: a.observedBalance,
      reconciled: a.reconciledBalance,
      in: a.realizedInflows,
      out: a.realizedOutflows,
      last: a.lastBalanceAtIso,
    })),
    ar: facts.pendingReceivables.map((p) => p.officialTitleId).sort(),
    ap: facts.pendingPayables.map((p) => p.officialTitleId).sort(),
    promises: facts.expiredPromises.map((p) => p.id).sort(),
    transfers: facts.transfersInTransit.map((t) => t.id).sort(),
    movements: facts.unreconciledMovements.map((m) => m.id).sort(),
    syncAgeHours: facts.syncAgeHours,
    closingStatus: facts.currentClosingStatus,
  });

  const consolidatedDiff =
    hasAnyReconciled && sumReconciled != null
      ? differenceOf(sumObserved, sumReconciled)
      : null;

  return {
    ok: true,
    civilDate: facts.civilDate,
    companyCode: facts.companyCode,
    sourceHash,
    generatedAt: facts.generatedAtIso,
    summary: {
      openingBalance: sumOpening,
      realizedInflows: sumIn,
      realizedOutflows: sumOut,
      pendenciesAmount: sumPend,
      closingBalance: sumClosing,
      observedBalance: sumObserved,
      reconciledBalance: hasAnyReconciled ? sumReconciled : null,
      differenceAmount: consolidatedDiff,
      accountCount: accounts.length,
      pendingReceivablesCount: pendingReceivables.length,
      pendingPayablesCount: pendingPayables.length,
      absoluteBlockCount: absoluteBlocks.length,
      warningCount: warnings.length,
      caveatRequiredCount: requiredCaveatCodes.length,
    },
    accounts,
    absoluteBlocks,
    warnings,
    pendingReceivables,
    pendingPayables,
    unreconciledMovements,
    staleBalances,
    expiredPromises,
    transfersInTransit,
    canCloseWithoutCaveats,
    canCloseWithCaveats,
    requiredCaveatCodes,
  };
}
