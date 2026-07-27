/**
 * Serviço — dashboard diário da Tesouraria.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type {
  TreasuryAlertItemDto,
  TreasuryDashboardDto,
} from "../contracts/treasuryDto.js";
import type { TreasuryDashboardQuery } from "../contracts/treasurySchemas.js";
import { DEFAULT_TREASURY_ALERT_SETTINGS } from "../contracts/treasuryAlertConfig.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  assertTreasuryDashboardTotalsConsistent,
  buildFreshnessDto,
  buildTreasuryDashboardDto,
} from "../domain/treasuryDashboardRules.js";
import { buildTreasuryAlerts } from "../domain/treasuryAlertRules.js";
import {
  createTreasuryDashboardDayFlowRepository,
  createTreasuryDashboardFreshnessRepository,
  isTreasurySourceStale,
  type TreasuryDashboardDayFlowRepository,
  type TreasuryDashboardFreshnessRepository,
} from "../repositories/treasuryDashboardDayFlowRepository.server.js";
import {
  createTreasuryAlertFactsRepository,
  type TreasuryAlertFactsRepository,
} from "../repositories/treasuryAlertFactsRepository.server.js";
import {
  buildTreasuryFinancialPositionActor,
  createTreasuryFinancialPositionService,
  type TreasuryFinancialPositionActor,
  type TreasuryFinancialPositionService,
} from "./treasuryFinancialPositionService.server.js";
import {
  createTreasuryAlertSettingsService,
  type TreasuryAlertSettingsService,
} from "./treasuryAlertSettingsService.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import { civilDateToLocalDate } from "@/src/lib/financeCivilDate.js";

export type TreasuryDashboardActor = {
  userId: string;
  canViewDashboard: boolean;
  positionActor: TreasuryFinancialPositionActor;
};

export function buildTreasuryDashboardActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryDashboardActor {
  return {
    userId: user.id,
    canViewDashboard: canTreasuryCapability(user, "viewDashboard"),
    positionActor: buildTreasuryFinancialPositionActor(user, requestId),
  };
}

export type TreasuryDashboardService = {
  getDailyDashboard(
    actor: TreasuryDashboardActor,
    query: TreasuryDashboardQuery
  ): Promise<TreasuryDashboardDto>;
};

function toAlertDto(
  alerts: ReturnType<typeof buildTreasuryAlerts>
): TreasuryAlertItemDto[] {
  return alerts.map((a) => ({
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

export function createTreasuryDashboardService(deps: {
  prisma?: PrismaClient;
  positionService?: TreasuryFinancialPositionService;
  dayFlowRepository?: TreasuryDashboardDayFlowRepository;
  freshnessRepository?: TreasuryDashboardFreshnessRepository;
  alertSettingsService?: TreasuryAlertSettingsService;
  alertFactsRepository?: TreasuryAlertFactsRepository;
}): TreasuryDashboardService {
  const positionService =
    deps.positionService ??
    createTreasuryFinancialPositionService({ prisma: deps.prisma });
  const dayFlowRepository =
    deps.dayFlowRepository ??
    createTreasuryDashboardDayFlowRepository(deps.prisma!);
  const freshnessRepository =
    deps.freshnessRepository ??
    createTreasuryDashboardFreshnessRepository(deps.prisma!);
  const alertSettingsService =
    deps.alertSettingsService ??
    (deps.prisma
      ? createTreasuryAlertSettingsService({ prisma: deps.prisma })
      : null);
  const alertFactsRepository =
    deps.alertFactsRepository ??
    (deps.prisma
      ? createTreasuryAlertFactsRepository(deps.prisma)
      : null);

  return {
    async getDailyDashboard(actor, query) {
      if (!actor.canViewDashboard && !actor.positionActor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar o dashboard da Tesouraria."
        );
      }

      const asOf = civilDateToLocalDate(query.date);
      asOf.setHours(23, 59, 59, 999);
      const nowEpochMs = asOf.getTime();

      const [position, dayFlow, freshnessSources] = await Promise.all([
        positionService.getCurrentPosition(actor.positionActor, {
          asOf,
          accountIds: query.accountIds,
        }),
        dayFlowRepository.aggregateDayFlow({
          civilDate: query.date,
          scenario: query.scenario,
          accountIds: query.accountIds,
        }),
        freshnessRepository.loadSources(asOf),
      ]);

      const freshness = buildFreshnessDto({
        asOf: formatTreasuryTimestampIso(asOf),
        sources: freshnessSources.map((s) => ({
          source: s.source,
          label: s.label,
          lastSuccessAt: s.lastSuccessAt
            ? formatTreasuryTimestampIso(s.lastSuccessAt)
            : null,
          isStale: isTreasurySourceStale(s.lastSuccessAt, asOf),
          detail: s.detail,
        })),
      });

      let alerts: TreasuryAlertItemDto[] = [];
      if (alertSettingsService && alertFactsRepository) {
        const settings = await alertSettingsService.getFields().catch(() => ({
          ...DEFAULT_TREASURY_ALERT_SETTINGS,
        }));
        const accountIds = position.accounts.map((a) => a.accountId);
        const [mins, receivables, promises, payables] = await Promise.all([
          alertFactsRepository.loadAccountMinimums(accountIds),
          alertFactsRepository.loadReceivables(),
          alertFactsRepository.loadActivePromises(),
          alertFactsRepository.loadCriticalPayables(),
        ]);
        const syncFreshness = freshness.sources
          .filter(
            (s) =>
              /AR|AP|RECEIV|PAYAB|SYNC|NOMUS/i.test(s.source) ||
              /AR|AP|receb|pag/i.test(s.label)
          )
          .map((s) => ({
            side: s.source,
            lastSuccessAtIso: s.lastSuccessAt,
          }));
        // Sempre inclui fontes AR/AP se existirem; senão usa todas stale como sync.
        const syncFacts =
          syncFreshness.length > 0
            ? syncFreshness
            : freshness.sources.map((s) => ({
                side: s.source,
                lastSuccessAtIso: s.lastSuccessAt,
              }));

        alerts = toAlertDto(
          buildTreasuryAlerts(settings, {
            asOfCivilDate: query.date,
            nowEpochMs,
            accounts: position.accounts.map((a) => {
              const min = mins.get(a.accountId);
              return {
                accountId: a.accountId,
                code: a.accountCode,
                availableBalance:
                  a.operationalAvailableBalance ?? a.observedBalance,
                minimumBalance: min?.minimumBalance ?? "0.00",
                allowNegativeBalance:
                  min?.allowNegativeBalance ?? a.allowNegativeBalance,
                lastBalanceAtIso: a.snapshotReferenceAt,
              };
            }),
            receivables,
            promises,
            payables,
            syncFreshness: syncFacts,
          })
        );
      }

      const dto = buildTreasuryDashboardDto({
        civilDate: query.date,
        scenario: query.scenario,
        accountIds: query.accountIds,
        position,
        dayFlow: {
          receivables: dayFlow.receivables,
          payables: dayFlow.payables,
        },
        freshness,
        highPriorityReceivableCount: dayFlow.highPriorityReceivableCount,
        highPriorityPayableCount: dayFlow.highPriorityPayableCount,
        alerts,
      });

      assertTreasuryDashboardTotalsConsistent(dto);
      return dto;
    },
  };
}
