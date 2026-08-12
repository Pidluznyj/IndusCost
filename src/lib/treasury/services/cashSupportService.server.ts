/**
 * Orquestrador do Apoio ao Caixa (CS-006) — a única camada com I/O.
 *
 * Compõe os três serviços oficiais já existentes (nenhum é reimplementado):
 *   - treasuryCaixaService.getBoard        → canonicalDays
 *   - treasuryBankMovementQueryService     → movimentos bancários (com ACL)
 *   - treasuryReconciliationMatchService   → matches ativos por movimento
 * e entrega o resultado a `buildCashSupportReadModel` (função pura, CS-005).
 *
 * Autenticação/RBAC/ACL/feature flag continuam nas rotas (`treasuryRoutes.ts`),
 * igual ao resto do módulo — este service não decide permissão, só monta dado.
 */

import type { PrismaClient } from "@prisma/client";
import { createTreasuryCaixaService } from "./treasuryCaixaService.server.js";
import {
  buildTreasuryBankMovementQueryActor,
  createTreasuryBankMovementQueryService,
  type TreasuryBankMovementQueryActor,
} from "./treasuryBankMovementQueryService.server.js";
import {
  buildTreasuryReconciliationMatchActor,
  createTreasuryReconciliationMatchService,
  type TreasuryReconciliationMatchActor,
} from "./treasuryReconciliationMatchService.server.js";
import { treasuryCompanyCodePresentWhere } from "../treasuryPrismaFilters.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryReconciliationMatchDto } from "../contracts/treasuryDto.js";
import { buildCashSupportReadModel } from "../domain/cashSupportReadModel.js";
import { buildCashSupportSuggestions } from "../domain/cashSupportSuggestionsAdapter.js";
import {
  TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION,
  type TreasuryReconciliationSuggestionEngineResult,
} from "../domain/treasuryReconciliationSuggestionEngine.js";
import {
  CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION,
  buildCashSupportAutoJustification,
  planCashSupportAutoReconciliation,
} from "../domain/cashSupportAutoReconcile.js";
import {
  buildCashSupportTitleGrid,
  type CashSupportTitleGridViewModel,
} from "../domain/cashSupportTitleGrid.js";
import type {
  CashSupportFilters,
  CashSupportReadModel,
} from "../contracts/cashSupportContracts.js";

export type CashSupportServiceActor = {
  appUser: AppAuthContext;
  requestId: string | null;
};

export type CashSupportAutoReconcileRunResult = {
  algorithmVersion: string;
  ruleVersion: string;
  analyzedMovements: number;
  /** Matches criados NESTA execução. */
  autoAccepted: number;
  /** Idempotência: a chave já existia — nada novo foi gravado. */
  alreadyReconciled: number;
  needsReview: number;
  unmatched: number;
  failures: Array<{ suggestionKey: string; movementId: string; message: string }>;
};

export type CashSupportHistoryResult = {
  matches: TreasuryReconciliationMatchDto[];
  analysisAsOfDateTime: string;
};

export type CashSupportTitleGridResult = CashSupportTitleGridViewModel & {
  analysisAsOfDateTime: string;
};

export type CashSupportService = {
  getSuggestions(
    actor: CashSupportServiceActor,
    filters: CashSupportFilters
  ): Promise<TreasuryReconciliationSuggestionEngineResult>;
  getReadModel(
    actor: CashSupportServiceActor,
    filters: CashSupportFilters
  ): Promise<CashSupportReadModel>;
  /** Grid orientado a título (Conciliação por Títulos) + movimentos sem explicação + cards. */
  getTitleGrid(
    actor: CashSupportServiceActor,
    filters: CashSupportFilters
  ): Promise<CashSupportTitleGridResult>;
  /**
   * Auto-conciliação conservadora e idempotente: só persiste candidato HIGH
   * único sem concorrência (regras em cashSupportAutoReconcile.ts), sempre
   * via `matchService.accept` com idempotencyKey — NUNCA baixa oficial.
   */
  runAutoReconciliation(
    actor: CashSupportServiceActor,
    filters: CashSupportFilters
  ): Promise<CashSupportAutoReconcileRunResult>;
  /** Histórico de conciliações (inclui desfeitas) por período. */
  getHistory(
    actor: CashSupportServiceActor,
    filters: CashSupportFilters
  ): Promise<CashSupportHistoryResult>;
};

