/**
 * Domínio — fluxo guiado de saldos finais + divergência + fechamento.
 * Reusa rotina diária + TreasuryDailyClosing (sem segundo sistema).
 */

import type {
  TreasuryDailyClosingPreviewDto,
  TreasuryGuidedDailyClosingAccountDto,
  TreasuryGuidedDailyClosingGateSummaryDto,
  TreasuryGuidedDailyClosingInvestigationActionDto,
  TreasuryGuidedDailyClosingSituation,
  TreasuryGuidedDailyClosingWorkspaceDto,
} from "../contracts/treasuryDto.js";
import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import { TreasuryDomainError } from "./treasuryErrors.js";
import {
  emptyTreasuryDailyAccountRoutineDayFlow,
  planTreasuryDailyClosingBankBalance,
  refreshTreasuryDailyAccountRoutineCalculations,
  type TreasuryDailyAccountRoutineDayFlow,
  type TreasuryDailyAccountRoutineState,
} from "./treasuryDailyAccountRoutineRules.js";

export const TREASURY_GUIDED_DAILY_CLOSING_TITLE =
  "Saldo final e fechamento do dia" as const;

export const TREASURY_GUIDED_DAILY_CLOSING_UI_PATH =
  "/finance/treasury/today/closing" as const;

export const TREASURY_GUIDED_DAILY_CLOSING_NEXT_STEP_HREF =
  "/finance/treasury/today" as const;

export const TREASURY_GUIDED_DAILY_CLOSING_SITUATION_LABELS: Record<
  TreasuryGuidedDailyClosingSituation,
  string
> = {
  NEEDS_OPENING: "Informe o saldo inicial",
  READY_TO_INFORM: "Informar saldo final",
  INFORMED_OK: "Saldo conferido",
  HAS_DIVERGENCE: "Há diferença",
  CLOSED: "Dia fechado",
  INACTIVE: "Conta inativa",
};

export const TREASURY_GUIDED_DAILY_CLOSING_INVESTIGATION_ACTIONS: readonly TreasuryGuidedDailyClosingInvestigationActionDto[] =
  [
    {
      id: "IMPORT_STATEMENT",
      label: "Importar extrato",
      href: "/finance/treasury/ofx",
    },
    {
      id: "VIEW_REALIZED_TITLES",
      label: "Ver títulos realizados",
      href: "/finance/treasury/today/receivables",
    },
    {
      id: "VIEW_MANUAL_ENTRIES",
      label: "Ver lançamentos manuais",
      href: "/finance/treasury/manual-entries",
    },
    {
      id: "VIEW_TRANSFERS",
      label: "Ver transferências",
      href: "/finance/treasury/transfers",
    },
    {
      id: "REGISTER_FEE",
      label: "Registrar tarifa",
      href: "/finance/treasury/manual-entries",
    },
    {
      id: "REGISTER_INTEREST",
      label: "Registrar juros",
      href: "/finance/treasury/manual-entries",
    },
    {
      id: "REGISTER_UNIDENTIFIED",
      label: "Registrar movimento não identificado",
      href: "/finance/treasury/bank",
    },
    {
      id: "CLOSE_WITH_CAVEAT",
      label: "Fechar com ressalva",
      href: `${TREASURY_GUIDED_DAILY_CLOSING_UI_PATH}?step=close`,
    },
  ] as const;

function money(value: string): TreasuryMoneyString {
  return normalizeTreasuryMoneyString(value);
}

export type TreasuryGuidedDailyClosingAccountSeed = {
  accountId: string;
  accountCode: string;
  accountName: string;
  bank: string | null;
  companyCode: string | null;
  isActive: boolean;
  opening: { amount: TreasuryMoneyString; version: number } | null;
  closingBank: { amount: TreasuryMoneyString; version: number } | null;
  dayFlow: TreasuryDailyAccountRoutineDayFlow;
  formalClosingStatus: "OPEN" | "CLOSED" | "REOPENED" | null;
};

