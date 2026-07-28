/**
 * Motor canônico puro da posição diária de caixa (por conta + consolidado).
 *
 * Reutiliza:
 * - saldos iniciais/finais informados (snapshots / rotina diária);
 * - CR/CP oficiais (previsto × realizado, baixa parcial);
 * - ledger manual (previsto/realizado);
 * - transferências internas (efeito por conta; neutras no consolidado);
 * - OFX (confirma / explica / só conta via ledger explícito);
 * - status da rotina diária;
 * - anti-dupla contagem via vínculos OFX↔título/ledger.
 *
 * Sem Prisma, sem I/O — insumos já carregados pelo caller.
 */

import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import { isTreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type {
  TreasuryDailyCashAccountPositionDto,
  TreasuryDailyCashConsolidatedPositionDto,
  TreasuryDailyCashPendencyDto,
  TreasuryDailyCashPositionDto,
  TreasuryDailyCashTransfersDto,
} from "../contracts/treasuryDto.js";
import type { TreasuryDailyAccountRoutineStatus } from "../contracts/treasuryEnums.js";
import type { TreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import {
  computeTreasuryDailyDivergence,
  deriveTreasuryDailyAccountRoutineStatus,
} from "./treasuryDailyAccountRoutineRules.js";
import { TreasuryDomainError } from "./treasuryErrors.js";
import {
  resolveTreasuryFinancialIdentities,
  type TreasuryFinancialClaim,
} from "./treasuryFinancialIdentityRules.js";

export const TREASURY_DAILY_CASH_ALGORITHM_VERSION = "1.0.0" as const;

export type TreasuryDailyCashAccountSeed = {
  accountId: string;
  code: string;
  name: string;
  includeInConsolidated: boolean;
  /** Null = não informado (não assume zero). */
  openingBalance: string | null;
  informedClosingBalance: string | null;
  lastUpdatedAt?: string | null;
};

/** Título CR/CP do dia — baixa parcial usa realizedAmount líquido do dia. */
export type TreasuryDailyCashTitleSeed = {
  id: string;
  accountId: string;
  side: "AR" | "AP";
  plannedAmount: string;
  realizedAmount: string;
  officialTitleId?: string | null;
  isCancelled?: boolean;
};

export type TreasuryDailyCashLedgerSeed = {
  id: string;
  accountId: string;
  /** CREDIT = entrada; DEBIT = saída (ledger local). */
  direction: "CREDIT" | "DEBIT";
  amount: string;
  status: "ACTIVE" | "REVERSED" | string;
  layer: "PLANNED" | "REALIZED";
  /** Pernas de transferência não entram como local — use transfer seeds. */
  transferGroupId?: string | null;
  /** Quando preenchido, OFX de origem não pode somar de novo. */
  sourceBankMovementId?: string | null;
  officialTitleId?: string | null;
};

export type TreasuryDailyCashTransferSeed = {
  id: string;
  transferGroupId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  layer: "PLANNED" | "REALIZED";
  isCancelled?: boolean;
};

export type TreasuryDailyCashOfxSeed = {
  id: string;
  accountId: string;
  amount: string;
  direction: "CREDIT" | "DEBIT";
  /**
   * RECONCILED — confirma título/ledger; não soma.
   * UNRECONCILED — não altera calculado; pendência explicativa.
   * CONVERTED_TO_LEDGER — só o lançamento manual compõe o saldo.
   */
  reconciliationStatus: "UNRECONCILED" | "RECONCILED" | "CONVERTED_TO_LEDGER";
  matchedOfficialTitleId?: string | null;
  matchedLedgerEntryId?: string | null;
  convertedLedgerEntryId?: string | null;
};

export type TreasuryDailyCashEngineInput = {
  civilDate: TreasuryCivilDate;
  asOf: TreasuryTimestampIso | string | Date;
  accounts: readonly TreasuryDailyCashAccountSeed[];
  titles: readonly TreasuryDailyCashTitleSeed[];
  ledgerEntries: readonly TreasuryDailyCashLedgerSeed[];
  transfers: readonly TreasuryDailyCashTransferSeed[];
  ofxMovements: readonly TreasuryDailyCashOfxSeed[];
  formalClosingStatusByAccountId?: Readonly<
    Record<string, "OPEN" | "CLOSED" | "REOPENED" | null | undefined>
  >;
};

type AccountBuckets = {
  plannedReceivables: TreasuryMoneyString;
  realizedReceivables: TreasuryMoneyString;
  plannedPayables: TreasuryMoneyString;
  realizedPayables: TreasuryMoneyString;
  plannedLocalInflows: TreasuryMoneyString;
  plannedLocalOutflows: TreasuryMoneyString;
  realizedLocalInflows: TreasuryMoneyString;
  realizedLocalOutflows: TreasuryMoneyString;
  plannedTransferIn: TreasuryMoneyString;
  plannedTransferOut: TreasuryMoneyString;
  realizedTransferIn: TreasuryMoneyString;
  realizedTransferOut: TreasuryMoneyString;
  pendencies: TreasuryDailyCashPendencyDto[];
};

function money(value: string | null | undefined): TreasuryMoneyString {
  return normalizeTreasuryMoneyString(
    value == null || value === "" ? "0" : value
  );
}

function assertMoney(value: string, field: string): TreasuryMoneyString {
  try {
    return normalizeTreasuryMoneyString(value);
  } catch {
    throw new TreasuryDomainError(
      "INVALID_MONEY",
      `${field} inválido (string decimal com até 2 casas).`,
      field
    );
  }
}

function emptyBuckets(): AccountBuckets {
  return {
    plannedReceivables: "0.00",
    realizedReceivables: "0.00",
    plannedPayables: "0.00",
    realizedPayables: "0.00",
    plannedLocalInflows: "0.00",
    plannedLocalOutflows: "0.00",
    realizedLocalInflows: "0.00",
    realizedLocalOutflows: "0.00",
    plannedTransferIn: "0.00",
    plannedTransferOut: "0.00",
    realizedTransferIn: "0.00",
    realizedTransferOut: "0.00",
    pendencies: [],
  };
}

function transfersDto(
  received: TreasuryMoneyString,
  sent: TreasuryMoneyString
): TreasuryDailyCashTransfersDto {
  return {
    received,
    sent,
    net: subtractTreasuryMoney(received, sent),
  };
}

function toIso(asOf: TreasuryTimestampIso | string | Date): TreasuryTimestampIso {
  if (asOf instanceof Date) {
    if (Number.isNaN(asOf.getTime())) {
      throw new TreasuryDomainError(
        "INVALID_TIMESTAMP",
        "asOf inválido.",
        "asOf"
      );
    }
    return asOf.toISOString();
  }
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) {
    throw new TreasuryDomainError(
      "INVALID_TIMESTAMP",
      "asOf inválido.",
      "asOf"
    );
  }
  return d.toISOString();
}

function maxIso(
  a: string | null | undefined,
  b: string | null | undefined
): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a >= b ? a : b;
}

