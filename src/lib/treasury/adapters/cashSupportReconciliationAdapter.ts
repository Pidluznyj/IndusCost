/**
 * Adaptador do TreasuryReconciliation para o Apoio ao Caixa (CS-004).
 *
 * Consome exclusivamente `TreasuryReconciliationMatchDto` — leitura oficial
 * de `treasuryReconciliationMatchService.listActiveByBankMovement`/`getById`.
 * Não recalcula capacidade, não grava estado de apresentação em tabela
 * paralela, não decide se um match é válido — isso é autoridade exclusiva
 * do motor oficial (ADR 001). Este arquivo só projeta o resultado dele.
 */

import type { TreasuryReconciliationMatchDto } from "../contracts/treasuryDto.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
} from "../treasuryMoney.js";
import type {
  CashSupportAvailableAction,
  CashSupportReconciliationState,
  CashSupportSourceReference,
} from "../contracts/cashSupportContracts.js";

const POSITIVE_KINDS = new Set(["TITLE", "FEE", "INTEREST", "DIFFERENCE", "TRANSFER", "MANUAL_LEDGER", "UNIDENTIFIED"]);
const NEGATIVE_KINDS = new Set(["DISCOUNT", "ABATEMENT"]);

/** Resumo de conciliação de UM movimento — soma todos os matches ativos dele. */
export type CashSupportReconciliationSummary = {
  allocatedAmount: string;
  /** TITLE isolado — o que efetivamente cobre título oficial. */
  titleAllocatedAmount: string;
  /** FEE+INTEREST+DIFFERENCE−DISCOUNT−ABATEMENT — explica sem ser título. */
  adjustmentAmount: string;
  reconciliationState: CashSupportReconciliationState;
  activeMatchIds: string[];
  sourceReferences: CashSupportSourceReference[];
  auditReference: string | null;
};

function matchToState(status: string): CashSupportReconciliationState {
  switch (status) {
    case "MATCHED":
    case "PENDING":
    case "UNMATCHED":
    case "IGNORED":
      return status;
    default:
      return "PENDING";
  }
}

/**
 * Agrega os matches ATIVOS de um movimento em um resumo de apresentação.
 * `matches` deve vir só de `listActiveByBankMovement` (já filtra
 * MATCHED/PENDING no repositório oficial) — este adaptador não filtra de
 * novo, só soma o que a autoridade já considerou ativo.
 */
export function summarizeCashSupportReconciliationForMovement(
  matches: readonly TreasuryReconciliationMatchDto[]
): CashSupportReconciliationSummary {
  let titleAllocated = "0.00";
  let positiveAdjustment = "0.00";
  let negativeAdjustment = "0.00";
  const sourceReferences: CashSupportSourceReference[] = [];

  for (const match of matches) {
    sourceReferences.push({
      source: "TreasuryReconciliationMatch",
      id: match.id,
      label: match.justification,
    });
    for (const alloc of match.allocations) {
      const amount = normalizeTreasuryMoneyString(alloc.amount);
      if (alloc.kind === "TITLE") {
        titleAllocated = addTreasuryMoney(titleAllocated, amount);
      } else if (POSITIVE_KINDS.has(alloc.kind)) {
        positiveAdjustment = addTreasuryMoney(positiveAdjustment, amount);
      } else if (NEGATIVE_KINDS.has(alloc.kind)) {
        negativeAdjustment = addTreasuryMoney(negativeAdjustment, amount);
      }
    }
  }

  const adjustmentAmount = subtractTreasuryMoney(positiveAdjustment, negativeAdjustment);
  // Dinheiro que efetivamente saiu/entrou no banco (covering net do motor
  // oficial): título + ajustes positivos − negativos. DISCOUNT/ABATEMENT
  // cobrem o título sem exigir dinheiro adicional — não podem inflar o que
  // o banco realmente moveu (Prompt 0 §4.9).
  const allocated = subtractTreasuryMoney(
    addTreasuryMoney(titleAllocated, positiveAdjustment),
    negativeAdjustment
  );

  // Estado de apresentação: pega o mais "avançado" entre os matches ativos —
  // MATCHED > PENDING; nunca inventa um estado que o motor não devolveu.
  const state: CashSupportReconciliationState = matches.some(
    (m) => m.status === "MATCHED"
  )
    ? "MATCHED"
    : matches.length > 0
      ? matchToState(matches[0]!.status)
      : "PENDING";

  return {
    allocatedAmount: allocated,
    titleAllocatedAmount: titleAllocated,
    adjustmentAmount,
    reconciliationState: state,
    activeMatchIds: matches.map((m) => m.id),
    sourceReferences,
    auditReference: matches[0]?.id ?? null,
  };
}

/**
 * Ações disponíveis por movimento, derivadas SOMENTE do estado que o motor
 * já devolveu — nenhuma capacidade é recalculada aqui (Prompt 0 §16: "Não
 * recalcular capacidade no frontend" vale igual para este adaptador de
 * backend: a fonte da verdade continua sendo o `accept`/`unmatch`/`reverse`
 * oficiais, chamados por trás destas ações).
 */
export function buildCashSupportReconciliationActions(
  summary: CashSupportReconciliationSummary
): CashSupportAvailableAction[] {
  const hasActiveMatch = summary.activeMatchIds.length > 0;
  return [
    {
      kind: "VIEW_SUGGESTIONS",
      enabled: true,
      disabledReason: null,
    },
    {
      kind: "UNMATCH",
      enabled: hasActiveMatch,
      disabledReason: hasActiveMatch ? null : "Nenhum match ativo para desfazer.",
    },
    {
      kind: "REVERSE",
      enabled: hasActiveMatch,
      disabledReason: hasActiveMatch
        ? null
        : "Nenhum match ativo para reverter.",
    },
  ];
}
