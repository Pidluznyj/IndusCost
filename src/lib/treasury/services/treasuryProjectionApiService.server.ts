/**
 * Serviço de APIs de projeção e agenda da Tesouraria.
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { PrismaClient } from "@prisma/client";
import type {
  TreasuryAgendaDto,
  TreasuryAgendaDayDto,
  TreasuryAlertItemDto,
  TreasuryProjectionComparisonDto,
  TreasuryProjectionCompositionItemDto,
  TreasuryProjectionCompositionResponseDto,
  TreasuryProjectionConsolidatedDayDto,
  TreasuryProjectionDayLineDto,
  TreasuryProjectionFreshnessDto,
  TreasuryProjectionRunDto,
} from "../contracts/treasuryDto.js";
import { DEFAULT_TREASURY_ALERT_SETTINGS } from "../contracts/treasuryAlertConfig.js";
import {
  buildTreasuryAlerts,
  filterTreasuryAlertsForCivilDate,
} from "../domain/treasuryAlertRules.js";
import { createTreasuryAlertSettingsService } from "./treasuryAlertSettingsService.server.js";
import type { TreasuryProjectionLayer } from "../contracts/treasuryEnums.js";
import type {
  TreasuryAgendaQuery,
  TreasuryProjectionCalculateInput,
  TreasuryProjectionCompareQuery,
  TreasuryProjectionCompositionQuery,
  TreasuryProjectionGetQuery,
  TreasuryProjectionLatestQuery,
} from "../contracts/treasurySchemas.js";
import {
  buildTreasuryAgendaDay,
  mergeAgendaScenarioSeeds,
  pickHigherRiskCode,
  type TreasuryAgendaScenarioDaySeed,
} from "../domain/treasuryAgendaDayRules.js";
import {
  TREASURY_COMPARISON_SCENARIOS,
  buildTreasuryProjectionComparison,
  type TreasuryComparisonScenario,
} from "../domain/treasuryProjectionComparisonRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryProjectionEngineInput } from "../domain/treasuryProjectionEngine.js";
import {
  assertTreasuryProjectionHorizon,
  resolveTreasuryProjectionMaxHorizonDays,
} from "../domain/treasuryProjectionHorizon.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
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
  compareScenarios(
    actor: TreasuryProjectionApiActor,
    query: TreasuryProjectionCompareQuery
  ): Promise<TreasuryProjectionComparisonDto>;
};

export type TreasuryProjectionApiDeps = {
  repository: TreasuryProjectionRunRepository;
  loadEngineInput: TreasuryProjectionEngineInputLoader;
  maxHorizonDays?: number;
  now?: () => Date;
  prisma?: PrismaClient;
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
  const byDate = new Map<
    string,
    TreasuryProjectionConsolidatedDayDto & { riskCode: string }
  >();
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
        riskCode: line.riskCode,
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
    cur.riskCode = pickHigherRiskCode(cur.riskCode, line.riskCode);
    cur.itemCount += line.itemCount;
  }
  return [...byDate.values()]
    .map(({ riskCode: _r, ...rest }) => rest)
    .sort((a, b) => a.civilDate.localeCompare(b.civilDate));
}

function lineToAgendaSeed(
  line: TreasuryProjectionDayLineDto,
  accountId: string | null
): TreasuryAgendaScenarioDaySeed {
  return {
    civilDate: line.civilDate,
    accountId,
    openingBalance: line.openingBalance,
    inflows: line.inflows,
    outflows: line.outflows,
    transfers: line.transfers,
    realized: line.realized,
    closingBalance: line.closingBalance,
    riskAmount: line.riskAmount,
    riskCode: line.riskCode,
    itemCount: line.itemCount,
  };
}

async function loadScenarioDayLines(
  repository: TreasuryProjectionRunRepository,
  companyCode: string,
  scenario: TreasuryProjectionLayer,
  filter: {
    accountIds: string[] | null;
    from: string;
    to: string;
  }
): Promise<{
  runId: string | null;
  sourceVersion: string | null;
  algorithmVersion: string | null;
  run: TreasuryProjectionRunRow | null;
  lines: TreasuryProjectionDayLineDto[];
}> {
  const run = await getLatestValidTreasuryProjection(companyCode, scenario, {
    repository,
  });
  if (!run) {
    return {
      runId: null,
      sourceVersion: null,
      algorithmVersion: null,
      run: null,
      lines: [],
    };
  }
  const lines = (
    await repository.listDayLinesDetailed(run.id, {
      accountIds: filter.accountIds,
      from: filter.from,
      to: filter.to,
    })
  ).map(mapDayLine);
  return {
    runId: run.id,
    sourceVersion: run.sourceVersion,
    algorithmVersion: run.algorithmVersion,
    run,
    lines,
  };
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
      const now = deps.now?.() ?? new Date();
      const bucketScenarios: TreasuryProjectionLayer[] = [
        "CONTRACTUAL",
        "PROBABLE",
        "CONFIRMED",
      ];
      const scenariosToLoad: TreasuryProjectionLayer[] = bucketScenarios.includes(
        query.scenario
      )
        ? bucketScenarios
        : [...bucketScenarios, query.scenario];
      const loaded = await Promise.all(
        scenariosToLoad.map((scenario) =>
          loadScenarioDayLines(deps.repository, query.companyCode, scenario, {
            accountIds: query.accountIds,
            from: query.baseDate,
            to: query.endDate,
          })
        )
      );
      const byScenario = Object.fromEntries(
        scenariosToLoad.map((scenario, i) => [scenario, loaded[i]!])
      ) as Record<
        TreasuryProjectionLayer,
        Awaited<ReturnType<typeof loadScenarioDayLines>>
      >;
      const primary = byScenario[query.scenario];
      if (!primary?.run) {
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
          alerts: [],
          maxHorizonDays,
        };
      }

      const composition = query.includeDayDetail
        ? (
            await deps.repository.listCompositionItems(primary.run.id, {
              accountIds: query.accountIds,
              from: query.baseDate,
              to: query.endDate,
            })
          ).map(mapCompositionItem)
        : [];

      const days: TreasuryAgendaDayDto[] = [];

      if (query.consolidated) {
        const seedsByScenario: Partial<
          Record<TreasuryProjectionLayer, Map<string, TreasuryAgendaScenarioDaySeed>>
        > = {};
        for (const scenario of bucketScenarios) {
          const scenarioBundle = byScenario[scenario];
          if (!scenarioBundle) continue;
          const consolidated = consolidateDays(scenarioBundle.lines);
          const map = new Map<string, TreasuryAgendaScenarioDaySeed>();
          for (const d of consolidated) {
            map.set(
              d.civilDate,
              lineToAgendaSeed(
                {
                  id: d.civilDate,
                  accountId: "",
                  civilDate: d.civilDate,
                  openingBalance: d.openingBalance,
                  inflows: d.inflows,
                  outflows: d.outflows,
                  transfers: d.transfers,
                  realized: d.realized,
                  closingBalance: d.closingBalance,
                  uncertainReceivables: d.uncertainReceivables,
                  minimumBalance: "0.00",
                  riskAmount: d.riskAmount,
                  riskCode: "NONE",
                  itemCount: d.itemCount,
                },
                null
              )
            );
          }
          for (const line of scenarioBundle.lines) {
            const cur = map.get(line.civilDate);
            if (!cur) continue;
            cur.riskCode = pickHigherRiskCode(cur.riskCode, line.riskCode);
          }
          seedsByScenario[scenario] = map;
        }
        if (!bucketScenarios.includes(query.scenario) && primary.lines.length) {
          const consolidated = consolidateDays(primary.lines);
          const map = new Map<string, TreasuryAgendaScenarioDaySeed>();
          for (const d of consolidated) {
            map.set(
              d.civilDate,
              lineToAgendaSeed(
                {
                  id: d.civilDate,
                  accountId: "",
                  civilDate: d.civilDate,
                  openingBalance: d.openingBalance,
                  inflows: d.inflows,
                  outflows: d.outflows,
                  transfers: d.transfers,
                  realized: d.realized,
                  closingBalance: d.closingBalance,
                  uncertainReceivables: d.uncertainReceivables,
                  minimumBalance: "0.00",
                  riskAmount: d.riskAmount,
                  riskCode: "NONE",
                  itemCount: d.itemCount,
                },
                null
              )
            );
          }
          for (const line of primary.lines) {
            const cur = map.get(line.civilDate);
            if (!cur) continue;
            cur.riskCode = pickHigherRiskCode(cur.riskCode, line.riskCode);
          }
          seedsByScenario[query.scenario] = map;
        }
        const dates = new Set<string>();
        for (const map of Object.values(seedsByScenario)) {
          for (const key of map?.keys() ?? []) dates.add(key);
        }
        for (const civilDate of [...dates].sort()) {
          days.push(
            buildTreasuryAgendaDay({
              civilDate,
              accountId: null,
              primaryScenario: query.scenario,
              byScenario: {
                CONTRACTUAL: seedsByScenario.CONTRACTUAL?.get(civilDate),
                PROBABLE: seedsByScenario.PROBABLE?.get(civilDate),
                CONFIRMED: seedsByScenario.CONFIRMED?.get(civilDate),
                MANUAL: seedsByScenario.MANUAL?.get(civilDate),
              },
              items: query.includeDayDetail
                ? composition.filter((c) => c.civilDate === civilDate)
                : null,
            })
          );
        }
      } else {
        type Key = string;
        const keyOf = (civilDate: string, accountId: string) =>
          `${civilDate}|${accountId}`;
        const seedsByScenario: Partial<
          Record<TreasuryProjectionLayer, Map<Key, TreasuryAgendaScenarioDaySeed>>
        > = {};
        for (const scenario of bucketScenarios) {
          const scenarioBundle = byScenario[scenario];
          if (!scenarioBundle) continue;
          const map = new Map<Key, TreasuryAgendaScenarioDaySeed>();
          for (const line of scenarioBundle.lines) {
            const k = keyOf(line.civilDate, line.accountId);
            const existing = map.get(k);
            if (!existing) {
              map.set(k, lineToAgendaSeed(line, line.accountId));
            } else {
              const merged = mergeAgendaScenarioSeeds([
                existing,
                lineToAgendaSeed(line, line.accountId),
              ]);
              if (merged) map.set(k, merged);
            }
          }
          seedsByScenario[scenario] = map;
        }
        if (!bucketScenarios.includes(query.scenario) && primary.lines.length) {
          const map = new Map<Key, TreasuryAgendaScenarioDaySeed>();
          for (const line of primary.lines) {
            const k = keyOf(line.civilDate, line.accountId);
            const existing = map.get(k);
            if (!existing) {
              map.set(k, lineToAgendaSeed(line, line.accountId));
            } else {
              const merged = mergeAgendaScenarioSeeds([
                existing,
                lineToAgendaSeed(line, line.accountId),
              ]);
              if (merged) map.set(k, merged);
            }
          }
          seedsByScenario[query.scenario] = map;
        }
        const keys = new Set<Key>();
        for (const map of Object.values(seedsByScenario)) {
          for (const key of map?.keys() ?? []) keys.add(key);
        }
        for (const key of [...keys].sort()) {
          const [civilDate, accountId] = key.split("|") as [string, string];
          days.push(
            buildTreasuryAgendaDay({
              civilDate,
              accountId,
              primaryScenario: query.scenario,
              byScenario: {
                CONTRACTUAL: seedsByScenario.CONTRACTUAL?.get(key),
                PROBABLE: seedsByScenario.PROBABLE?.get(key),
                CONFIRMED: seedsByScenario.CONFIRMED?.get(key),
                MANUAL: seedsByScenario.MANUAL?.get(key),
              },
              items: query.includeDayDetail
                ? composition.filter(
                    (c) =>
                      c.civilDate === civilDate && c.accountId === accountId
                  )
                : null,
            })
          );
        }
      }

      let agendaAlerts: TreasuryAlertItemDto[] = [];
      if (deps.prisma) {
        const settingsService = createTreasuryAlertSettingsService({
          prisma: deps.prisma,
        });
        const settings = await settingsService.getFields().catch(() => ({
          ...DEFAULT_TREASURY_ALERT_SETTINGS,
        }));
        const built = buildTreasuryAlerts(settings, {
          asOfCivilDate: query.baseDate,
          nowEpochMs: now.getTime(),
          projectionDays: days.map((d) => ({
            civilDate: d.civilDate,
            accountId: d.accountId,
            closingBalance: d.closingBalance,
          })),
          syncFreshness: [
            {
              side: "PROJECTION_RUN",
              lastSuccessAtIso: toIso(
                primary.run.finishedAt ?? primary.run.requestedAt
              ),
            },
          ],
        });
        agendaAlerts = built.map((a) => ({
          id: a.id,
          kind: a.kind,
          severity: a.severity,
          title: a.title,
          description: a.description,
          amount: a.amount,
          accountId: a.accountId,
          civilDate: a.civilDate,
          entityId: a.entityId,
          metadata: a.metadata,
        }));
        for (const day of days) {
          day.alerts = filterTreasuryAlertsForCivilDate(
            built,
            day.civilDate
          ).map((a) => ({
            id: a.id,
            kind: a.kind,
            severity: a.severity,
            title: a.title,
            description: a.description,
            amount: a.amount,
            accountId: a.accountId,
            civilDate: a.civilDate,
            entityId: a.entityId,
            metadata: a.metadata,
          }));
        }
      }

      return {
        ok: true,
        runId: primary.run.id,
        companyCode: primary.run.companyCode,
        scenario: query.scenario,
        baseDate: query.baseDate,
        endDate: query.endDate,
        consolidated: query.consolidated,
        accountIds: query.accountIds,
        sourceVersion: primary.sourceVersion,
        algorithmVersion: primary.algorithmVersion,
        freshness: buildFreshness(primary.run, now),
        days,
        alerts: agendaAlerts,
        maxHorizonDays,
      };
    },

    async compareScenarios(actor, query) {
      assertCanViewProjection(actor);
      assertTreasuryProjectionHorizon({
        baseDate: query.baseDate,
        endDate: query.endDate,
        maxHorizonDays,
      });
      const now = deps.now?.() ?? new Date();
      // Somente leitura das latest SUCCEEDED — não dispara calculate/recalc.
      const loaded = await Promise.all(
        TREASURY_COMPARISON_SCENARIOS.map((scenario) =>
          loadScenarioDayLines(deps.repository, query.companyCode, scenario, {
            accountIds: query.accountIds,
            from: query.baseDate,
            to: query.endDate,
          })
        )
      );

      const byScenarioSeeds: Partial<
        Record<
          TreasuryComparisonScenario,
          Array<{
            civilDate: string;
            closingBalance: string;
            uncertainReceivables: string;
            riskAmount: string;
            riskCode: string;
          }>
        >
      > = {};
      const scenarioMetas = TREASURY_COMPARISON_SCENARIOS.map((scenario, i) => {
        const bundle = loaded[i]!;
        const lines = bundle.lines;
        // Agrega por dia (contas filtradas). consolidated=false ainda soma o filtro
        // para permitir comparar cenários sem N×contas no payload.
        const consolidated = consolidateDays(lines);
        byScenarioSeeds[scenario] = consolidated.map((d) => {
          let riskCode = "NONE";
          for (const line of lines.filter((l) => l.civilDate === d.civilDate)) {
            riskCode = pickHigherRiskCode(riskCode, line.riskCode);
          }
          return {
            civilDate: d.civilDate,
            closingBalance: d.closingBalance,
            uncertainReceivables: d.uncertainReceivables,
            riskAmount: d.riskAmount,
            riskCode,
          };
        });
        return {
          scenario,
          runId: bundle.runId,
          sourceVersion: bundle.sourceVersion,
          algorithmVersion: bundle.algorithmVersion,
          available: Boolean(bundle.run),
          freshness: bundle.run ? buildFreshness(bundle.run, now) : null,
        };
      });

      const comparison = buildTreasuryProjectionComparison({
        byScenario: byScenarioSeeds,
      });

      const freshnessSources = scenarioMetas.flatMap(
        (m) => m.freshness?.sources ?? []
      );
      const staleCount = freshnessSources.filter((s) => s.isStale).length;
      const freshness: TreasuryProjectionFreshnessDto = {
        asOf: now.toISOString(),
        sources:
          freshnessSources.length > 0
            ? freshnessSources
            : [
                {
                  source: "PROJECTION_RUN",
                  label: "Projeção persistida",
                  lastSuccessAt: null,
                  isStale: true,
                  detail: "Nenhuma projeção válida nos cenários",
                },
              ],
        hasStaleSource: staleCount > 0 || freshnessSources.length === 0,
        staleSourceCount:
          freshnessSources.length === 0 ? 1 : staleCount,
      };

      return {
        ok: true as const,
        companyCode: query.companyCode,
        baseDate: query.baseDate,
        endDate: query.endDate,
        consolidated: query.consolidated,
        accountIds: query.accountIds,
        recalculated: false as const,
        scenarios: scenarioMetas.map((meta) => {
          const summary = comparison.byScenario[meta.scenario];
          return {
            ...meta,
            firstNegativeDate: summary.firstNegativeDate as
              | TreasuryProjectionComparisonDto["scenarios"][number]["firstNegativeDate"],
            minimumBalance: summary.minimumBalance,
            minimumBalanceDate: summary.minimumBalanceDate as
              | TreasuryProjectionComparisonDto["scenarios"][number]["minimumBalanceDate"],
            dayCount: summary.dayCount,
          };
        }),
        days: comparison.days.map((d) => ({
          civilDate: d.civilDate as TreasuryProjectionComparisonDto["days"][number]["civilDate"],
          balances: d.balances,
          differences: d.differences,
          uncertainReceivables: d.uncertainReceivables,
          highestRisk: d.highestRisk,
        })),
        summary: {
          firstNegativeDateOverall:
            comparison.firstNegativeDateOverall as TreasuryProjectionComparisonDto["summary"]["firstNegativeDateOverall"],
          minimumBalanceOverall: comparison.minimumBalanceOverall,
          minimumBalanceOverallDate:
            comparison.minimumBalanceOverallDate as TreasuryProjectionComparisonDto["summary"]["minimumBalanceOverallDate"],
          minimumBalanceOverallScenario:
            comparison.minimumBalanceOverallScenario,
        },
        freshness,
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
    prisma: db,
  };
}
