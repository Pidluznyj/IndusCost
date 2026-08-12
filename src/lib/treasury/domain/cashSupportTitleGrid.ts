/**
 * Grid de Conciliação por Títulos — view-model PURO.
 *
 * Constrói a visão orientada a título (CR/CP) da Central de Conciliação
 * Bancária a partir de dados já oficiais:
 *   - linhas do read model do Apoio ao Caixa (títulos + movimentos bancários);
 *   - matches ativos do TreasuryReconciliationMatch (evidência local);
 *   - sugestões pendentes do motor (opcional — marca 🟡 Revisar).
 *
 * NÃO decide nada: só projeta. O backend (matchService) é a única autoridade
 * de conciliação; a UI apenas desenha o resultado desta função.
 * Dinheiro sempre via treasuryMoney (string) — nunca float.
 */

import {
  formatCashSupportOfficialTitleKey,
  type CashSupportUnifiedRow,
} from "../contracts/cashSupportContracts.js";
import type {
  TreasuryReconciliationAllocationDto,
  TreasuryReconciliationMatchDto,
} from "../contracts/treasuryDto.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  negateTreasuryMoney,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import { CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX } from "./cashSupportAutoReconcile.js";
import type { TreasuryReconciliationSuggestionCandidate } from "./treasuryReconciliationSuggestionEngine.js";

const ZERO: TreasuryMoneyString = "0.00";

/**
 * Alocações que explicam diferença (não são valor de título).
 * Subconjunto de TREASURY_RECONCILIATION_ALLOCATION_KINDS — desconto, juros,
 * multa/tarifa (FEE), abatimento e DIFFERENCE genérica classificada.
 */
const DIFFERENCE_ALLOCATION_KINDS = new Set([
  "FEE",
  "INTEREST",
  "DISCOUNT",
  "ABATEMENT",
  "DIFFERENCE",
]);

export const CASH_SUPPORT_TITLE_STATUSES = [
  "AUTO_MATCHED",
  "MANUAL_MATCHED",
  "REVIEW",
  "UNRECONCILED",
  "DIVERGENCE",
  "PARTIAL",
] as const;
export type CashSupportTitleStatus = (typeof CASH_SUPPORT_TITLE_STATUSES)[number];

export const CASH_SUPPORT_TITLE_STATUS_LABELS: Record<CashSupportTitleStatus, string> = {
  AUTO_MATCHED: "Automático",
  MANUAL_MATCHED: "Manual",
  REVIEW: "Revisar",
  UNRECONCILED: "Não conciliado",
  DIVERGENCE: "Divergência",
  PARTIAL: "Parcial",
};

/** Perna bancária vinculada a um título (via match ativo). */
export type CashSupportTitleBankLeg = {
  matchId: string;
  bankMovementId: string;
  /** Valor alocado AO TÍTULO neste match (não o valor cheio do movimento). */
  allocatedAmount: TreasuryMoneyString;
  bankDate: string | null;
  accountName: string | null;
  movementDescription: string | null;
  isAuto: boolean;
};

export type CashSupportTitleGridRow = {
  /** "CR" recebível | "CP" pagável. */
  tipo: "CR" | "CP";
  titleKeyLabel: string;
  displayId: string;
  externalId: number;
  companyCode: string;
  counterparty: string | null;
  dueDate: string | null;
  titleAmount: TreasuryMoneyString;
  /** Pernas bancárias ordenadas por data; UI mostra 2 primeiras + "+N". */
  bankLegs: CashSupportTitleBankLeg[];
  totalAllocated: TreasuryMoneyString;
  /** titleAmount − totalAllocated − diferenças justificadas. */
  difference: TreasuryMoneyString;
  /** Soma das pernas de diferença justificada (desconto/juros/tarifa/...). */
  justifiedDifference: TreasuryMoneyString;
  hasJustifiedDifference: boolean;
  status: CashSupportTitleStatus;
  statusLabel: string;
  matchIds: string[];
  /** Sugestão pendente de maior score para este título (se houver). */
  pendingSuggestionKey: string | null;
  pendingSuggestionScore: number | null;
};

