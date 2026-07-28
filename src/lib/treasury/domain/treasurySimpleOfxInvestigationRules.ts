/**
 * Domínio — assistente simples de investigação de divergência via OFX.
 * Reusa motor de sugestões / match / ledger; sem auto-match definitivo.
 */

import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

export const TREASURY_SIMPLE_OFX_INVESTIGATION_TITLE =
  "Conferir banco e divergências" as const;

export const TREASURY_SIMPLE_OFX_INVESTIGATION_UI_PATH =
  "/finance/treasury/bank" as const;

export const TREASURY_SIMPLE_OFX_INVESTIGATION_LABELS = {
  possibleMatch: "Possível correspondência",
  confirm: "Confirmar",
  chooseOtherTitle: "Escolher outro título",
  stillUnidentified: "Movimento ainda não identificado",
  unmatch: "Desfazer correspondência",
  createManualLedger: "Criar lançamento manual",
  divergenceBefore: "Divergência antes",
  explainedMovements: "Movimentos explicados",
  unexplainedMovements: "Movimentos ainda não explicados",
  remainingDivergence: "Divergência restante",
  statementPeriod: "Período do extrato",
  statementBalance: "Saldo do extrato",
  noAutoMatch: "Nenhuma correspondência é aplicada automaticamente.",
} as const;

export const TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTIONS = [
  "FEE",
  "INTEREST",
  "UNIDENTIFIED_INFLOW",
  "UNIDENTIFIED_OUTFLOW",
  "TRANSFER",
  "OTHER",
] as const;

export type TreasurySimpleOfxUnidentifiedOption =
  (typeof TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTIONS)[number];

export const TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTION_LABELS: Record<
  TreasurySimpleOfxUnidentifiedOption,
  string
> = {
  FEE: "Registrar como tarifa",
  INTEREST: "Registrar como juros",
  UNIDENTIFIED_INFLOW: "Entrada não identificada",
  UNIDENTIFIED_OUTFLOW: "Saída não identificada",
  TRANSFER: "Transferência",
  OTHER: "Outro",
};

/** Mapeia opção simples → kind de alocação da conciliação existente. */
export function mapTreasurySimpleOfxUnidentifiedToAllocationKind(
  option: TreasurySimpleOfxUnidentifiedOption
): "FEE" | "INTEREST" | "UNIDENTIFIED" | "TRANSFER" | "MANUAL_LEDGER" {
  if (option === "FEE") return "FEE";
  if (option === "INTEREST") return "INTEREST";
  if (option === "TRANSFER") return "TRANSFER";
  if (option === "OTHER") return "MANUAL_LEDGER";
  return "UNIDENTIFIED";
}

export function resolveTreasurySimpleOfxLedgerDirection(
  option: TreasurySimpleOfxUnidentifiedOption,
  movementDirection: "DEBIT" | "CREDIT" | string
): "DEBIT" | "CREDIT" {
  if (option === "UNIDENTIFIED_INFLOW") return "CREDIT";
  if (option === "UNIDENTIFIED_OUTFLOW") return "DEBIT";
  if (option === "FEE" || option === "INTEREST") return "DEBIT";
  return movementDirection === "CREDIT" ? "CREDIT" : "DEBIT";
}

export type TreasurySimpleOfxInvestigationMovementSeed = {
  id: string;
  amount: string;
  reconciliationStatus: string;
  reconciledAmount?: string | null;
};

export type TreasurySimpleOfxInvestigationResultDto = {
  divergenceBefore: TreasuryMoneyString | null;
  explainedAmount: TreasuryMoneyString;
  unexplainedAmount: TreasuryMoneyString;
  remainingDivergence: TreasuryMoneyString | null;
  explainedCount: number;
  unexplainedCount: number;
  labels: typeof TREASURY_SIMPLE_OFX_INVESTIGATION_LABELS;
};

function money(value: string | null | undefined): TreasuryMoneyString {
  if (value == null || value === "") return "0.00";
  return normalizeTreasuryMoneyString(value);
}

function isExplainedStatus(status: string): boolean {
  return status === "MATCHED" || status === "PARTIAL";
}

function isUnexplainedStatus(status: string): boolean {
  return (
    status === "PENDING" ||
    status === "UNMATCHED" ||
    status === "PARTIAL" ||
    status === "IGNORED"
  );
}

/**
 * Resultado da investigação: antes / explicados / não explicados / restante.
 * OFX conciliado não soma de novo no calculado — aqui só classifica movimentos.
 */
export function buildTreasurySimpleOfxInvestigationResult(input: {
  divergenceBefore: string | null;
  movements: readonly TreasurySimpleOfxInvestigationMovementSeed[];
}): TreasurySimpleOfxInvestigationResultDto {
  let explainedAmount: TreasuryMoneyString = "0.00";
  let unexplainedAmount: TreasuryMoneyString = "0.00";
  let explainedCount = 0;
  let unexplainedCount = 0;

  for (const m of input.movements) {
    const total = money(m.amount);
    const reconciled = money(m.reconciledAmount ?? "0.00");
    const open =
      compareTreasuryMoney(total, reconciled) > 0
        ? subtractTreasuryMoney(total, reconciled)
        : "0.00";

    if (m.reconciliationStatus === "MATCHED") {
      explainedAmount = addTreasuryMoney(explainedAmount, total);
      explainedCount += 1;
      continue;
    }
    if (m.reconciliationStatus === "PARTIAL") {
      explainedAmount = addTreasuryMoney(explainedAmount, reconciled);
      unexplainedAmount = addTreasuryMoney(unexplainedAmount, open);
      explainedCount += 1;
      if (compareTreasuryMoney(open, "0.00") > 0) unexplainedCount += 1;
      continue;
    }
    if (isUnexplainedStatus(m.reconciliationStatus)) {
      unexplainedAmount = addTreasuryMoney(unexplainedAmount, total);
      unexplainedCount += 1;
    }
  }

  const before =
    input.divergenceBefore == null || input.divergenceBefore === ""
      ? null
      : money(input.divergenceBefore);

  const remaining =
    before == null
      ? null
      : // Restante ≈ antes − valor já explicado (aproximação operacional).
        subtractTreasuryMoney(before, explainedAmount);

  void isExplainedStatus;

  return {
    divergenceBefore: before,
    explainedAmount,
    unexplainedAmount,
    remainingDivergence: remaining,
    explainedCount,
    unexplainedCount,
    labels: TREASURY_SIMPLE_OFX_INVESTIGATION_LABELS,
  };
}

export function assertTreasurySimpleOfxNoAutoMatch(autoMatched: boolean): void {
  if (autoMatched) {
    throw new Error(
      "Assistente simples não aplica correspondência automática definitiva."
    );
  }
}
