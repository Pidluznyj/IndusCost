/**
 * Compositor puro da experiência guiada “Tesouraria de hoje”.
 * Monta DTO leigo a partir das APIs agregadas (dashboard + preview de fechamento).
 * Sem Prisma / sem I/O.
 */

import type {
  TreasuryDailyClosingPreviewDto,
  TreasuryDashboardDto,
  TreasuryGuidedTodayAccountDto,
  TreasuryGuidedTodayAttentionDto,
  TreasuryGuidedTodayDto,
  TreasuryGuidedTodayStepDto,
  TreasuryGuidedTodayStepStatus,
} from "../contracts/treasuryDto.js";
import {
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  sumTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import { deriveTreasuryDailyAccountRoutineStatus } from "./treasuryDailyAccountRoutineRules.js";

export const TREASURY_GUIDED_TODAY_TITLE = "Tesouraria de hoje" as const;

export const TREASURY_GUIDED_TODAY_UI_BASE = "/finance/treasury" as const;

export type TreasuryGuidedTodayAccountMeta = {
  id: string;
  name: string;
  code: string;
  institutionName: string | null;
};

export type TreasuryGuidedTodayBuildInput = {
  dashboard: TreasuryDashboardDto;
  closingPreview: TreasuryDailyClosingPreviewDto | null;
  accountMeta?: readonly TreasuryGuidedTodayAccountMeta[];
};

function money(value: string | null | undefined): TreasuryMoneyString {
  return normalizeTreasuryMoneyString(
    value == null || value === "" ? "0.00" : value
  );
}

function isNonZero(value: string | null | undefined): boolean {
  if (value == null || value === "") return false;
  return compareTreasuryMoney(money(value), "0.00") !== 0;
}

function stepStatus(
  done: boolean,
  needsAttention: boolean
): TreasuryGuidedTodayStepStatus {
  if (needsAttention) return "NEEDS_ATTENTION";
  if (done) return "DONE";
  return "PENDING";
}

function metaById(
  meta: readonly TreasuryGuidedTodayAccountMeta[] | undefined
): Map<string, TreasuryGuidedTodayAccountMeta> {
  const map = new Map<string, TreasuryGuidedTodayAccountMeta>();
  for (const row of meta ?? []) map.set(row.id, row);
  return map;
}

function isDayClosed(
  closingPreview: TreasuryDailyClosingPreviewDto | null
): boolean {
  return (closingPreview?.absoluteBlocks ?? []).some(
    (b) => b.code === "DAY_ALREADY_CLOSED"
  );
}

function buildAccounts(
  input: TreasuryGuidedTodayBuildInput
): TreasuryGuidedTodayAccountDto[] {
  const { dashboard, closingPreview } = input;
  const meta = metaById(input.accountMeta);
  const previewById = new Map(
    (closingPreview?.accounts ?? []).map((a) => [a.accountId, a])
  );
  const dayClosed = isDayClosed(closingPreview);

  return dashboard.accounts.map((acc) => {
    const preview = previewById.get(acc.accountId);
    const info = meta.get(acc.accountId);
    const hasOpening = preview != null || acc.hasSnapshot;
    const openingBalance = hasOpening
      ? (preview?.openingBalance ?? acc.observedBalance)
      : null;
    const informedClosingBalance =
      preview?.observedBalance != null ? preview.observedBalance : null;
    const divergence =
      preview?.differenceAmount ??
      (acc.hasDivergence ? acc.divergence : null);
    const realizedClosingBalance =
      preview?.closingBalance ?? acc.calculatedBalance;

    const status = dayClosed
      ? ("CLOSED" as const)
      : deriveTreasuryDailyAccountRoutineStatus({
          openingBalance,
          closingBankBalance: informedClosingBalance,
          divergence,
          formalClosingStatus: null,
        });

    return {
      accountId: acc.accountId,
      name: info?.name ?? acc.accountName,
      bank: info?.institutionName ?? null,
      openingBalance,
      predictedClosingBalance: dashboard.projectedClosingBalance,
      realizedClosingBalance,
      informedClosingBalance,
      divergence,
      status,
      openHref: `${TREASURY_GUIDED_TODAY_UI_BASE}/accounts/${acc.accountId}/balances`,
    };
  });
}

function buildAttention(
  input: TreasuryGuidedTodayBuildInput,
  accounts: readonly TreasuryGuidedTodayAccountDto[]
): TreasuryGuidedTodayAttentionDto[] {
  const { dashboard, closingPreview } = input;
  const items: TreasuryGuidedTodayAttentionDto[] = [];

  for (const acc of accounts) {
    if (acc.openingBalance == null) {
      items.push({
        id: `missing-opening:${acc.accountId}`,
        code: "MISSING_OPENING_BALANCE",
        message: `Informe o saldo inicial de ${acc.name}.`,
        amount: null,
        accountId: acc.accountId,
        href: `${TREASURY_GUIDED_TODAY_UI_BASE}/today/opening`,
      });
    } else if (acc.informedClosingBalance == null) {
      items.push({
        id: `missing-closing:${acc.accountId}`,
        code: "MISSING_CLOSING_BALANCE",
        message: `Informe o saldo final do banco em ${acc.name}.`,
        amount: null,
        accountId: acc.accountId,
        href: acc.openHref,
      });
    } else if (acc.divergence != null && isNonZero(acc.divergence)) {
      items.push({
        id: `divergence:${acc.accountId}`,
        code: "BALANCE_DIVERGENCE",
        message: `Há diferença entre o saldo do banco e o calculado em ${acc.name}.`,
        amount: acc.divergence,
        accountId: acc.accountId,
        href: `${TREASURY_GUIDED_TODAY_UI_BASE}/bank`,
      });
    }
  }

  if (isNonZero(dashboard.receipts.pendingAmount)) {
    items.push({
      id: "pending-receipts",
      code: "PENDING_RECEIPT",
      message: `${dashboard.receipts.pendingTitleCount} recebimento(s) previsto(s) ainda não baixado(s).`,
      amount: money(dashboard.receipts.pendingAmount),
      accountId: null,
      href: `${TREASURY_GUIDED_TODAY_UI_BASE}/today/receivables`,
    });
  }

  if (isNonZero(dashboard.payments.pendingAmount)) {
    items.push({
      id: "pending-payments",
      code: "PENDING_PAYMENT",
      message: `${dashboard.payments.pendingTitleCount} pagamento(s) previsto(s) ainda não baixado(s).`,
      amount: money(dashboard.payments.pendingAmount),
      accountId: null,
      href: `${TREASURY_GUIDED_TODAY_UI_BASE}/today/payables`,
    });
  }

  for (const ex of dashboard.priorityExceptions) {
    const type = String(ex.type ?? "");
    if (type === "OFX_UNMATCHED" || type === "BANK_MOVEMENT_UNIDENTIFIED") {
      items.push({
        id: `ofx:${ex.id}`,
        code: "UNIDENTIFIED_BANK_MOVEMENT",
        message: "Há movimento do banco sem identificação.",
        amount: null,
        accountId: ex.accountId,
        href: `${TREASURY_GUIDED_TODAY_UI_BASE}/bank`,
      });
    }
    if (
      ex.accountId == null &&
      (type.includes("RECEIV") ||
        type.includes("PAYAB") ||
        /sem conta/i.test(ex.title))
    ) {
      items.push({
        id: `unmapped:${ex.id}`,
        code: "UNMAPPED_TITLE",
        message: "Há título sem conta mapeada. Vincule a conta correta.",
        amount: null,
        accountId: null,
        href: `${TREASURY_GUIDED_TODAY_UI_BASE}/accounts`,
      });
    }
  }

  for (const alert of dashboard.alerts) {
    const kind = String(alert.kind ?? "");
    const text = `${alert.title} ${alert.description}`;
    if (
      kind === "OFX_UNMATCHED" ||
      kind === "BANK_MOVEMENT_UNIDENTIFIED" ||
      /sem identificação|não identificado/i.test(text)
    ) {
      items.push({
        id: `alert-ofx:${alert.id}`,
        code: "UNIDENTIFIED_BANK_MOVEMENT",
        message: "Há movimento do banco sem identificação.",
        amount: alert.amount,
        accountId: alert.accountId,
        href: `${TREASURY_GUIDED_TODAY_UI_BASE}/bank`,
      });
    }
    if (
      alert.accountId == null &&
      /sem conta|sem mapeamento|não mapead/i.test(text)
    ) {
      items.push({
        id: `alert-unmapped:${alert.id}`,
        code: "UNMAPPED_TITLE",
        message: "Há título sem conta mapeada. Vincule a conta correta.",
        amount: alert.amount,
        accountId: null,
        href: `${TREASURY_GUIDED_TODAY_UI_BASE}/accounts`,
      });
    }
  }

  for (const mov of closingPreview?.unreconciledMovements ?? []) {
    items.push({
      id: `unrec:${mov.code}:${mov.accountId ?? "x"}:${mov.entityId ?? mov.title}`,
      code: "UNIDENTIFIED_BANK_MOVEMENT",
      message: "Há movimento do banco sem identificação.",
      amount: mov.amount,
      accountId: mov.accountId,
      href: `${TREASURY_GUIDED_TODAY_UI_BASE}/bank`,
    });
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function buildSteps(
  input: TreasuryGuidedTodayBuildInput,
  accounts: readonly TreasuryGuidedTodayAccountDto[],
  attention: readonly TreasuryGuidedTodayAttentionDto[]
): TreasuryGuidedTodayStepDto[] {
  const { closingPreview } = input;
  const dayClosed = isDayClosed(closingPreview);
  const missingOpening = attention.some(
    (a) => a.code === "MISSING_OPENING_BALANCE"
  );
  const missingClosing = attention.some(
    (a) => a.code === "MISSING_CLOSING_BALANCE"
  );
  const hasDivergence = attention.some((a) => a.code === "BALANCE_DIVERGENCE");
  const pendingReceipts = attention.some((a) => a.code === "PENDING_RECEIPT");
  const pendingPayments = attention.some((a) => a.code === "PENDING_PAYMENT");
  const unidentifiedOfx = attention.some(
    (a) => a.code === "UNIDENTIFIED_BANK_MOVEMENT"
  );

  const allOpeningsDone =
    accounts.length > 0 && accounts.every((a) => a.openingBalance != null);
  const allClosingsDone =
    accounts.length > 0 &&
    accounts.every(
      (a) => a.openingBalance == null || a.informedClosingBalance != null
    );
  const closeBlocked =
    Boolean(closingPreview) &&
    !closingPreview!.canCloseWithCaveats &&
    !closingPreview!.canCloseWithoutCaveats;

  const closeStatus: TreasuryGuidedTodayStepStatus = dayClosed
    ? "DONE"
    : !allOpeningsDone || !allClosingsDone
      ? "PENDING"
      : stepStatus(false, closeBlocked || hasDivergence || missingClosing);

  return [
    {
      id: "OPENING_BALANCES",
      order: 1,
      title: "Informar saldos iniciais",
      status: stepStatus(allOpeningsDone, missingOpening),
      continueHref: `${TREASURY_GUIDED_TODAY_UI_BASE}/today/opening`,
      continueLabel: "Continuar",
    },
    {
      id: "REVIEW_RECEIPTS",
      order: 2,
      title: "Revisar recebimentos",
      status: stepStatus(!pendingReceipts, pendingReceipts),
      continueHref: `${TREASURY_GUIDED_TODAY_UI_BASE}/today/receivables`,
      continueLabel: "Continuar",
    },
    {
      id: "REVIEW_PAYMENTS",
      order: 3,
      title: "Revisar pagamentos",
      status: stepStatus(!pendingPayments, pendingPayments),
      continueHref: `${TREASURY_GUIDED_TODAY_UI_BASE}/today/payables`,
      continueLabel: "Continuar",
    },
    {
      id: "CLOSING_BALANCES",
      order: 4,
      title: "Informar saldos finais",
      status: stepStatus(allClosingsDone && allOpeningsDone, missingClosing),
      continueHref: `${TREASURY_GUIDED_TODAY_UI_BASE}/accounts`,
      continueLabel: "Continuar",
    },
    {
      id: "RESOLVE_DIVERGENCES",
      order: 5,
      title: "Resolver divergências",
      status: !allClosingsDone
        ? "PENDING"
        : stepStatus(!hasDivergence && !unidentifiedOfx, hasDivergence || unidentifiedOfx),
      continueHref: `${TREASURY_GUIDED_TODAY_UI_BASE}/bank`,
      continueLabel: "Continuar",
    },
    {
      id: "CLOSE_DAY",
      order: 6,
      title: "Fechar o dia",
      status: closeStatus,
      continueHref: `${TREASURY_GUIDED_TODAY_UI_BASE}/closing`,
      continueLabel: "Continuar",
    },
  ];
}

function resolveConsolidatedOpening(
  input: TreasuryGuidedTodayBuildInput,
  accounts: readonly TreasuryGuidedTodayAccountDto[]
): TreasuryMoneyString | null {
  if (input.closingPreview?.summary.openingBalance != null) {
    return money(input.closingPreview.summary.openingBalance);
  }
  if (accounts.length === 0) return null;
  if (accounts.every((a) => a.openingBalance != null)) {
    return sumTreasuryMoney(accounts.map((a) => money(a.openingBalance!)));
  }
  return input.dashboard.currentBalance;
}

/**
 * Monta a experiência guiada a partir das respostas agregadas já carregadas.
 */
export function buildTreasuryGuidedTodayExperience(
  input: TreasuryGuidedTodayBuildInput
): TreasuryGuidedTodayDto {
  const { dashboard, closingPreview } = input;
  const accounts = buildAccounts(input);
  const attention = buildAttention(input, accounts);
  const steps = buildSteps(input, accounts, attention);

  return {
    ok: true,
    civilDate: dashboard.civilDate,
    asOf: dashboard.asOf,
    title: TREASURY_GUIDED_TODAY_TITLE,
    empty: accounts.length === 0,
    consolidated: {
      openingBalance: resolveConsolidatedOpening(input, accounts),
      plannedInflows: money(dashboard.receipts.plannedAmount),
      realizedInflows: money(dashboard.receipts.realizedAmount),
      plannedOutflows: money(dashboard.payments.plannedAmount),
      realizedOutflows: money(dashboard.payments.realizedAmount),
      predictedClosingBalance: dashboard.projectedClosingBalance,
      realizedClosingBalance:
        closingPreview?.summary.closingBalance ?? dashboard.calculatedBalance,
      informedClosingBalance:
        closingPreview?.summary.observedBalance ?? dashboard.observedBalance,
      divergence:
        closingPreview?.summary.differenceAmount ?? dashboard.divergence,
    },
    steps,
    accounts,
    attention,
  };
}