export type CashSupportUnexplainedMovement = {
  displayId: string;
  bankMovementId: string;
  direction: "IN" | "OUT";
  bankDate: string | null;
  description: string | null;
  accountName: string | null;
  bankAmount: TreasuryMoneyString;
  residualAmount: TreasuryMoneyString;
  bestSuggestionKey: string | null;
  bestSuggestionScore: number | null;
  bestSuggestionConfidence: string | null;
};

export type CashSupportReconciliationCards = {
  totalTitles: number;
  autoMatchedCount: number;
  manualMatchedCount: number;
  reviewCount: number;
  partialCount: number;
  divergenceCount: number;
  unreconciledCount: number;
  unexplainedMovementsCount: number;
  unexplainedMovementsTotal: TreasuryMoneyString;
};

export type CashSupportTitleGridViewModel = {
  titleRows: CashSupportTitleGridRow[];
  unexplainedMovements: CashSupportUnexplainedMovement[];
  cards: CashSupportReconciliationCards;
};

function isAutoMatch(match: TreasuryReconciliationMatchDto): boolean {
  return (
    match.justification != null &&
    match.justification.startsWith(CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX)
  );
}

function isTitleAllocation(alloc: TreasuryReconciliationAllocationDto): boolean {
  return alloc.kind === "TITLE" && alloc.nomusExternalId != null;
}

function isDifferenceAllocation(alloc: TreasuryReconciliationAllocationDto): boolean {
  return DIFFERENCE_ALLOCATION_KINDS.has(String(alloc.kind));
}

function absMoney(value: TreasuryMoneyString): TreasuryMoneyString {
  return compareTreasuryMoney(value, ZERO) < 0 ? negateTreasuryMoney(value) : value;
}

/**
 * Monta o grid por título. Puro e determinístico.
 * `matches` deve conter apenas matches ATIVOS (isReversed=false) — matches
 * revertidos não explicam nada; passar revertido aqui é bug do chamador.
 */