/**
 * Previsto final:
 * saldo inicial + CR previsto − CP previsto
 * + entradas manuais previstas − saídas manuais previstas
 * + transferências previstas recebidas − transferências previstas enviadas
 */
export function computeTreasuryDailyCashPredictedClosing(input: {
  openingBalance: string;
  plannedReceivables: string;
  plannedPayables: string;
  plannedLocalInflows: string;
  plannedLocalOutflows: string;
  plannedTransferIn: string;
  plannedTransferOut: string;
}): TreasuryMoneyString {
  let predicted = assertMoney(input.openingBalance, "openingBalance");
  predicted = addTreasuryMoney(predicted, money(input.plannedReceivables));
  predicted = subtractTreasuryMoney(predicted, money(input.plannedPayables));
  predicted = addTreasuryMoney(predicted, money(input.plannedLocalInflows));
  predicted = subtractTreasuryMoney(predicted, money(input.plannedLocalOutflows));
  predicted = addTreasuryMoney(predicted, money(input.plannedTransferIn));
  predicted = subtractTreasuryMoney(predicted, money(input.plannedTransferOut));
  return predicted;
}

/**
 * Realizado calculado:
 * saldo inicial + CR realizado − CP realizado
 * + entradas manuais realizadas − saídas manuais realizadas
 * + transferências recebidas − transferências enviadas
 */
export function computeTreasuryDailyCashRealizedClosing(input: {
  openingBalance: string;
  realizedReceivables: string;
  realizedPayables: string;
  realizedLocalInflows: string;
  realizedLocalOutflows: string;
  realizedTransferIn: string;
  realizedTransferOut: string;
}): TreasuryMoneyString {
  let realized = assertMoney(input.openingBalance, "openingBalance");
  realized = addTreasuryMoney(realized, money(input.realizedReceivables));
  realized = subtractTreasuryMoney(realized, money(input.realizedPayables));
  realized = addTreasuryMoney(realized, money(input.realizedLocalInflows));
  realized = subtractTreasuryMoney(realized, money(input.realizedLocalOutflows));
  realized = addTreasuryMoney(realized, money(input.realizedTransferIn));
  realized = subtractTreasuryMoney(realized, money(input.realizedTransferOut));
  return realized;
}

