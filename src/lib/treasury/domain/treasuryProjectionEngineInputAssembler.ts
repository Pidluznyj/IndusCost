/**
 * Montagem PURA do input do motor de projeção a partir de linhas já carregadas.
 * Sem Prisma, sem I/O — testável isoladamente. O loader server (`.server.ts`)
 * busca os dados reais e delega a montagem aqui.
 *
 * Regras de segurança:
 * - Nunca inventa conta sintética: se não há conta real, `accounts` volta vazio
 *   (o serviço lança validação clara "Nenhuma conta elegível").
 * - `fallbackAccountId` é sempre um accountId REAL das contas carregadas, ou null.
 * - Dinheiro sempre string decimal normalizada; datas sempre civil `YYYY-MM-DD`.
 * - Baixas oficiais NÃO viram `settlements` separados aqui: o motor projeta o
 *   saldo em aberto do próprio título (evita dupla contagem realizado × previsto).
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type {
  TreasuryProjectionAccountBase,
  TreasuryProjectionLedgerSeed,
  TreasuryProjectionPayableSeed,
  TreasuryProjectionReceivableSeed,
  TreasuryProjectionTransferSeed,
} from "./treasuryProjectionEngine.js";
import type { TreasuryLedgerDirection } from "../contracts/treasuryEnums.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

/** Valor monetário aceito das linhas Prisma (Decimal, string ou number). */
export type TreasuryAssemblerDecimalLike =
  | { toFixed(digits: number): string }
  | string
  | number
  | null
  | undefined;