/**
 * `treasuryCaixaService.getBoard` só aceita ano OU ano+mês OU ano+mês+dia —
 * nunca um intervalo arbitrário. Pedir só o ano de `civilDateFrom` (sem mês)
 * carrega o ANO INTEIRO como superset; `buildCashSupportReadModel` (CS-005)
 * já filtra as linhas pelo intervalo exato `civilDateFrom..civilDateTo`
 * depois. Passar o mês aqui truncaria os títulos ao mês de `civilDateFrom`
 * mesmo quando o usuário pediu "todos os meses" ou um intervalo mais amplo —
 * os movimentos bancários continuariam cobrindo o período inteiro (usam
 * from/to diretamente), gerando dado inconsistente entre as duas fontes.
 */
function civilDateToYear(civilDateFrom: string): number {
  return Number(civilDateFrom.slice(0, 4));
}

export function createCashSupportService(deps: {
  prisma: PrismaClient;
}): CashSupportService {
  const { prisma } = deps;
  const caixaService = createTreasuryCaixaService({ prisma });
  const bankMovementService = createTreasuryBankMovementQueryService({ prisma });
  const reconciliationService = createTreasuryReconciliationMatchService({ prisma });

  async function loadReadModelWithMatches(
    actor: CashSupportServiceActor,
    filters: CashSupportFilters
  ): Promise<{
    readModel: CashSupportReadModel;
    activeMatches: TreasuryReconciliationMatchDto[];
  }> {
    const bankActor: TreasuryBankMovementQueryActor = buildTreasuryBankMovementQueryActor(
      actor.appUser,
      actor.requestId ?? undefined
    );
    const reconciliationActor: TreasuryReconciliationMatchActor =
      buildTreasuryReconciliationMatchActor(actor.appUser, actor.requestId ?? undefined);

    const year = civilDateToYear(filters.civilDateFrom);

    const [board, movementsPage, companyAccounts] = await Promise.all([
      caixaService.getBoard({ year }),
      bankMovementService.listMovements(bankActor, {
        page: 1,
        pageSize: 200,
        companyCode: filters.companyCode ?? null,
        accountId: filters.accountId ?? null,
        batchId: null,
        bucket: null,
        reconciliationStatus: null,
        search: filters.search ?? null,
        from: filters.civilDateFrom,
        to: filters.civilDateTo,
      }),
      prisma.treasuryFinancialAccount.findMany({
        where: { isActive: true, ...treasuryCompanyCodePresentWhere() },
        select: { companyCode: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
    ]);

    // Mesma resolução monoempresa do board (treasuryCaixaService.server.ts) —
    // não é recalculada por regra nova, só reutilizada aqui.
    const companyCode = companyAccounts[0]?.companyCode?.trim() || null;

    const activeMatchesByMovementId = new Map<
      string,
      readonly TreasuryReconciliationMatchDto[]
    >();
    // N+1 aceitável para o volume de uma página (≤200) — documentado como
    // limitação de escala em 13-full-implementation-checklist.md; otimizar
    // com uma query em lote fica para pós-MVP se o volume exigir.
    await Promise.all(
      movementsPage.items.map(async (movement) => {
        const matches = await reconciliationService.listActiveByBankMovement(
          reconciliationActor,
          movement.id
        );
        if (matches.length > 0) {
          activeMatchesByMovementId.set(movement.id, matches);
        }
      })
    );

    // Achata sem duplicar: match N↔N aparece em vários movimentos do índice.
    const seenMatchIds = new Set<string>();
    const activeMatches: TreasuryReconciliationMatchDto[] = [];
    for (const matches of activeMatchesByMovementId.values()) {
      for (const match of matches) {
        if (seenMatchIds.has(match.id)) continue;
        seenMatchIds.add(match.id);
        activeMatches.push(match);
      }
    }

    const readModel = buildCashSupportReadModel({
      canonicalDays: board.canonicalDays,
      companyCode,
      bankMovements: movementsPage.items,
      activeMatchesByMovementId,
      filters,
      analysisAsOfDateTime: new Date().toISOString(),
    });

    return { readModel, activeMatches };
  }

  function resolveCompanyCode(
    readModel: CashSupportReadModel,
    filters: CashSupportFilters
  ): string {
    const fromRows = readModel.rows.find((r) => r.companyContext)?.companyContext
      ?.companyCode;
    return filters.companyCode ?? fromRows ?? "";
  }

  const service: CashSupportService = {
    async getReadModel(actor, filters) {
      const { readModel } = await loadReadModelWithMatches(actor, filters);
      return readModel;
    },

    async getSuggestions(actor, filters) {
      // Reusa o mesmo pipeline de getReadModel (sem duplicar carga/adaptação)
      // com o teto de página já usado na listagem de movimentos (200) — o
      // motor de sugestões não precisa de mais linhas do que isso por janela.
      const readModel = await service.getReadModel(actor, {
        ...filters,
        page: 1,
        pageSize: 200,
      });
      return buildCashSupportSuggestions({
        rows: readModel.rows,
        companyCode: resolveCompanyCode(readModel, filters),
        asOfCivilDate: filters.civilDateTo,
      });
    },

    async getTitleGrid(actor, filters) {
      const { readModel, activeMatches } = await loadReadModelWithMatches(actor, {
        ...filters,
        page: 1,
        pageSize: 200,
      });
      const suggestions = buildCashSupportSuggestions({
        rows: readModel.rows,
        companyCode: resolveCompanyCode(readModel, filters),
        asOfCivilDate: filters.civilDateTo,
      });
      const grid = buildCashSupportTitleGrid({
        rows: readModel.rows,
        matches: activeMatches,
        suggestions: suggestions.suggestions,
      });
      return { ...grid, analysisAsOfDateTime: readModel.analysisAsOfDateTime };
    },

    async runAutoReconciliation(actor, filters) {
      const runStartedAt = Date.now();
      const reconciliationActor: TreasuryReconciliationMatchActor =
        buildTreasuryReconciliationMatchActor(actor.appUser, actor.requestId ?? undefined);

      const { readModel } = await loadReadModelWithMatches(actor, {
        ...filters,
        page: 1,
        pageSize: 200,
      });
      const companyCode = resolveCompanyCode(readModel, filters);
      const engineResult = buildCashSupportSuggestions({
        rows: readModel.rows,
        companyCode,
        asOfCivilDate: filters.civilDateTo,
      });
      const plan = planCashSupportAutoReconciliation(engineResult);

      // Índice movimento → linha (accountId/bankDate vêm da linha oficial).
      const movementRowById = new Map(
        readModel.rows
          .filter((r) => r.resourceType === "BANK_MOVEMENT" && r.bankMovementKey)
          .map((r) => [r.bankMovementKey!.bankMovementId, r] as const)
      );

      let autoAccepted = 0;
      let alreadyReconciled = 0;
      const failures: CashSupportAutoReconcileRunResult["failures"] = [];

      // Sequencial de propósito: aceites disputam locks de movimento/título;
      // ordem determinística (já ordenado por suggestionKey no plano).
      for (const decision of plan.autoAcceptable) {
        const { candidate } = decision;
        // Todas as pernas do candidato (1:1 e combinações 1 título ↔ N
        // movimentos) precisam existir no read model, na MESMA conta.
        const legRows = candidate.movementLegs.map((leg) => ({
          leg,
          row: movementRowById.get(leg.movementId) ?? null,
        }));
        const invalidLeg = legRows.find(
          ({ row }) => !row?.accountContext || !row.bankDate
        );
        if (invalidLeg) {
          failures.push({
            suggestionKey: candidate.suggestionKey,
            movementId: invalidLeg.leg.movementId,
            message: "Movimento sem conta/data no read model — não auto-conciliável.",
          });
          continue;
        }
        const accountIds = new Set(
          legRows.map(({ row }) => row!.accountContext!.accountId)
        );
        if (accountIds.size !== 1) {
          failures.push({
            suggestionKey: candidate.suggestionKey,
            movementId: candidate.movementId,
            message: "Combinação atravessa contas distintas — requer conciliação manual.",
          });
          continue;
        }
        // companyCode do ACEITE = empresa da conta do movimento (linha do
        // read model), nunca o global do período: ambiente multi-empresa
        // (Lazarios/Koppetel/SM) tem contas de empresas diferentes na mesma
        // janela, e o accept valida companyCode × conta.
        const legCompanyCodes = new Set(
          legRows.map(({ row }) => row!.companyContext?.companyCode ?? null)
        );
        const movementCompanyCode = [...legCompanyCodes][0];
        if (legCompanyCodes.size !== 1 || !movementCompanyCode) {
          failures.push({
            suggestionKey: candidate.suggestionKey,
            movementId: candidate.movementId,
            message:
              "Movimento sem empresa resolvida (ou combinação entre empresas) — requer conciliação manual.",
          });
          continue;
        }
        // Data do match = perna mais recente (última entrada que fechou o título).
        const matchedCivilDate = legRows
          .map(({ row }) => row!.bankDate!)
          .sort()
          .at(-1)!;
        try {
          const { match } = await reconciliationService.accept(reconciliationActor, {
            companyCode: movementCompanyCode,
            accountId: [...accountIds][0]!,
            matchedCivilDate,
            justification: buildCashSupportAutoJustification(candidate, decision.rule),
            movements: candidate.movementLegs.map((leg) => ({
              bankMovementId: leg.movementId,
              amount: leg.suggestedAmount,
            })),
            allocations: candidate.allocations.map((alloc) => ({
              kind: "TITLE",
              amount: alloc.suggestedAmount,
              memo: null,
              nomusSide: alloc.side,
              officialTitleId: alloc.officialTitleId,
              nomusExternalId: alloc.externalId,
              openBalance: null,
              transferId: null,
              transferGroupId: null,
              ledgerEntryId: null,
              differenceCode: null,
            })),
            idempotencyKey: decision.idempotencyKey,
            suggestionKey: candidate.suggestionKey,
            algorithmVersion: TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION,
            suggestionScore: candidate.score,
            suggestionConfidence: candidate.confidence,
            suggestionReasons: [...candidate.reasons],
          });
          // Aceite idempotente devolve o match preexistente quando a chave já
          // foi usada com o mesmo payload — distingue criado × repetido.
          if (new Date(match.createdAt).getTime() < runStartedAt) {
            alreadyReconciled += 1;
          } else {
            autoAccepted += 1;
          }
        } catch (err) {
          failures.push({
            suggestionKey: candidate.suggestionKey,
            movementId: candidate.movementId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        algorithmVersion: TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION,
        ruleVersion: CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION,
        analyzedMovements: plan.summary.movementsAnalyzed,
        autoAccepted,
        alreadyReconciled,
        needsReview: plan.summary.needsReviewCount,
        unmatched: plan.summary.unmatchedCount,
        failures,
      };
    },

    async getHistory(actor, filters) {
      const reconciliationActor: TreasuryReconciliationMatchActor =
        buildTreasuryReconciliationMatchActor(actor.appUser, actor.requestId ?? undefined);
      const matches = await reconciliationService.listByMatchedPeriod(
        reconciliationActor,
        {
          companyCode: filters.companyCode ?? null,
          accountId: filters.accountId ?? null,
          from: filters.civilDateFrom,
          to: filters.civilDateTo,
        }
      );
      return { matches, analysisAsOfDateTime: new Date().toISOString() };
    },
  };

  return service;
}