/**
 * Anti-dupla contagem: OFX conciliado com título remove o PREVISTO do mesmo
 * título no período (movimento confirmado). O realizado oficial permanece;
 * o valor do OFX nunca entra no saldo calculado.
 *
 * Usa o resolvedor de identidade com saldo aberto zerado para alinhar à
 * precedência canônica (RECONCILED > FORECAST).
 */
export function resolveTreasuryDailyCashSuppressedTitleIds(
  titles: readonly TreasuryDailyCashTitleSeed[],
  ofxMovements: readonly TreasuryDailyCashOfxSeed[]
): ReadonlySet<string> {
  const reconciledTitleIds = new Set<string>();
  for (const m of ofxMovements) {
    if (m.reconciliationStatus !== "RECONCILED") continue;
    if (m.matchedOfficialTitleId) {
      reconciledTitleIds.add(m.matchedOfficialTitleId);
    }
  }
  if (reconciledTitleIds.size === 0) return new Set();

  const claims: TreasuryFinancialClaim[] = [];
  for (const t of titles) {
    if (t.isCancelled) continue;
    const titleKey = t.officialTitleId ?? t.id;
    if (!reconciledTitleIds.has(titleKey)) continue;
    if (money(t.plannedAmount) === "0.00") continue;
    claims.push({
      id: `forecast:${t.id}`,
      source: "FORECAST",
      side: t.side,
      amount: t.plannedAmount,
      openBalance: "0.00",
      officialTitleId: titleKey,
    });
    claims.push({
      id: `ofx-confirm:${t.id}`,
      source: "RECONCILED_MOVEMENT",
      side: t.side,
      amount: t.realizedAmount || t.plannedAmount,
      settledAmount: t.realizedAmount || t.plannedAmount,
      officialTitleId: titleKey,
      reconciliationMatchId: `confirm:${t.id}`,
    });
  }
  if (claims.length === 0) return new Set();

  const resolution = resolveTreasuryFinancialIdentities(claims);
  const suppressed = new Set<string>();
  for (const id of resolution.suppressedClaimIds) {
    if (id.startsWith("forecast:")) suppressed.add(id.slice("forecast:".length));
  }
  return suppressed;
}

function accumulateTitles(
  bucketsByAccount: Map<string, AccountBuckets>,
  titles: readonly TreasuryDailyCashTitleSeed[],
  suppressedTitleIds: ReadonlySet<string>
): void {
  for (const t of titles) {
    if (t.isCancelled) continue;
    const b = bucketsByAccount.get(t.accountId);
    if (!b) continue;

    const planned = money(t.plannedAmount);
    const realized = money(t.realizedAmount);
    if (planned !== "0.00" && realized !== "0.00") {
      b.pendencies.push({
        code: "PARTIAL_SETTLEMENT",
        message: `Baixa parcial no título ${t.id}: previsto ${planned}, realizado ${realized}.`,
        amount: realized,
        accountId: t.accountId,
        sourceId: t.id,
      });
    }

    // OFX conciliado com o título: realizado oficial permanece; previsto do mesmo
    // título/período não soma (suprimido). OFX em si nunca adiciona valor.
    const suppressPlanned = suppressedTitleIds.has(t.id);

    if (t.side === "AR") {
      if (!suppressPlanned) {
        b.plannedReceivables = addTreasuryMoney(b.plannedReceivables, planned);
      }
      b.realizedReceivables = addTreasuryMoney(b.realizedReceivables, realized);
    } else {
      if (!suppressPlanned) {
        b.plannedPayables = addTreasuryMoney(b.plannedPayables, planned);
      }
      b.realizedPayables = addTreasuryMoney(b.realizedPayables, realized);
    }
  }
}