export type TreasuryGuidedDailyClosingSaveItemInput = {
  accountId: string;
  expectedVersion: number;
  amount: string;
  notes?: string | null;
};

export function formatTreasuryGuidedDailyClosingDivergenceMessage(
  divergence: string | null
): string | null {
  if (divergence == null || divergence === "") return null;
  const d = money(divergence);
  if (compareTreasuryMoney(d, "0.00") === 0) return null;
  const abs =
    compareTreasuryMoney(d, "0.00") < 0
      ? subtractTreasuryMoney("0.00", d)
      : d;
  return `Existe uma diferença de R$ ${abs.replace(".", ",")} nesta conta.`;
}

export function deriveTreasuryGuidedDailyClosingSituation(input: {
  isActive: boolean;
  openingBalance: string | null;
  informedClosingBalance: string | null;
  divergence: string | null;
  formalClosingStatus: "OPEN" | "CLOSED" | "REOPENED" | null;
}): TreasuryGuidedDailyClosingSituation {
  if (!input.isActive) return "INACTIVE";
  if (input.formalClosingStatus === "CLOSED") return "CLOSED";
  if (input.openingBalance == null) return "NEEDS_OPENING";
  if (input.informedClosingBalance == null) return "READY_TO_INFORM";
  if (
    input.divergence != null &&
    compareTreasuryMoney(money(input.divergence), "0.00") !== 0
  ) {
    return "HAS_DIVERGENCE";
  }
  return "INFORMED_OK";
}

export function buildTreasuryGuidedDailyClosingAccountDto(
  seed: TreasuryGuidedDailyClosingAccountSeed
): TreasuryGuidedDailyClosingAccountDto {
  const expectedVersion = Math.max(
    seed.opening?.version ?? 0,
    seed.closingBank?.version ?? 0
  );

  const openingBalance = seed.opening?.amount ?? null;
  let realizedClosingBalance: TreasuryMoneyString | null = null;
  let divergence: TreasuryMoneyString | null = null;

  if (openingBalance != null) {
    const recomputed = refreshTreasuryDailyAccountRoutineCalculations({
      current: {
        accountId: seed.accountId,
        civilDate: "2000-01-01",
        status: "OPEN",
        openingBalance: {
          amount: seed.opening!.amount,
          informedByUserId: "system",
          informedAt: new Date(0).toISOString(),
          version: seed.opening!.version,
        },
        closingBankBalance: seed.closingBank
          ? {
              amount: seed.closingBank.amount,
              informedByUserId: "system",
              informedAt: new Date(0).toISOString(),
              version: seed.closingBank.version,
            }
          : null,
        predictedClosingBalance: null,
        realizedClosingBalance: null,
        divergence: null,
        notes: null,
        caveats: [],
        version: expectedVersion,
        formalClosingId: null,
        formalClosingStatus: seed.formalClosingStatus,
      },
      dayFlow: seed.dayFlow,
    });
    realizedClosingBalance = recomputed.realizedClosingBalance;
    divergence = recomputed.divergence;
  }

  const situation = deriveTreasuryGuidedDailyClosingSituation({
    isActive: seed.isActive,
    openingBalance,
    informedClosingBalance: seed.closingBank?.amount ?? null,
    divergence,
    formalClosingStatus: seed.formalClosingStatus,
  });

  const flow = seed.dayFlow;
  const transfersNet = subtractTreasuryMoney(
    money(flow.realizedTransferIn),
    money(flow.realizedTransferOut)
  );
  const localNet = subtractTreasuryMoney(
    money(flow.realizedLocalInflows),
    money(flow.realizedLocalOutflows)
  );

  return {
    accountId: seed.accountId,
    accountCode: seed.accountCode,
    accountName: seed.accountName,
    bank: seed.bank,
    openingBalance,
    realizedInflows: money(flow.settledReceivables),
    realizedOutflows: money(flow.settledPayables),
    transfersReceived: money(flow.realizedTransferIn),
    transfersSent: money(flow.realizedTransferOut),
    transfersNet,
    localInflows: money(flow.realizedLocalInflows),
    localOutflows: money(flow.realizedLocalOutflows),
    localNet,
    realizedClosingBalance,
    informedClosingBalance: seed.closingBank?.amount ?? null,
    divergence,
    expectedVersion,
    situation,
    situationLabel: TREASURY_GUIDED_DAILY_CLOSING_SITUATION_LABELS[situation],
    divergenceMessage:
      formatTreasuryGuidedDailyClosingDivergenceMessage(divergence),
    canInformClosing:
      seed.isActive &&
      openingBalance != null &&
      seed.formalClosingStatus !== "CLOSED",
  };
}