function money(value: TreasuryAssemblerDecimalLike): string {
  if (value == null) return "0.00";
  if (typeof value === "number") return normalizeTreasuryMoneyString(value.toFixed(2));
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

/** Título já traz civil string (`YYYY-MM-DD`) ou Date UTC-meia-noite; normaliza. */
function civil(value: Date | string | null | undefined): string | null {
  return toCivilDateKey(value ?? null);
}

// ---------------------------------------------------------------------------
// Linhas de entrada (subconjuntos estruturais mínimos — testes montam fácil)
// ---------------------------------------------------------------------------

export type ProjectionAccountInputRow = {
  id: string;
  code: string;
  name: string | null;
  includeInConsolidated: boolean;
  allowNegativeBalance: boolean;
  minimumBalance: TreasuryAssemblerDecimalLike;
};

/** Último snapshot de saldo por conta (origem do saldo de abertura). */
export type ProjectionAccountBalanceInputRow = {
  availableBalance: TreasuryAssemblerDecimalLike;
  blockedBalance: TreasuryAssemblerDecimalLike;
  investmentsBalance: TreasuryAssemblerDecimalLike;
  usedLimit: TreasuryAssemblerDecimalLike;
};

export type ProjectionAccountBundle = {
  account: ProjectionAccountInputRow;
  /** null = conta sem snapshot de saldo → abertura tratada como 0,00. */
  balance: ProjectionAccountBalanceInputRow | null;
};

/** Complemento operacional (datas/conta/status por cenário). */
export type ProjectionComplementInputRow = {
  plannedAccountId: string | null;
  expectedDate: Date | string | null;
  confirmedDate: Date | string | null;
  scheduledDate: Date | string | null;
  status?: string | null;
};

/** Promessa ativa de recebimento (define data provável do AR). */
export type ProjectionActivePromiseInputRow = {
  promisedDate: Date | string | null;
  status: string | null;
};

export type ProjectionReceivableInputRow = {
  id: string;
  externalId: number;
  installmentNumber: number | null;
  dueDate: Date | string | null;
  originalAmount: TreasuryAssemblerDecimalLike;
  openBalance: TreasuryAssemblerDecimalLike;
  isCancelledOrRemovedFromSource: boolean;
};

export type ProjectionPayableInputRow = {
  id: string;
  externalId: number;
  installmentNumber: number | null;
  dueDate: Date | string | null;
  nomusScheduleDate: Date | string | null;
  originalAmount: TreasuryAssemblerDecimalLike;
  openBalance: TreasuryAssemblerDecimalLike;
  isCancelledOrRemovedFromSource: boolean;
};

export type ProjectionReceivableBundle = {
  view: ProjectionReceivableInputRow;
  complement: ProjectionComplementInputRow | null;
  activePromise: ProjectionActivePromiseInputRow | null;
};

export type ProjectionPayableBundle = {
  view: ProjectionPayableInputRow;
  complement: ProjectionComplementInputRow | null;
};

export type ProjectionLedgerInputRow = {
  id: string;
  accountId: string;
  civilDate: Date | string;
  amount: TreasuryAssemblerDecimalLike;
  direction: TreasuryLedgerDirection;
  nature?: string | null;
  status: string;
  transferGroupId: string | null;
};

export type ProjectionTransferInputRow = {
  id: string;
  transferGroupId: string;
  fromAccountId: string;
  toAccountId: string;
  civilDate: Date | string;
  sentCivilDate: Date | string | null;
  receivedCivilDate: Date | string | null;
  amount: TreasuryAssemblerDecimalLike;
  status: string;
  cancelledAt: Date | null;
};

export type AssembleTreasuryProjectionEngineInput = {
  accounts: ProjectionAccountBundle[];
  receivables: ProjectionReceivableBundle[];
  payables: ProjectionPayableBundle[];
  ledgerEntries: ProjectionLedgerInputRow[];
  transfers: ProjectionTransferInputRow[];
};

export type AssembledTreasuryProjectionEngineInput = {
  accounts: TreasuryProjectionAccountBase[];
  receivables: TreasuryProjectionReceivableSeed[];
  payables: TreasuryProjectionPayableSeed[];
  settlements: [];
  expectations: [];
  promises: [];
  programming: [];
  ledgerEntries: TreasuryProjectionLedgerSeed[];
  transfers: TreasuryProjectionTransferSeed[];
  fallbackAccountId: string | null;
};

function hasPositiveOpenBalance(value: string): boolean {
  // "0.00" ou negativo (saldo credor raro) → não projeta movimento futuro.
  return !value.startsWith("-") && value !== "0.00";
}

function mapAccount(bundle: ProjectionAccountBundle): TreasuryProjectionAccountBase {
  const { account, balance } = bundle;
  return {
    accountId: account.id,
    code: account.code,
    name: account.name ?? undefined,
    includeInConsolidated: account.includeInConsolidated,
    allowNegativeBalance: account.allowNegativeBalance,
    minimumBalance: money(account.minimumBalance),
    openingBalance: money(balance?.availableBalance),
    blockedBalance: balance ? money(balance.blockedBalance) : undefined,
    investmentsBalance: balance ? money(balance.investmentsBalance) : undefined,
    usedLimit: balance ? money(balance.usedLimit) : undefined,
  };
}

function mapReceivable(
  bundle: ProjectionReceivableBundle
): TreasuryProjectionReceivableSeed {
  const { view, complement, activePromise } = bundle;
  return {
    id: view.id,
    officialTitleId: view.id,
    nomusExternalId: view.externalId,
    accountId: complement?.plannedAccountId ?? null,
    dueDate: civil(view.dueDate),
    expectedDate: complement ? civil(complement.expectedDate) : null,
    confirmedDate: complement ? civil(complement.confirmedDate) : null,
    activePromiseDate: activePromise ? civil(activePromise.promisedDate) : null,
    activePromiseStatus: activePromise?.status ?? null,
    originalAmount: money(view.originalAmount),
    openBalance: money(view.openBalance),
    installmentNumber: view.installmentNumber,
    isCancelled: view.isCancelledOrRemovedFromSource,
  };
}

function mapPayable(bundle: ProjectionPayableBundle): TreasuryProjectionPayableSeed {
  const { view, complement } = bundle;
  // Programação local (complemento) tem prioridade; senão a agenda Nomus do título.
  const scheduledDate = complement
    ? civil(complement.scheduledDate) ?? civil(view.nomusScheduleDate)
    : civil(view.nomusScheduleDate);
  return {
    id: view.id,
    officialTitleId: view.id,
    nomusExternalId: view.externalId,
    accountId: complement?.plannedAccountId ?? null,
    dueDate: civil(view.dueDate),
    expectedDate: complement ? civil(complement.expectedDate) : null,
    confirmedDate: complement ? civil(complement.confirmedDate) : null,
    scheduledDate,
    programmingStatus: complement?.status ?? null,
    originalAmount: money(view.originalAmount),
    openBalance: money(view.openBalance),
    installmentNumber: view.installmentNumber,
    isCancelled: view.isCancelledOrRemovedFromSource,
  };
}

function mapLedger(
  row: ProjectionLedgerInputRow,
  knownAccountIds: Set<string>
): TreasuryProjectionLedgerSeed | null {
  if (!knownAccountIds.has(row.accountId)) return null;
  const civilDate = civil(row.civilDate);
  if (!civilDate) return null;
  return {
    id: row.id,
    accountId: row.accountId,
    civilDate,
    amount: money(row.amount),
    direction: row.direction,
    nature: row.nature ?? undefined,
    status: row.status,
    transferGroupId: row.transferGroupId ?? null,
  };
}

function mapTransfer(
  row: ProjectionTransferInputRow,
  knownAccountIds: Set<string>
): TreasuryProjectionTransferSeed | null {
  // Só interessa se ao menos uma perna toca conta conhecida (consolidação neutra).
  if (!knownAccountIds.has(row.fromAccountId) && !knownAccountIds.has(row.toAccountId)) {
    return null;
  }
  const civilDate = civil(row.civilDate);
  if (!civilDate) return null;
  return {
    id: row.id,
    transferGroupId: row.transferGroupId,
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    civilDate,
    amount: money(row.amount),
    isCancelled: row.cancelledAt != null || row.status === "CANCELLED",
    status: normalizeTransferStatus(row.status),
    outCivilDate: civil(row.sentCivilDate),
    inCivilDate: civil(row.receivedCivilDate),
  };
}

const TRANSFER_STATUSES = new Set([
  "FORECAST",
  "SCHEDULED",
  "SENT",
  "RECEIVED",
  "RECONCILED",
  "CANCELLED",
]);

function normalizeTransferStatus(
  status: string
): TreasuryProjectionTransferSeed["status"] {
  return TRANSFER_STATUSES.has(status)
    ? (status as TreasuryProjectionTransferSeed["status"])
    : undefined;
}

/**
 * Monta o input do motor. Se `accounts` estiver vazio, devolve tudo vazio e
 * fallback null — o serviço rejeita com validação clara, sem tentar gravar
 * `accountId` inexistente (causa do bug de FK).
 */
export function assembleTreasuryProjectionEngineInput(
  input: AssembleTreasuryProjectionEngineInput
): AssembledTreasuryProjectionEngineInput {
  const accounts = input.accounts.map(mapAccount);
  const knownAccountIds = new Set(accounts.map((a) => a.accountId));

  const receivables = input.receivables
    .map(mapReceivable)
    .filter((r) => hasPositiveOpenBalance(r.openBalance));
  const payables = input.payables
    .map(mapPayable)
    .filter((p) => hasPositiveOpenBalance(p.openBalance));

  const ledgerEntries = input.ledgerEntries
    .map((row) => mapLedger(row, knownAccountIds))
    .filter((v): v is TreasuryProjectionLedgerSeed => v != null);
  const transfers = input.transfers
    .map((row) => mapTransfer(row, knownAccountIds))
    .filter((v): v is TreasuryProjectionTransferSeed => v != null);

  return {
    accounts,
    receivables,
    payables,
    settlements: [],
    expectations: [],
    promises: [],
    programming: [],
    ledgerEntries,
    transfers,
    fallbackAccountId: accounts[0]?.accountId ?? null,
  };
}