function accumulateLedger(
  bucketsByAccount: Map<string, AccountBuckets>,
  entries: readonly TreasuryDailyCashLedgerSeed[],
  ofxById: Map<string, TreasuryDailyCashOfxSeed>
): void {
  for (const e of entries) {
    if (e.status !== "ACTIVE") continue;
    if (e.transferGroupId) continue;
    const b = bucketsByAccount.get(e.accountId);
    if (!b) continue;

    // Se OFX origem ainda não convertido, o ledger explícito com vínculo conta;
    // OFX não soma (tratado em accumulateOfx).
    if (e.sourceBankMovementId) {
      const ofx = ofxById.get(e.sourceBankMovementId);
      if (ofx && ofx.reconciliationStatus === "RECONCILED") {
        // Conciliado com ledger: só ledger (este) compõe; OFX não.
      }
    }

    const amount = assertMoney(e.amount, "ledger.amount");
    if (e.layer === "PLANNED") {
      if (e.direction === "CREDIT") {
        b.plannedLocalInflows = addTreasuryMoney(b.plannedLocalInflows, amount);
      } else {
        b.plannedLocalOutflows = addTreasuryMoney(b.plannedLocalOutflows, amount);
      }
    } else {
      if (e.direction === "CREDIT") {
        b.realizedLocalInflows = addTreasuryMoney(b.realizedLocalInflows, amount);
      } else {
        b.realizedLocalOutflows = addTreasuryMoney(
          b.realizedLocalOutflows,
          amount
        );
      }
    }
  }
}

function accumulateTransfers(
  bucketsByAccount: Map<string, AccountBuckets>,
  transfers: readonly TreasuryDailyCashTransferSeed[]
): void {
  for (const t of transfers) {
    if (t.isCancelled) continue;
    const amount = assertMoney(t.amount, "transfer.amount");
    const from = bucketsByAccount.get(t.fromAccountId);
    const to = bucketsByAccount.get(t.toAccountId);
    if (t.layer === "PLANNED") {
      if (from) {
        from.plannedTransferOut = addTreasuryMoney(from.plannedTransferOut, amount);
      }
      if (to) {
        to.plannedTransferIn = addTreasuryMoney(to.plannedTransferIn, amount);
      }
    } else {
      if (from) {
        from.realizedTransferOut = addTreasuryMoney(
          from.realizedTransferOut,
          amount
        );
      }
      if (to) {
        to.realizedTransferIn = addTreasuryMoney(to.realizedTransferIn, amount);
      }
    }
  }
}

/**
 * OFX:
 * - RECONCILED → não altera saldo (confirmação).
 * - UNRECONCILED → não altera saldo; pendência.
 * - CONVERTED_TO_LEDGER → não altera saldo (ledger já compõe); exige vínculo.
 */
function accumulateOfx(
  bucketsByAccount: Map<string, AccountBuckets>,
  movements: readonly TreasuryDailyCashOfxSeed[],
  ledgerById: Map<string, TreasuryDailyCashLedgerSeed>
): void {
  for (const m of movements) {
    const b = bucketsByAccount.get(m.accountId);
    if (!b) continue;
    const amount = assertMoney(m.amount, "ofx.amount");

    if (m.reconciliationStatus === "UNRECONCILED") {
      b.pendencies.push({
        code: "UNRECONCILED_OFX",
        message: `Movimento OFX ${m.id} sem correspondência — possível explicação da divergência.`,
        amount,
        accountId: m.accountId,
        sourceId: m.id,
      });
      continue;
    }

    if (m.reconciliationStatus === "CONVERTED_TO_LEDGER") {
      const ledgerId = m.convertedLedgerEntryId ?? m.matchedLedgerEntryId;
      if (!ledgerId || !ledgerById.has(ledgerId)) {
        b.pendencies.push({
          code: "OTHER",
          message: `OFX ${m.id} marcado como convertido sem lançamento manual vinculado.`,
          amount,
          accountId: m.accountId,
          sourceId: m.id,
        });
      }
      // Valor não soma aqui — só o ledger.
      continue;
    }

    // RECONCILED: confirmação apenas.
  }
}

