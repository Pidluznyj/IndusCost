/**
 * Read model unificado do Apoio ao Caixa (CS-005).
 *
 * Função pura: reúne o que os três adaptadores (canônico, bancário,
 * conciliação — CS-002/003/004) já produziram. Não consulta banco, não
 * chama Prisma, não decide RBAC/ACL — isso é do serviço orquestrador (I/O)
 * que vai chamar esta função (etapa de API, CS-006). Ser pura é o que torna
 * a anti-dupla-contagem e a paginação testáveis sem infraestrutura.
 *
 * Regra estrutural (ADR 001 §1.3, Prompt 0 §15): FORECAST nunca recebe
 * allocation. Este módulo não junta previsão a movimento — cada uma aparece
 * como linha própria, e a ponte entre as duas famílias (bancária x
 * canônica) é só a diferença agregada no resumo, nunca um vínculo por linha.
 */

import type {
  TreasuryBankMovementDto,
  TreasuryReconciliationMatchDto,
} from "../contracts/treasuryDto.js";
import type { TreasuryCaixaCanonicalDay } from "./treasuryCaixaCanonicalDay.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
} from "../treasuryMoney.js";
import {
  adaptTreasuryCaixaCanonicalDaysToCashSupportRows,
} from "../adapters/cashSupportCanonicalAdapter.js";
import {
  adaptTreasuryBankMovementsToCashSupportRows,
  buildCashSupportBankBalanceWarnings,
  summarizeCashSupportBankPosition,
} from "../adapters/cashSupportBankAdapter.js";
import {
  buildCashSupportReconciliationActions,
  summarizeCashSupportReconciliationForMovement,
} from "../adapters/cashSupportReconciliationAdapter.js";
import type {
  CashSupportFilters,
  CashSupportReadModel,
  CashSupportResourceType,
  CashSupportUnifiedRow,
  CashSupportWarning,
} from "../contracts/cashSupportContracts.js";

export type CashSupportReadModelInput = {
  canonicalDays: readonly TreasuryCaixaCanonicalDay[];
  companyCode: string | null;
  bankMovements: readonly TreasuryBankMovementDto[];
  /** Matches ATIVOS por bankMovementId — já pré-carregados por quem chama. */
  activeMatchesByMovementId: ReadonlyMap<string, readonly TreasuryReconciliationMatchDto[]>;
  filters: CashSupportFilters;
  analysisAsOfDateTime: string;
};

function withinDateRange(row: CashSupportUnifiedRow, from: string, to: string): boolean {
  const date = row.bankDate ?? row.dueDate ?? row.expectedDate ?? row.occurredAt;
  if (!date) return true; // sem data não é excluída por período — evita sumiço silencioso
  const civil = date.slice(0, 10);
  return civil >= from && civil <= to;
}