export function buildTreasuryGuidedDailyClosingGateSummary(input: {
  accounts: readonly TreasuryGuidedDailyClosingAccountDto[];
  preview: TreasuryDailyClosingPreviewDto | null;
}): TreasuryGuidedDailyClosingGateSummaryDto {
  const accounts = input.accounts.filter((a) => a.situation !== "INACTIVE");
  const openingsInformed =
    accounts.length > 0 && accounts.every((a) => a.openingBalance != null);
  const closingsInformed =
    accounts.length > 0 &&
    accounts.every((a) => a.informedClosingBalance != null);
  const hasDivergences = accounts.some((a) => a.situation === "HAS_DIVERGENCE");
  const preview = input.preview;

  const dayAlreadyClosed = (preview?.absoluteBlocks ?? []).some(
    (b) => b.code === "DAY_ALREADY_CLOSED"
  );

  return {
    openingsInformed,
    closingsInformed,
    hasDivergences,
    unidentifiedMovementsCount: preview?.unreconciledMovements.length ?? 0,
    unlinkedAccountsCount: (preview?.pendingReceivables ?? [])
      .concat(preview?.pendingPayables ?? [])
      .filter((p) => p.accountId == null).length,
    transfersInTransitCount: preview?.transfersInTransit.length ?? 0,
    requiredCaveatCodes: preview?.requiredCaveatCodes ?? [],
    absoluteBlocks: (preview?.absoluteBlocks ?? []).map((b) => ({
      code: b.code,
      message: b.description || b.title,
    })),
    warnings: (preview?.warnings ?? []).map((b) => ({
      code: b.code,
      message: b.description || b.title,
    })),
    canCloseWithoutCaveats: Boolean(preview?.canCloseWithoutCaveats),
    canCloseWithCaveats: Boolean(preview?.canCloseWithCaveats),
    sourceHash: preview?.sourceHash ?? null,
    dayAlreadyClosed,
  };
}

export function buildTreasuryGuidedDailyClosingWorkspace(input: {
  civilDate: TreasuryCivilDate;
  asOf?: Date | string;
  accounts: readonly TreasuryGuidedDailyClosingAccountSeed[];
  preview: TreasuryDailyClosingPreviewDto | null;
}): TreasuryGuidedDailyClosingWorkspaceDto {
  const accounts = input.accounts.map((seed) => {
    const dto = buildTreasuryGuidedDailyClosingAccountDto({
      ...seed,
      dayFlow: seed.dayFlow ?? emptyTreasuryDailyAccountRoutineDayFlow(),
    });
    return dto;
  });
  const closeGates = buildTreasuryGuidedDailyClosingGateSummary({
    accounts,
    preview: input.preview,
  });

  return {
    ok: true,
    civilDate: input.civilDate,
    asOf: formatTreasuryTimestampIso(
      input.asOf instanceof Date
        ? input.asOf
        : input.asOf
          ? new Date(input.asOf)
          : new Date()
    ),
    title: TREASURY_GUIDED_DAILY_CLOSING_TITLE,
    companyCode:
      input.preview?.companyCode ??
      input.accounts.find((a) => a.companyCode)?.companyCode ??
      null,
    accounts,
    informedCount: accounts.filter(
      (a) =>
        a.situation === "INFORMED_OK" ||
        a.situation === "HAS_DIVERGENCE" ||
        a.situation === "CLOSED"
    ).length,
    pendingCount: accounts.filter(
      (a) =>
        a.situation === "READY_TO_INFORM" || a.situation === "NEEDS_OPENING"
    ).length,
    divergenceCount: accounts.filter((a) => a.situation === "HAS_DIVERGENCE")
      .length,
    investigationActions: [...TREASURY_GUIDED_DAILY_CLOSING_INVESTIGATION_ACTIONS],
    closeGates,
  };
}