function buildAccountPosition(input: {
  account: TreasuryDailyCashAccountSeed;
  civilDate: TreasuryCivilDate;
  buckets: AccountBuckets;
  formalClosingStatus: "OPEN" | "CLOSED" | "REOPENED" | null;
}): TreasuryDailyCashAccountPositionDto {
  const { account, civilDate, buckets } = input;
  const opening = account.openingBalance;
  const informed = account.informedClosingBalance;

  const pendencies = [...buckets.pendencies];
  if (opening == null) {
    pendencies.unshift({
      code: "MISSING_OPENING_BALANCE",
      message: "Saldo inicial não informado.",
      amount: null,
      accountId: account.accountId,
      sourceId: null,
    });
  }
  if (informed == null && opening != null) {
    pendencies.push({
      code: "MISSING_CLOSING_BALANCE",
      message: "Saldo final bancário não informado.",
      amount: null,
      accountId: account.accountId,
      sourceId: null,
    });
  }

  let predicted: TreasuryMoneyString | null = null;
  let realized: TreasuryMoneyString | null = null;
  let divergence: TreasuryMoneyString | null = null;

  if (opening != null) {
    const openingMoney = assertMoney(opening, "openingBalance");
    predicted = computeTreasuryDailyCashPredictedClosing({
      openingBalance: openingMoney,
      plannedReceivables: buckets.plannedReceivables,
      plannedPayables: buckets.plannedPayables,
      plannedLocalInflows: buckets.plannedLocalInflows,
      plannedLocalOutflows: buckets.plannedLocalOutflows,
      plannedTransferIn: buckets.plannedTransferIn,
      plannedTransferOut: buckets.plannedTransferOut,
    });
    realized = computeTreasuryDailyCashRealizedClosing({
      openingBalance: openingMoney,
      realizedReceivables: buckets.realizedReceivables,
      realizedPayables: buckets.realizedPayables,
      realizedLocalInflows: buckets.realizedLocalInflows,
      realizedLocalOutflows: buckets.realizedLocalOutflows,
      realizedTransferIn: buckets.realizedTransferIn,
      realizedTransferOut: buckets.realizedTransferOut,
    });
    if (informed != null) {
      divergence = computeTreasuryDailyDivergence({
        informedClosingBankBalance: informed,
        realizedClosingBalance: realized,
      });
      if (divergence !== "0.00") {
        pendencies.push({
          code: "BALANCE_DIVERGENCE",
          message: `Divergência de caixa: ${divergence}.`,
          amount: divergence,
          accountId: account.accountId,
          sourceId: null,
        });
      }
    }
  }

  const status: TreasuryDailyAccountRoutineStatus =
    deriveTreasuryDailyAccountRoutineStatus({
      openingBalance: opening,
      closingBankBalance: informed,
      divergence,
      formalClosingStatus: input.formalClosingStatus,
      caveats: [],
    });

  return {
    accountId: account.accountId,
    code: account.code,
    name: account.name,
    includeInConsolidated: account.includeInConsolidated,
    civilDate,
    openingBalance: opening == null ? null : assertMoney(opening, "openingBalance"),
    plannedReceivables: buckets.plannedReceivables,
    realizedReceivables: buckets.realizedReceivables,
    plannedPayables: buckets.plannedPayables,
    realizedPayables: buckets.realizedPayables,
    localInflows: buckets.realizedLocalInflows,
    localOutflows: buckets.realizedLocalOutflows,
    transfers: transfersDto(
      buckets.realizedTransferIn,
      buckets.realizedTransferOut
    ),
    predictedClosingBalance: predicted,
    realizedClosingBalance: realized,
    informedClosingBalance:
      informed == null ? null : assertMoney(informed, "informedClosingBalance"),
    divergence,
    status,
    pendencies,
    lastUpdatedAt: account.lastUpdatedAt ?? null,
  };
}

function sumNullable(
  values: readonly (TreasuryMoneyString | null)[]
): TreasuryMoneyString | null {
  let any = false;
  let total = "0.00";
  for (const v of values) {
    if (v == null) continue;
    any = true;
    total = addTreasuryMoney(total, v);
  }
  return any ? total : null;
}

