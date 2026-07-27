/**
 * Serviço de APIs de projeção e agenda da Tesouraria.
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { PrismaClient } from "@prisma/client";
import type {
  TreasuryAgendaDto,
  TreasuryAgendaDayDto,
  TreasuryProjectionCompositionItemDto,
  TreasuryProjectionCompositionResponseDto,
  TreasuryProjectionConsolidatedDayDto,
  TreasuryProjectionDayLineDto,
  TreasuryProjectionFreshnessDto,
  TreasuryProjectionRunDto,
} from "../contracts/treasuryDto.js";
import type { TreasuryProjectionLayer } from "../contracts/treasuryEnums.js";
import type {
  TreasuryAgendaQuery,
  TreasuryProjectionCalculateInput,
  TreasuryProjectionCompositionQuery,
  TreasuryProjectionGetQuery,
  TreasuryProjectionLatestQuery,
} from "../contracts/treasurySchemas.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryProjectionEngineInput } from "../domain/treasuryProjectionEngine.js";
import {
  assertTreasuryProjectionHorizon,
  resolveTreasuryProjectionMaxHorizonDays,
} from "../domain/treasuryProjectionHorizon.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import type {
  TreasuryProjectionDayLineDetailed,
  TreasuryProjectionCompositionItemRow,
  TreasuryProjectionRunRepository,
  TreasuryProjectionRunRow,
} from "../repositories/treasuryProjectionRunRepository.server.js";
import { createTreasuryProjectionRunRepository } from "../repositories/treasuryProjectionRunRepository.server.js";
import {
  executeTreasuryProjection,
  getLatestValidTreasuryProjection,
} from "./treasuryProjectionExecutionService.server.js";

const STALE_MS = 24 * 60 * 60 * 1000;

export type TreasuryProjectionApiActor = {
  userId: string;
  isSuperAdmin: boolean;
  canViewDashboard: boolean;
  canViewAgenda: boolean;
  requestId: string | null;
};

export function buildTreasuryProjectionApiActor(
  user: AppAuthContext,
  requestId: string
): TreasuryProjectionApiActor {
  return {
    userId: user.id,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewDashboard: canTreasuryCapability(user, "viewDashboard"),
    canViewAgenda: canTreasuryCapability(user, "viewAgenda"),
    requestId,
  };
}

export type TreasuryProjectionEngineInputLoader = (input: {
  companyCode: string;
  scenario: TreasuryProjectionLayer;
  baseDate: string;
  endDate: string;
  accountIds: string[] | null;
}) => Promise<
  Omit<
    TreasuryProjectionEngineInput,
    "scenario" | "periodFrom" | "periodTo" | "asOfCivilDate"
  >
>;

export type TreasuryProjectionApiService = {
  calculate(
    actor: TreasuryProjectionApiActor,
    input: TreasuryProjectionCalculateInput
  ): Promise<TreasuryProjectionRunDto>;
  getLatest(
    actor: TreasuryProjectionApiActor,
    query: TreasuryProjectionLatestQuery
  ): Promise<TreasuryProjectionRunDto>;
  getById(
    actor: TreasuryProjectionApiActor,
    runId: string,
    query: TreasuryProjectionGetQuery
  ): Promise<TreasuryProjectionRunDto>;
  getComposition(
    actor: TreasuryProjectionApiActor,
    runId: string,
    query: TreasuryProjectionCompositionQuery
  ): Promise<TreasuryProjectionCompositionResponseDto>;
  getAgenda(
    actor: TreasuryProjectionApiActor,
    query: TreasuryAgendaQuery
  ): Promise<TreasuryAgendaDto>;
};

export type TreasuryProjectionApiDeps = {
  repository: TreasuryProjectionRunRepository;
  loadEngineInput: TreasuryProjectionEngineInputLoader;
  maxHorizonDays?: number;
  now?: () => Date;
};

function assertCanViewProjection(actor: TreasuryProjectionApiActor) {
  if (!actor.canViewDashboard && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para consultar projeções da Tesouraria."
    );
  }
}

function assertCanViewAgenda(actor: TreasuryProjectionApiActor) {
  if (!actor.canViewAgenda && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para consultar a agenda da Tesouraria."
    );
  }
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function civilKey(value: Date | string): string {
  const key = toCivilDateKey(value);
  if (!key) throw new Error("Data civil inválida");
  return key;
}

function buildFreshness(
  run: TreasuryProjectionRunRow | null,
  now: Date
): TreasuryProjectionFreshnessDto {
  const asOf = (run?.finishedAt ?? run?.requestedAt ?? now).toISOString();
  const last = run?.finishedAt ?? run?.requestedAt ?? null;
  const isStale = last ? now.getTime() - last.getTime() > STALE_MS : true;
  const sources = [
    {
      source: "PROJECTION_RUN" as const,
      label: "Projeção persistida",
      lastSuccessAt: toIso(last),
      isStale,
      detail: run
        ? `status=${run.status}; sourceVersion=${run.sourceVersion.slice(0, 12)}`
        : "Nenhuma projeção válida",
    },
  ];
  return {
    asOf,
    sources,
    hasStaleSource: isStale,
    staleSourceCount: isStale ? 1 : 0,
  };
}

function mapDayLine(row: TreasuryProjectionDayLineDetailed): TreasuryProjectionDayLineDto {
  return {
    id: row.id,
    accountId: row.accountId,
    civilDate: civilKey(row.civilDate) as TreasuryProjectionDayLineDto["civilDate"],
    openingBalance: normalizeTreasuryMoneyString(row.openingBalance),
    inflows: normalizeTreasuryMoneyString(row.inflows),
    outflows: normalizeTreasuryMoneyString(row.outflows),
    transfers: normalizeTreasuryMoneyString(row.transfers),
    realized: normalizeTreasuryMoneyString(row.realized),
    closingBalance: normalizeTreasuryMoneyString(row.closingBalance),
    uncertainReceivables: normalizeTreasuryMoneyString(row.uncertainReceivables),
    minimumBalance: normalizeTreasuryMoneyString(row.minimumBalance),
    riskAmount: normalizeTreasuryMoneyString(row.riskAmount),
    riskCode: row.riskCode,
    itemCount: row.itemCount,
  };
}

function mapCompositionItem(
  row: TreasuryProjectionCompositionItemRow
): TreasuryProjectionCompositionItemDto {
  return {
    id: row.id,
    dayLineId: row.dayLineId,
    accountId: row.accountId,
    civilDate: civilKey(row.civilDate) as TreasuryProjectionCompositionItemDto["civilDate"],
    itemKind: row.itemKind,
    amount: normalizeTreasuryMoneyString(row.amount),
    label: row.label,
    officialTitleId: row.officialTitleId,
    nomusExternalId: row.nomusExternalId,
    ledgerEntryId: row.ledgerEntryId,
    transferGroupId: row.transferGroupId,
    sourceRef: row.sourceRef,
    sortOrder: row.sortOrder,
  };
}

function consolidateDays(
  lines: TreasuryProjectionDayLineDto[]
): TreasuryProjectionConsolidatedDayDto[] {
  const byDate = new Map<string, TreasuryProjectionConsolidatedDayDto>();
  for (const line of lines) {
    const cur = byDate.get(line.civilDate);
    if (!cur) {
      byDate.set(line.civilDate, {
        civilDate: line.civilDate,
        openingBalance: line.openingBalance,
        inflows: line.inflows,
        outflows: line.outflows,
        transfers: line.transfers,
        realized: line.realized,
        closingBalance: line.closingBalance,
        uncertainReceivables: line.uncertainReceivables,
        riskAmount: line.riskAmount,
        itemCount: line.itemCount,
      });
      continue;
    }
    cur.openingBalance = addTreasuryMoney(cur.openingBalance, line.openingBalance);
    cur.inflows = addTreasuryMoney(cur.inflows, line.inflows);
    cur.outflows = addTreasuryMoney(cur.outflows, line.outflows);
    cur.transfers = addTreasuryMoney(cur.transfers, line.transfers);
    cur.realized = addTreasuryMoney(cur.realized, line.realized);
    cur.closingBalance = addTreasuryMoney(cur.closingBalance, line.closingBalance);
    cur.uncertainReceivables = addTreasuryMoney(
      cur.uncertainReceivables,
      line.uncertainReceivables
    );
    cur.riskAmount = addTreasuryMoney(cur.riskAmount, line.riskAmount);
    cur.itemCount += line.itemCount;
  }
  return [...byDate.values()].sort((a, b) =>
    a.civilDate.localeCompare(b.civilDate)
  );
}

function filterAccountsInEngineInput(
  engineInput: Omit<
    TreasuryProjectionEngineInput,
    "scenario" | "periodFrom" | "periodTo" | "asOfCivilDate"
  >,
  accountIds: string[] | null,
  consolidated: boolean
) {
  let accounts = engineInput.accounts;
  if (accountIds?.length) {
    const set = new Set(accountIds);
    accounts = accounts.filter((a) => set.has(a.accountId));
  } else if (consolidated) {
    accounts = accounts.filter((a) => a.includeInConsolidated);
  }
  if (accounts.length === 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Nenhuma conta elegível para o filtro informado.",
      "accountIds"
    );
  }
  const allowed = new Set(accounts.map((a) => a.accountId));
  const fallbackAccountId =
    engineInput.fallbackAccountId && allowed.has(engineInput.fallbackAccountId)
      ? engineInput.fallbackAccountId
      : accounts[0]!.accountId;
  return {
    ...engineInput,
    accounts,
    fallbackAccountId,
    receivables: engineInput.receivables.filter(
      (r) => !r.accountId || allowed.has(r.accountId)
    ),
    payables: engineInput.payables.filter(
      (p) => !p.accountId || allowed.has(p.accountId)
    ),
  };
}

async function buildRunDto(
  run: TreasuryProjectionRunRow,
  deps: TreasuryProjectionApiDeps,
  opts: {
    accountIds: string[] | null;
    consolidated: boolean;
    includeDayDetail: boolean;
    previousValidRunId?: string | null;
  }
): Promise<TreasuryProjectionRunDto> {
  const now = deps.now?.() ?? new Date();
  let dayLines: TreasuryProjectionDayLineDto[] | null = null;
  let consolidatedDays: TreasuryProjectionConsolidatedDayDto[] | null = null;
  if (opts.includeDayDetail || opts.consolidated) {
    const detailed = await deps.repository.listDayLinesDetailed(run.id, {
      accountIds: opts.accountIds,
    });
    const mapped = detailed.map(mapDayLine);
    if (opts.includeDayDetail) dayLines = mapped;
    if (opts.consolidated) consolidatedDays = consolidateDays(mapped);
  }
  return {
    ok: true,
    id: run.id,
    companyCode: run.companyCode,
    scenario: run.scenario as TreasuryProjectionLayer,
    status: run.status,
    baseDate: civilKey(run.periodFrom) as TreasuryProjectionRunDto["baseDate"],
    endDate: civilKey(run.periodTo) as TreasuryProjectionRunDto["endDate"],
    sourceVersion: run.sourceVersion,
    algorithmVersion: run.algorithmVersion,
    freshness: buildFreshness(run, now),
    lineCount: run.lineCount,
    itemCount: run.itemCount,
    requestedAt: run.requestedAt.toISOString(),
    startedAt: toIso(run.startedAt),
    finishedAt: toIso(run.finishedAt),
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    dayLines,
    consolidatedDays,
    previousValidRunId: opts.previousValidRunId,
  };
}

export function createTreasuryProjectionApiService(
  deps: TreasuryProjectionApiDeps
): TreasuryProjectionApiService {
  const maxHorizonDays =
    deps.maxHorizonDays ?? resolveTreasuryProjectionMaxHorizonDays();

  return {
    async calculate(actor, input) {
      assertCanViewProjection(actor);
      assertTreasuryProjectionHorizon({
        baseDate: input.baseDate,
        endDate: input.endDate,
        maxHorizonDays,
      });
      const loaded = await deps.loadEngineInput({
        companyCode: input.companyCode,
        scenario: input.scenario,
        baseDate: input.baseDate,
        endDate: input.endDate,
        accountIds: input.accountIds,
      });
      const engineInput = filterAccountsInEngineInput(
        loaded,
        input.accountIds,
        input.consolidated
      );
      const result = await executeTreasuryProjection(
        {
          companyCode: input.companyCode,
          scenario: input.scenario,
          periodFrom: input.baseDate,
          periodTo: input.endDate,
          asOfCivilDate: input.baseDate,
          actorUserId: actor.userId,
          requestId: actor.requestId,
          idempotencyKey: input.idempotencyKey,
          notes: input.notes,
          engineInput,
        },
        {
          repository: deps.repository,
          now: deps.now,
        }
      );
      return buildRunDto(result.run, deps, {
        accountIds: input.accountIds,
        consolidated: input.consolidated,
        includeDayDetail: input.includeDayDetail,
        previousValidRunId: result.previousValidRunId,
      });
    },

    async getLatest(actor, query) {
      assertCanViewProjection(actor);
      const run = await getLatestValidTreasuryProjection(
        query.companyCode,
        query.scenario,
        { repository: deps.repository }
      );
      if (!run) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Nenhuma projeção válida encontrada para empresa/cenário."
        );
      }
      return buildRunDto(run, deps, {
        accountIds: query.accountIds,
        consolidated: query.consolidated,
        includeDayDetail: query.includeDayDetail,
      });
    },

    async getById(actor, runId, query) {
      assertCanViewProjection(actor);
      const id = runId.trim();
      if (!id) {
        throw new TreasuryDomainError("REQUIRED_FIELD", "id é obrigatório.", "id");
      }
      const run = await deps.repository.findById(id);
      if (!run) {
        throw new TreasuryDomainError("NOT_FOUND", "Projeção não encontrada.", "id");
      }
      return buildRunDto(run, deps, {
        accountIds: query.accountIds,
        consolidated: query.consolidated,
        includeDayDetail: query.includeDayDetail,
      });
    },

    async getComposition(actor, runId, query) {
      assertCanViewProjection(actor);
      const id = runId.trim();
      const run = await deps.repository.findById(id);
      if (!run) {
        throw new TreasuryDomainError("NOT_FOUND", "Projeção não encontrada.", "id");
      }
      const items = await deps.repository.listCompositionItems(id, {
        accountIds: query.accountIds,
        from: query.from,
        to: query.to,
      });
      const now = deps.now?.() ?? new Date();
      return {
        ok: true,
        runId: run.id,
        companyCode: run.companyCode,
        scenario: run.scenario as TreasuryProjectionLayer,
        baseDate: civilKey(run.periodFrom) as TreasuryProjectionCompositionResponseDto["baseDate"],
        endDate: civilKey(run.periodTo) as TreasuryProjectionCompositionResponseDto["endDate"],
        sourceVersion: run.sourceVersion,
        algorithmVersion: run.algorithmVersion,
        freshness: buildFreshness(run, now),
        items: items.map(mapCompositionItem),
        accountIds: query.accountIds,
      };
    },

    async getAgenda(actor, query) {
      assertCanViewAgenda(actor);
      assertTreasuryProjectionHorizon({
        baseDate: query.baseDate,
        endDate: query.endDate,
        maxHorizonDays,
      });
      const run = await getLatestValidTreasuryProjection(
        query.companyCode,
        query.scenario,
        { repository: deps.repository }
      );
      const now = deps.now?.() ?? new Date();
      if (!run) {
        return {
          ok: true,
          runId: null,
          companyCode: query.companyCode,
          scenario: query.scenario,
          baseDate: query.baseDate,
          endDate: query.endDate,
          consolidated: query.consolidated,
          accountIds: query.accountIds,
          sourceVersion: null,
          algorithmVersion: null,
          freshness: buildFreshness(null, now),
          days: [],
          maxHorizonDays,
        };
      }

      const lines = (
        await deps.repository.listDayLinesDetailed(run.id, {
          accountIds: query.accountIds,
          from: query.baseDate,
          to: query.endDate,
        })
      ).map(mapDayLine);

      const composition = query.includeDayDetail
        ? (
            await deps.repository.listCompositionItems(run.id, {
              accountIds: query.accountIds,
              from: query.baseDate,
              to: query.endDate,
            })
          ).map(mapCompositionItem)
        : [];

      // Agenda agrega por dia (consolidado ou soma das contas filtradas).
      const byDate = consolidateDays(lines);

      const days: TreasuryAgendaDayDto[] = byDate.map((d) => {
        const net = subtractTreasuryMoney(
          d.inflows as TreasuryMoneyString,
          d.outflows as TreasuryMoneyString
        );
        return {
          civilDate: d.civilDate,
          inflows: d.inflows,
          outflows: d.outflows,
          net,
          realized: d.realized,
          closingBalance: d.closingBalance,
          itemCount: d.itemCount,
          items: query.includeDayDetail
            ? composition.filter((c) => c.civilDate === d.civilDate)
            : null,
        };
      });

      return {
        ok: true,
        runId: run.id,
        companyCode: run.companyCode,
        scenario: query.scenario,
        baseDate: query.baseDate,
        endDate: query.endDate,
        consolidated: query.consolidated,
        accountIds: query.accountIds,
        sourceVersion: run.sourceVersion,
        algorithmVersion: run.algorithmVersion,
        freshness: buildFreshness(run, now),
        days,
        maxHorizonDays,
      };
    },
  };
}

/** Loader mínimo: uma conta sintética — testes devem injetar loader rico. */
export function createEmptyTreasuryProjectionEngineInputLoader(): TreasuryProjectionEngineInputLoader {
  return async ({ accountIds }) => {
    const accountId =
      accountIds?.[0] ?? "00000000-0000-4000-8000-000000000001";
    return {
      accounts: [
        {
          accountId,
          code: "DEFAULT",
          includeInConsolidated: true,
          minimumBalance: "0.00",
          openingBalance: "0.00",
        },
      ],
      receivables: [],
      payables: [],
      settlements: [],
      expectations: [],
      promises: [],
      programming: [],
      ledgerEntries: [],
      transfers: [],
      fallbackAccountId: accountId,
    };
  };
}

export function createTreasuryProjectionApiDeps(
  db: PrismaClient,
  options?: {
    loadEngineInput?: TreasuryProjectionEngineInputLoader;
    maxHorizonDays?: number;
  }
): TreasuryProjectionApiDeps {
  return {
    repository: createTreasuryProjectionRunRepository(db),
    loadEngineInput:
      options?.loadEngineInput ?? createEmptyTreasuryProjectionEngineInputLoader(),
    maxHorizonDays: options?.maxHorizonDays,
  };
}