function matchesFilters(
  row: CashSupportUnifiedRow,
  filters: CashSupportFilters
): boolean {
  if (!withinDateRange(row, filters.civilDateFrom, filters.civilDateTo)) return false;
  if (filters.companyCode && row.companyContext?.companyCode !== filters.companyCode)
    return false;
  if (filters.accountId && row.accountContext?.accountId !== filters.accountId)
    return false;
  if (filters.direction && row.direction !== filters.direction) return false;
  if (
    filters.resourceTypes &&
    filters.resourceTypes.length > 0 &&
    !filters.resourceTypes.includes(row.resourceType)
  )
    return false;
  if (
    filters.reconciliationStates &&
    filters.reconciliationStates.length > 0 &&
    !filters.reconciliationStates.includes(row.reconciliationState)
  )
    return false;
  if (filters.onlyPending && row.reconciliationState === "MATCHED") return false;
  if (filters.onlyWarnings && row.warnings.length === 0) return false;
  if (filters.search) {
    const needle = filters.search.trim().toLowerCase();
    if (needle) {
      const haystack = `${row.description ?? ""} ${row.displayId}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
  }
  return true;
}

/** Enriquece cada linha bancária com o resumo do motor de conciliação (CS-004). */
function enrichBankRows(
  rows: readonly CashSupportUnifiedRow[],
  activeMatchesByMovementId: ReadonlyMap<string, readonly TreasuryReconciliationMatchDto[]>
): CashSupportUnifiedRow[] {
  return rows.map((row) => {
    if (row.resourceType !== "BANK_MOVEMENT" || !row.bankMovementKey) return row;
    const matches = activeMatchesByMovementId.get(row.bankMovementKey.bankMovementId) ?? [];
    const summary = summarizeCashSupportReconciliationForMovement(matches);
    const reconciliationActions = buildCashSupportReconciliationActions(summary);
    return {
      ...row,
      // allocatedAmount/residualAmount permanecem os da linha bancária
      // (autoridade: o próprio TreasuryBankMovement.reconciledAmount, já
      // gravado pelo motor oficial) — o adaptador de conciliação só refina
      // a QUEBRA título x ajuste, nunca substitui o total.
      adjustmentAmount: summary.adjustmentAmount,
      sourceReferences: [...row.sourceReferences, ...summary.sourceReferences],
      availableActions: [
        ...row.availableActions.filter((a) => a.kind !== "UNMATCH" && a.kind !== "REVERSE"),
        ...reconciliationActions.filter((a) => a.kind !== "VIEW_SUGGESTIONS"),
      ],
    };
  });
}

/**
 * Posição canônica: soma direto dos dias canônicos (mesma fonte que já
 * fecha no centavo com a Linha do tempo — CS-002). Não subtrai "evidenciado"
 * dos títulos aqui: por construção, `receivableDue`/`payableDue` já excluem
 * o que foi baixado (dimensões disjuntas do motor de origem).
 */
function summarizeCanonicalPosition(days: readonly TreasuryCaixaCanonicalDay[]) {
  let expectedTitles = "0.00";
  let evidencedTitles = "0.00";
  for (const day of days) {
    expectedTitles = addTreasuryMoney(
      expectedTitles,
      addTreasuryMoney(day.receivableDue.toFixed(2), day.payableDue.toFixed(2))
    );
    evidencedTitles = addTreasuryMoney(
      evidencedTitles,
      addTreasuryMoney(
        day.receivableReceived.toFixed(2),
        day.payablePaid.toFixed(2)
      )
    );
  }
  return { expectedTitles, evidencedTitles };
}

export function buildCashSupportReadModel(
  input: CashSupportReadModelInput
): CashSupportReadModel {
  const canonicalRows = adaptTreasuryCaixaCanonicalDaysToCashSupportRows(
    input.canonicalDays,
    input.companyCode
  );
  const bankRowsRaw = adaptTreasuryBankMovementsToCashSupportRows(input.bankMovements);
  const bankRows = enrichBankRows(bankRowsRaw, input.activeMatchesByMovementId);

  const allRows = [...canonicalRows, ...bankRows].filter((r) =>
    matchesFilters(r, input.filters)
  );

  // Ordena por data mais recente primeiro — mesma data usada no filtro.
  allRows.sort((a, b) => {
    const da = a.bankDate ?? a.dueDate ?? a.expectedDate ?? "";
    const db = b.bankDate ?? b.dueDate ?? b.expectedDate ?? "";
    return db.localeCompare(da);
  });

  const page = Math.max(1, input.filters.page ?? 1);
  const pageSize = Math.max(1, Math.min(200, input.filters.pageSize ?? 50));
  const total = allRows.length;
  const start = (page - 1) * pageSize;
  const pageRows = allRows.slice(start, start + pageSize);

  const bankPosition = summarizeCashSupportBankPosition(input.bankMovements);
  const canonicalPosition = summarizeCanonicalPosition(input.canonicalDays);

  // Balance real (posição bancária consolidada) não é recomputado aqui —
  // nenhuma fonte de saldo final foi passada; fica null com warning
  // estrutural em vez de somar movimentos como se fossem o saldo (matriz #6/#8).
  const balanceWarnings = buildCashSupportBankBalanceWarnings();

  const unidentifiedTotal = input.bankMovements
    .filter((m) => m.reconciliationStatus === "UNMATCHED")
    .reduce((acc, m) => addTreasuryMoney(acc, normalizeTreasuryMoneyString(m.amount)), "0.00");

  const bridge = {
    bankNotExplainedByTitles: subtractTreasuryMoney(
      addTreasuryMoney(bankPosition.inflows, bankPosition.outflows),
      addTreasuryMoney(canonicalPosition.evidencedTitles, "0.00")
    ),
    titlesWithoutBankEvidence: canonicalPosition.expectedTitles,
    // Transferência interna: efeito consolidado sempre zero (ADR 001) — este
    // orquestrador ainda não recebe transferências como insumo (CS-015), mas
    // o campo já existe no contrato e é fixado em "0.00" até lá.
    internalTransfersConsolidated: "0.00",
  };

  const warnings: CashSupportWarning[] = [...balanceWarnings];
  if (!input.companyCode) {
    warnings.push({
      code: "COMPANY_CONTEXT_UNAVAILABLE",
      message: "Empresa não resolvida pela camada de serviço para este período.",
    });
  }

  return {
    rows: pageRows,
    summary: {
      bankPosition: { balance: null, ...bankPosition, unidentified: unidentifiedTotal },
      canonicalPosition: {
        ...canonicalPosition,
        futureForecasts: "0.00", // requer horizonte além da janela — fora do MVP read-only
        overdue: "0.00", // idem — overdue vem de treasuryCaixaService.overdue, não injetado ainda
      },
      bridge,
      warnings,
    },
    analysisAsOfDateTime: input.analysisAsOfDateTime,
    pagination: { page, pageSize, total },
    warnings,
  };
}

/** Tipos de recurso que nunca podem carregar allocation — usado em testes de invariante. */
export const CASH_SUPPORT_READ_MODEL_FORECAST_TYPE: CashSupportResourceType = "FORECAST";