export function planTreasuryGuidedDailyClosingSaveItem(input: {
  seed: TreasuryGuidedDailyClosingAccountSeed;
  civilDate: string;
  item: TreasuryGuidedDailyClosingSaveItemInput;
  actorUserId: string;
  recordedAt: Date | string;
}): ReturnType<typeof planTreasuryDailyClosingBankBalance> {
  if (!input.seed.isActive) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Conta financeira inativa não admite saldo final.",
      "accountId"
    );
  }
  if (!input.seed.opening) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Informe o saldo inicial antes do saldo final bancário.",
      "openingBalance"
    );
  }
  if (input.seed.formalClosingStatus === "CLOSED") {
    throw new TreasuryDomainError(
      "DAY_CLOSED",
      "Dia já fechado. Reabra o fechamento formal para alterar o saldo final.",
      "status"
    );
  }

  const amount = String(input.item.amount ?? "").trim();
  if (!amount) {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      "Informe o saldo final visto no banco.",
      "amount"
    );
  }

  const expectedVersion = Math.max(
    input.seed.opening.version,
    input.seed.closingBank?.version ?? 0
  );
  if (input.item.expectedVersion !== expectedVersion) {
    // planTreasuryDailyClosingBankBalance also checks; keep seed aligned.
  }

  const current: TreasuryDailyAccountRoutineState = {
    accountId: input.seed.accountId,
    civilDate: input.civilDate as TreasuryCivilDate,
    status: "OPEN",
    openingBalance: {
      amount: input.seed.opening.amount,
      informedByUserId: input.actorUserId,
      informedAt:
        typeof input.recordedAt === "string"
          ? input.recordedAt
          : input.recordedAt.toISOString(),
      version: input.seed.opening.version,
    },
    closingBankBalance: input.seed.closingBank
      ? {
          amount: input.seed.closingBank.amount,
          informedByUserId: input.actorUserId,
          informedAt:
            typeof input.recordedAt === "string"
              ? input.recordedAt
              : input.recordedAt.toISOString(),
          version: input.seed.closingBank.version,
        }
      : null,
    predictedClosingBalance: null,
    realizedClosingBalance: null,
    divergence: null,
    notes: null,
    caveats: [],
    version: expectedVersion,
    formalClosingId: null,
    formalClosingStatus: input.seed.formalClosingStatus,
  };

  return planTreasuryDailyClosingBankBalance({
    accountId: input.seed.accountId,
    civilDate: input.civilDate,
    current,
    expectedVersion: input.item.expectedVersion,
    amount,
    actorUserId: input.actorUserId,
    recordedAt: input.recordedAt,
    dayFlow: input.seed.dayFlow,
    notes: input.item.notes,
    reason: "Saldo final bancário informado no fluxo guiado",
  });
}

/** Soma entradas/saídas realizadas para exibição agregada. */
export function sumTreasuryGuidedDailyClosingTransfersNet(
  accounts: readonly TreasuryGuidedDailyClosingAccountDto[]
): TreasuryMoneyString {
  return accounts.reduce(
    (acc, a) => addTreasuryMoney(acc, a.transfersNet),
    "0.00" as TreasuryMoneyString
  );
}
