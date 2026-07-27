/**
 * Visão financeira resumida do cliente — agrega títulos oficiais + overlays locais.
 * Consultas em batch (sem N+1 por título).
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type { TreasuryCustomerFinancialSummaryDto } from "../contracts/treasuryReceivableContracts.js";
import { TREASURY_MAX_PAGE_SIZE } from "../contracts/treasuryConstants.js";
import {
  createTreasuryOfficialTitlesAdapter,
  type TreasuryOfficialTitlesAdapter,
} from "../adapters/treasuryOfficialTitlesAdapter.server.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { buildTreasuryCustomerFinancialSummary } from "../domain/treasuryCustomerFinancialSummaryRules.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";
import {
  createTreasuryCollectionActionRepository,
  type TreasuryCollectionActionRepository,
} from "../repositories/treasuryCollectionActionRepository.server.js";
import {
  createTreasuryPaymentPromiseRepository,
  type TreasuryPaymentPromiseRepository,
} from "../repositories/treasuryPaymentPromiseRepository.server.js";
import {
  assertReceivableFound,
  createTreasuryReceivableQueryRepository,
  type TreasuryReceivableQueryRepository,
} from "../repositories/treasuryReceivableQueryRepository.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";

export type TreasuryCustomerSummaryActor = {
  userId: string;
  role: string;
  isSuperAdmin: boolean;
  canViewReceivables: boolean;
};

export function buildTreasuryCustomerSummaryActor(
  user: AppAuthContext
): TreasuryCustomerSummaryActor {
  return {
    userId: user.id,
    role: user.role,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewReceivables: canTreasuryCapability(user, "viewReceivables"),
  };
}

export type TreasuryCustomerFinancialSummaryService = {
  getByReceivableTitleId(
    actor: TreasuryCustomerSummaryActor,
    titleId: string,
    referenceDate?: Date
  ): Promise<TreasuryCustomerFinancialSummaryDto>;
};

function moneyOf(
  value: { toFixed(digits: number): string } | string
): string {
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

async function listAllReceivablesForPerson(
  adapter: TreasuryOfficialTitlesAdapter,
  personId: number
): Promise<OfficialReceivableView[]> {
  const pageSize = TREASURY_MAX_PAGE_SIZE;
  let page = 1;
  const all: OfficialReceivableView[] = [];
  for (;;) {
    const batch = await adapter.listReceivables({
      personId,
      page,
      pageSize,
      openOnly: false,
    });
    all.push(...batch.rows);
    if (all.length >= batch.total || batch.rows.length === 0) break;
    page += 1;
    if (page > 50) break;
  }
  return all;
}

export function createTreasuryCustomerFinancialSummaryService(deps: {
  prisma?: PrismaClient;
  officialAdapter?: TreasuryOfficialTitlesAdapter;
  receivableQueryRepository?: TreasuryReceivableQueryRepository;
  promiseRepository?: TreasuryPaymentPromiseRepository;
  collectionActionRepository?: TreasuryCollectionActionRepository;
}): TreasuryCustomerFinancialSummaryService {
  const prisma = deps.prisma;
  const officialAdapter =
    deps.officialAdapter ?? createTreasuryOfficialTitlesAdapter(prisma!);
  const receivableQuery =
    deps.receivableQueryRepository ??
    createTreasuryReceivableQueryRepository(prisma!);
  const promiseRepo =
    deps.promiseRepository ??
    createTreasuryPaymentPromiseRepository(prisma!);
  const actionRepo =
    deps.collectionActionRepository ??
    createTreasuryCollectionActionRepository(prisma!);

  return {
    async getByReceivableTitleId(actor, titleId, referenceDate) {
      if (!actor.canViewReceivables && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar o resumo financeiro do cliente."
        );
      }
      const id = titleId.trim();
      if (!id) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "titleId é obrigatório.",
          "titleId"
        );
      }

      const anchor = await receivableQuery.getByTitleId(id, referenceDate);
      assertReceivableFound(anchor);

      const personId = anchor.official.counterparty.personId;
      let titles: OfficialReceivableView[];
      if (personId == null) {
        titles = [anchor.official];
      } else {
        titles = await listAllReceivablesForPerson(officialAdapter, personId);
        if (!titles.some((t) => t.id === anchor.official.id)) {
          titles = [anchor.official, ...titles];
        }
      }

      const titleIds = titles.map((t) => t.id);
      const [promises, actions] = await Promise.all([
        promiseRepo.listByOfficialTitleIds("RECEIVABLE", titleIds),
        actionRepo.listByOfficialTitleIds("RECEIVABLE", titleIds),
      ]);

      return buildTreasuryCustomerFinancialSummary({
        titleId: anchor.titleId,
        personId,
        personName: anchor.official.counterparty.name,
        personTaxId: anchor.official.counterparty.taxId,
        titles,
        promises: promises.map((p) => ({
          status: p.status,
          promisedAmount: moneyOf(p.promisedAmount),
          fulfilledAmount: moneyOf(p.fulfilledAmount),
        })),
        actions: actions.map((a) => ({
          id: a.id,
          officialTitleId: a.officialTitleId,
          actionType: a.actionType,
          performedAt: formatTreasuryTimestampIso(a.performedAt),
          result: a.result,
          nextAction: a.nextAction,
          contactPerson: a.contactPerson,
          cancelledAt: a.cancelledAt
            ? formatTreasuryTimestampIso(a.cancelledAt)
            : null,
        })),
        sellerName: anchor.sellerName,
        commercialOwnerName: anchor.commercialOwnerName,
        collectionOwnerUserId: anchor.complement?.responsibleUserId ?? null,
        referenceDate,
      });
    },
  };
}