export function buildCashSupportTitleGrid(input: {
  rows: readonly CashSupportUnifiedRow[];
  matches: readonly TreasuryReconciliationMatchDto[];
  suggestions?: readonly TreasuryReconciliationSuggestionCandidate[];
}): CashSupportTitleGridViewModel {
  const suggestions = input.suggestions ?? [];

  // Índices auxiliares -------------------------------------------------------
  const movementRowById = new Map<string, CashSupportUnifiedRow>();
  const titleRowsSource: CashSupportUnifiedRow[] = [];
  for (const row of input.rows) {
    if (row.resourceType === "BANK_MOVEMENT" && row.bankMovementKey) {
      movementRowById.set(row.bankMovementKey.bankMovementId, row);
    } else if (
      (row.resourceType === "OFFICIAL_RECEIVABLE" ||
        row.resourceType === "OFFICIAL_PAYABLE") &&
      row.officialTitleKey
    ) {
      titleRowsSource.push(row);
    }
  }

  const activeMatches = input.matches.filter((m) => !m.isReversed);

  // externalId (título) -> pernas + diferenças
  type TitleAggregation = {
    legs: CashSupportTitleBankLeg[];
    totalAllocated: TreasuryMoneyString;
    justifiedDifference: TreasuryMoneyString;
    matchIds: Set<string>;
    hasAuto: boolean;
    hasManual: boolean;
  };
  const byExternalId = new Map<number, TitleAggregation>();

  for (const match of activeMatches) {
    const auto = isAutoMatch(match);
    const titleAllocs = match.allocations.filter(isTitleAllocation);
    const diffAllocs = match.allocations.filter(isDifferenceAllocation);

    for (const alloc of titleAllocs) {
      const externalId = alloc.nomusExternalId!;
      const agg: TitleAggregation = byExternalId.get(externalId) ?? {
        legs: [],
        totalAllocated: ZERO,
        justifiedDifference: ZERO,
        matchIds: new Set<string>(),
        hasAuto: false,
        hasManual: false,
      };

      // Uma perna por movimento do match, com o valor alocado ao título.
      // Match 1↔1 e N↔1: o valor da allocation pertence integralmente ao título;
      // quando o match tem vários movimentos, exibimos cada movimento como perna
      // com sua parcela (amount do movement leg limitado ao alocado do título).
      for (const movementLeg of match.movements) {
        const movementRow = movementRowById.get(movementLeg.bankMovementId) ?? null;
        agg.legs.push({
          matchId: match.id,
          bankMovementId: movementLeg.bankMovementId,
          allocatedAmount:
            match.movements.length === 1 ? alloc.amount : movementLeg.amount,
          bankDate: movementRow?.bankDate ?? match.matchedCivilDate ?? null,
          accountName: movementRow?.accountContext?.accountName ?? null,
          movementDescription: movementRow?.description ?? null,
          isAuto: auto,
        });
      }

      agg.totalAllocated = addTreasuryMoney(agg.totalAllocated, alloc.amount);
      agg.matchIds.add(match.id);
      if (auto) agg.hasAuto = true;
      else agg.hasManual = true;
      byExternalId.set(externalId, agg);
    }

    // Diferenças justificadas do match são atribuídas aos títulos do match
    // (proporcional seria falso rigor; o comum é 1 título por match — quando
    // há vários, a diferença aparece agregada em cada linha como contexto).
    if (diffAllocs.length > 0 && titleAllocs.length > 0) {
      let diffTotal: TreasuryMoneyString = ZERO;
      for (const diff of diffAllocs) {
        diffTotal = addTreasuryMoney(diffTotal, absMoney(diff.amount));
      }
      for (const alloc of titleAllocs) {
        const agg = byExternalId.get(alloc.nomusExternalId!);
        if (agg) {
          agg.justifiedDifference = addTreasuryMoney(agg.justifiedDifference, diffTotal);
        }
      }
    }
  }

  // Sugestões pendentes por título e por movimento --------------------------
  const bestSuggestionByTitle = new Map<
    number,
    { key: string; score: number }
  >();
  const bestSuggestionByMovement = new Map<
    string,
    { key: string; score: number; confidence: string }
  >();
  for (const suggestion of suggestions) {
    for (const alloc of suggestion.allocations) {
      const current = bestSuggestionByTitle.get(alloc.externalId);
      if (!current || suggestion.score > current.score) {
        bestSuggestionByTitle.set(alloc.externalId, {
          key: suggestion.suggestionKey,
          score: suggestion.score,
        });
      }
    }
    // Todas as pernas: combinação 1 título ↔ N movimentos conta como melhor
    // candidato de cada movimento envolvido.
    for (const leg of suggestion.movementLegs) {
      const currentMove = bestSuggestionByMovement.get(leg.movementId);
      if (!currentMove || suggestion.score > currentMove.score) {
        bestSuggestionByMovement.set(leg.movementId, {
          key: suggestion.suggestionKey,
          score: suggestion.score,
          confidence: suggestion.confidence,
        });
      }
    }
  }

  // Linhas do grid -----------------------------------------------------------
  const titleRows: CashSupportTitleGridRow[] = [];
  for (const row of titleRowsSource) {
    const key = row.officialTitleKey!;
    const agg = byExternalId.get(key.externalId) ?? null;
    const titleAmount = row.officialAmount ?? ZERO;
    const totalAllocated = agg?.totalAllocated ?? ZERO;
    const justifiedDifference = agg?.justifiedDifference ?? ZERO;
    // Diferença operacional = valor título − alocado (kind TITLE). As pernas
    // de diferença (desconto/juros/tarifa) explicam a lacuna banco×título e
    // aparecem como contexto (justifiedDifference) — subtraí-las aqui contaria
    // o desconto duas vezes e geraria falsa divergência.
    const difference = subtractTreasuryMoney(titleAmount, totalAllocated);

    const pending = bestSuggestionByTitle.get(key.externalId) ?? null;

    let status: CashSupportTitleStatus;
    const cmpDiff = compareTreasuryMoney(difference, ZERO);
    const hasAllocation = agg != null && compareTreasuryMoney(totalAllocated, ZERO) !== 0;
    if (!hasAllocation) {
      status = pending ? "REVIEW" : "UNRECONCILED";
    } else if (cmpDiff < 0) {
      // Alocado acima do valor do título sem justificativa — nunca deveria
      // acontecer (guarda do service); se aparecer, é divergência visível.
      status = "DIVERGENCE";
    } else if (cmpDiff > 0) {
      status = "PARTIAL";
    } else {
      status = agg!.hasManual ? "MANUAL_MATCHED" : "AUTO_MATCHED";
    }

    const legs = (agg?.legs ?? []).slice().sort((a, b) => {
      const dateCmp = (a.bankDate ?? "").localeCompare(b.bankDate ?? "");
      return dateCmp !== 0 ? dateCmp : a.bankMovementId.localeCompare(b.bankMovementId);
    });

    titleRows.push({
      tipo: key.side === "ACCOUNTS_RECEIVABLE" ? "CR" : "CP",
      titleKeyLabel: formatCashSupportOfficialTitleKey(key),
      displayId: row.displayId,
      externalId: key.externalId,
      companyCode: key.companyCode,
      counterparty: row.description,
      dueDate: row.dueDate,
      titleAmount,
      bankLegs: legs,
      totalAllocated,
      difference,
      justifiedDifference,
      hasJustifiedDifference: compareTreasuryMoney(justifiedDifference, ZERO) !== 0,
      status,
      statusLabel: CASH_SUPPORT_TITLE_STATUS_LABELS[status],
      matchIds: [...(agg?.matchIds ?? [])].sort(),
      pendingSuggestionKey: pending?.key ?? null,
      pendingSuggestionScore: pending?.score ?? null,
    });
  }

  // Vencimento asc, depois tipo/empresa/externalId — estável e previsível.
  titleRows.sort((a, b) => {
    const dateCmp = (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
    if (dateCmp !== 0) return dateCmp;
    if (a.tipo !== b.tipo) return a.tipo.localeCompare(b.tipo);
    return a.externalId - b.externalId;
  });

  // Movimentos sem explicação ------------------------------------------------
  const unexplainedMovements: CashSupportUnexplainedMovement[] = [];
  let unexplainedTotal: TreasuryMoneyString = ZERO;
  for (const row of input.rows) {
    if (row.resourceType !== "BANK_MOVEMENT" || !row.bankMovementKey) continue;
    if (compareTreasuryMoney(row.residualAmount, ZERO) === 0) continue;
    const movementId = row.bankMovementKey.bankMovementId;
    const best = bestSuggestionByMovement.get(movementId) ?? null;
    const residualAbs = absMoney(row.residualAmount);
    unexplainedMovements.push({
      displayId: row.displayId,
      bankMovementId: movementId,
      direction: row.direction,
      bankDate: row.bankDate,
      description: row.description,
      accountName: row.accountContext?.accountName ?? null,
      bankAmount: row.bankAmount ?? ZERO,
      residualAmount: row.residualAmount,
      bestSuggestionKey: best?.key ?? null,
      bestSuggestionScore: best?.score ?? null,
      bestSuggestionConfidence: best?.confidence ?? null,
    });
    unexplainedTotal = addTreasuryMoney(unexplainedTotal, residualAbs);
  }
  unexplainedMovements.sort((a, b) => {
    const dateCmp = (a.bankDate ?? "").localeCompare(b.bankDate ?? "");
    return dateCmp !== 0 ? dateCmp : a.bankMovementId.localeCompare(b.bankMovementId);
  });

  // Cards --------------------------------------------------------------------
  const cards: CashSupportReconciliationCards = {
    totalTitles: titleRows.length,
    autoMatchedCount: titleRows.filter((r) => r.status === "AUTO_MATCHED").length,
    manualMatchedCount: titleRows.filter((r) => r.status === "MANUAL_MATCHED").length,
    reviewCount: titleRows.filter((r) => r.status === "REVIEW").length,
    partialCount: titleRows.filter((r) => r.status === "PARTIAL").length,
    divergenceCount: titleRows.filter((r) => r.status === "DIVERGENCE").length,
    unreconciledCount: titleRows.filter((r) => r.status === "UNRECONCILED").length,
    unexplainedMovementsCount: unexplainedMovements.length,
    unexplainedMovementsTotal: unexplainedTotal,
  };

  return { titleRows, unexplainedMovements, cards };
}