function consolidate(
  civilDate: TreasuryCivilDate,
  accounts: readonly TreasuryDailyCashAccountPositionDto[]
): TreasuryDailyCashConsolidatedPositionDto {
  const included = accounts.filter((a) => a.includeInConsolidated);
  const pendencies = included.flatMap((a) => a.pendencies);

  const openingBalance = sumNullable(included.map((a) => a.openingBalance));
  const informedClosingBalance = sumNullable(
    included.map((a) => a.informedClosingBalance)
  );
  const predictedClosingBalance = sumNullable(
    included.map((a) => a.predictedClosingBalance)
  );
  const realizedClosingBalance = sumNullable(
    included.map((a) => a.realizedClosingBalance)
  );

  let plannedReceivables = "0.00";
  let realizedReceivables = "0.00";
  let plannedPayables = "0.00";
  let realizedPayables = "0.00";
  let localInflows = "0.00";
  let localOutflows = "0.00";
  let transferReceived = "0.00";
  let transferSent = "0.00";
  let lastUpdatedAt: string | null = null;

  for (const a of included) {
    plannedReceivables = addTreasuryMoney(
      plannedReceivables,
      a.plannedReceivables
    );
    realizedReceivables = addTreasuryMoney(
      realizedReceivables,
      a.realizedReceivables
    );
    plannedPayables = addTreasuryMoney(plannedPayables, a.plannedPayables);
    realizedPayables = addTreasuryMoney(realizedPayables, a.realizedPayables);
    localInflows = addTreasuryMoney(localInflows, a.localInflows);
    localOutflows = addTreasuryMoney(localOutflows, a.localOutflows);
    transferReceived = addTreasuryMoney(transferReceived, a.transfers.received);
    transferSent = addTreasuryMoney(transferSent, a.transfers.sent);
    lastUpdatedAt = maxIso(lastUpdatedAt, a.lastUpdatedAt);
  }

  // Neutras no consolidado: received e sent se cancelam quando todas as pernas
  // estão em contas includeInConsolidated.
  const transfers = transfersDto(transferReceived, transferSent);
  // Força net canônico 0 quando pernas internas batem.
  if (transfers.received === transfers.sent) {
    transfers.net = "0.00";
  }

  let divergence: TreasuryMoneyString | null = null;
  if (informedClosingBalance != null && realizedClosingBalance != null) {
    divergence = computeTreasuryDailyDivergence({
      informedClosingBankBalance: informedClosingBalance,
      realizedClosingBalance: realizedClosingBalance,
    });
  }

  const allClosed =
    included.length > 0 && included.every((a) => a.status === "CLOSED");
  const anyReopened = included.some((a) => a.status === "REOPENED");
  const anyNeeds = included.some((a) => a.status === "NEEDS_REVIEW");
  const anyOpen = included.some(
    (a) => a.status === "OPEN" || a.status === "READY_TO_CLOSE"
  );
  const anyStarted = included.some((a) => a.status !== "NOT_STARTED");

  let status: TreasuryDailyAccountRoutineStatus = "NOT_STARTED";
  if (allClosed) status = "CLOSED";
  else if (anyReopened) status = "REOPENED";
  else if (anyNeeds) status = "NEEDS_REVIEW";
  else if (included.every((a) => a.status === "READY_TO_CLOSE")) {
    status = "READY_TO_CLOSE";
  } else if (anyOpen) status = "OPEN";
  else if (anyStarted) status = "OPEN";

  return {
    civilDate,
    openingBalance,
    plannedReceivables,
    realizedReceivables,
    plannedPayables,
    realizedPayables,
    localInflows,
    localOutflows,
    transfers,
    predictedClosingBalance,
    realizedClosingBalance,
    informedClosingBalance,
    divergence,
    status,
    pendencies,
    accountCount: included.length,
    lastUpdatedAt,
  };
}

/** Executa o motor canônico da posição diária. */
export function calculateTreasuryDailyCashPosition(
  input: TreasuryDailyCashEngineInput
): TreasuryDailyCashPositionDto {
  if (!isTreasuryCivilDate(input.civilDate)) {
    throw new TreasuryDomainError(
      "INVALID_CIVIL_DATE",
      "civilDate inválido (YYYY-MM-DD).",
      "civilDate"
    );
  }
  const asOf = toIso(input.asOf);
  const bucketsByAccount = new Map<string, AccountBuckets>();
  for (const a of input.accounts) {
    bucketsByAccount.set(a.accountId, emptyBuckets());
  }

  const ofxById = new Map(input.ofxMovements.map((m) => [m.id, m]));
  const ledgerById = new Map(input.ledgerEntries.map((e) => [e.id, e]));

  const suppressed = resolveTreasuryDailyCashSuppressedTitleIds(
    input.titles,
    input.ofxMovements
  );

  accumulateTitles(bucketsByAccount, input.titles, suppressed);
  accumulateLedger(bucketsByAccount, input.ledgerEntries, ofxById);
  accumulateTransfers(bucketsByAccount, input.transfers);
  accumulateOfx(bucketsByAccount, input.ofxMovements, ledgerById);

  const accounts: TreasuryDailyCashAccountPositionDto[] = input.accounts.map(
    (account) =>
      buildAccountPosition({
        account,
        civilDate: input.civilDate,
        buckets: bucketsByAccount.get(account.accountId) ?? emptyBuckets(),
        formalClosingStatus:
          input.formalClosingStatusByAccountId?.[account.accountId] ?? null,
      })
  );

  return {
    civilDate: input.civilDate,
    asOf,
    algorithmVersion: TREASURY_DAILY_CASH_ALGORITHM_VERSION,
    accounts,
    consolidated: consolidate(input.civilDate, accounts),
  };
}
