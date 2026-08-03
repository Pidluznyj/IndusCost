/**
 * Loader REAL do input do motor de projeção (server-only, Prisma).
 *
 * Substitui o stub de teste `createEmptyTreasuryProjectionEngineInputLoader`
 * (que inventava uma conta sintética e causava violação de FK ao persistir as
 * day lines). Lê contas, saldos, títulos oficiais CR/CP, complementos
 * operacionais, promessas, lançamentos de ledger e transferências REAIS e
 * delega a montagem ao assembler puro.
 *
 * Somente leitura — não grava/muta nada (Nomus e Tesouraria permanecem read-only).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { toCivilDateKey, civilDateToLocalDate } from "@/src/lib/financeCivilDate.js";
import { TREASURY_ACTIVE_PROMISE_STATUSES } from "../contracts/treasuryEnums.js";
import { createTreasuryBalanceRepository } from "../repositories/treasuryBalanceRepository.server.js";
import { createTreasuryLedgerEntryRepository } from "../repositories/treasuryLedgerEntryRepository.server.js";
import { createTreasuryTransferRepository } from "../repositories/treasuryTransferRepository.server.js";
import { createTreasuryOfficialTitlesAdapter } from "../adapters/treasuryOfficialTitlesAdapter.server.js";
import {
  assembleTreasuryProjectionEngineInput,
  type ProjectionComplementInputRow,
  type ProjectionActivePromiseInputRow,
} from "../domain/treasuryProjectionEngineInputAssembler.js";
import type { TreasuryProjectionEngineInputLoader } from "./treasuryProjectionApiService.server.js";

/** Teto de páginas de títulos por lado (200/página) — evita varrer base inteira. */
const MAX_TITLE_PAGES = 25;
const TITLE_PAGE_SIZE = 200;
/** Teto de páginas de ledger manual no período. */
const MAX_LEDGER_PAGES = 25;
const LEDGER_PAGE_SIZE = 200;

function civilToUtcMidnight(civil: string): Date {
  const local = civilDateToLocalDate(civil);
  return new Date(
    Date.UTC(local.getFullYear(), local.getMonth(), local.getDate())
  );
}

function isActivePromiseStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (TREASURY_ACTIVE_PROMISE_STATUSES as readonly string[]).includes(status);
}

export function createTreasuryProjectionEngineInputLoaderFromPrisma(
  prisma: PrismaClient
): TreasuryProjectionEngineInputLoader {
  const balanceRepository = createTreasuryBalanceRepository(prisma);
  const ledgerRepository = createTreasuryLedgerEntryRepository(prisma);
  const transferRepository = createTreasuryTransferRepository(prisma);
  const officialTitles = createTreasuryOfficialTitlesAdapter(prisma);

  return async ({ companyCode, baseDate, endDate, accountIds }) => {
    // 1) Contas reais da empresa (filtradas por accountIds quando informado).
    const accountWhere: Prisma.TreasuryFinancialAccountWhereInput = {
      companyCode,
      isActive: true,
      ...(accountIds?.length ? { id: { in: accountIds } } : {}),
    };
    const accountRows = await prisma.treasuryFinancialAccount.findMany({
      where: accountWhere,
      select: {
        id: true,
        code: true,
        name: true,
        includeInConsolidated: true,
        allowNegativeBalance: true,
        minimumBalance: true,
      },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });

    // Sem conta real → devolve vazio; o serviço rejeita com validação clara.
    // NUNCA inventa accountId sintético (causa do bug de FK).
    if (accountRows.length === 0) {
      return {
        accounts: [],
        receivables: [],
        payables: [],
        settlements: [],
        expectations: [],
        promises: [],
        programming: [],
        ledgerEntries: [],
        transfers: [],
        fallbackAccountId: null,
      };
    }

    const accountIdList = accountRows.map((a) => a.id);
    const accountIdSet = new Set(accountIdList);

    // 2) Saldo de abertura = último snapshot por conta.
    const balanceByAccount = await balanceRepository.findLatestByAccountIds(
      accountIdList
    );

    const dueTo = civilToUtcMidnight(endDate);

    // 3) Títulos oficiais abertos com vencimento até o fim do horizonte.
    const [receivableViews, payableViews] = await Promise.all([
      loadAllTitles((page) =>
        officialTitles.listReceivables({
          openOnly: true,
          dueTo,
          page,
          pageSize: TITLE_PAGE_SIZE,
        })
      ),
      loadAllTitles((page) =>
        officialTitles.listPayables({
          openOnly: true,
          dueTo,
          page,
          pageSize: TITLE_PAGE_SIZE,
        })
      ),
    ]);

    const receivableIds = receivableViews.map((v) => v.id);
    const payableIds = payableViews.map((v) => v.id);

    // 4) Complementos operacionais ATIVOS (conta planejada + datas por cenário).
    const [arComplements, apComplements] = await Promise.all([
      loadComplementsByTitleIds(prisma, "RECEIVABLE", receivableIds),
      loadComplementsByTitleIds(prisma, "PAYABLE", payableIds),
    ]);

    // 5) Promessas ativas de recebimento (data provável do AR).
    const promiseByTitle = await loadActivePromisesByTitleIds(
      prisma,
      receivableIds
    );

    // 6) Lançamentos manuais de ledger ATIVOS no período (camada manual).
    const ledgerRows = await loadLedgerEntries(
      ledgerRepository,
      companyCode,
      baseDate,
      endDate
    );

    // 7) Transferências internas ativas que tocam as contas em escopo.
    const transferRows = await transferRepository.listActiveForAccounts(
      accountIdList
    );

    return assembleTreasuryProjectionEngineInput({
      accounts: accountRows.map((account) => ({
        account,
        balance: balanceByAccount.get(account.id) ?? null,
      })),
      receivables: receivableViews.map((view) => ({
        view: {
          id: view.id,
          externalId: view.externalId,
          installmentNumber: view.installmentNumber,
          dueDate: view.dueDate,
          originalAmount: view.originalAmount,
          openBalance: view.openBalance,
          isCancelledOrRemovedFromSource:
            view.cancellation.isCancelledOrRemovedFromSource,
        },
        complement: arComplements.get(view.id) ?? null,
        activePromise: promiseByTitle.get(view.id) ?? null,
      })),
      payables: payableViews.map((view) => ({
        view: {
          id: view.id,
          externalId: view.externalId,
          installmentNumber: view.installmentNumber,
          dueDate: view.dueDate,
          nomusScheduleDate: view.nomusScheduleDate,
          originalAmount: view.originalAmount,
          openBalance: view.openBalance,
          isCancelledOrRemovedFromSource:
            view.cancellation.isCancelledOrRemovedFromSource,
        },
        complement: apComplements.get(view.id) ?? null,
      })),
      ledgerEntries: ledgerRows
        .filter((r) => accountIdSet.has(r.accountId))
        .map((r) => ({
          id: r.id,
          accountId: r.accountId,
          civilDate: r.civilDate,
          amount: r.amount,
          direction: r.direction,
          nature: r.nature,
          status: r.status,
          transferGroupId: r.transferGroupId,
        })),
      transfers: transferRows.map((r) => ({
        id: r.id,
        transferGroupId: r.transferGroupId,
        fromAccountId: r.fromAccountId,
        toAccountId: r.toAccountId,
        civilDate: r.civilDate,
        sentCivilDate: r.sentCivilDate,
        receivedCivilDate: r.receivedCivilDate,
        amount: r.amount,
        status: r.status,
        cancelledAt: r.cancelledAt,
      })),
    });
  };
}

async function loadAllTitles<T>(
  fetchPage: (page: number) => Promise<{ rows: T[]; total: number }>
): Promise<T[]> {
  const first = await fetchPage(1);
  const out = [...first.rows];
  const totalPages = Math.min(
    MAX_TITLE_PAGES,
    Math.ceil(first.total / TITLE_PAGE_SIZE)
  );
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchPage(page);
    out.push(...next.rows);
    if (next.rows.length === 0) break;
  }
  return out;
}

async function loadComplementsByTitleIds(
  prisma: PrismaClient,
  titleType: "RECEIVABLE" | "PAYABLE",
  titleIds: string[]
): Promise<Map<string, ProjectionComplementInputRow>> {
  const map = new Map<string, ProjectionComplementInputRow>();
  if (titleIds.length === 0) return map;
  const rows = await prisma.treasuryTitleOperationalComplement.findMany({
    where: {
      titleType,
      officialTitleId: { in: titleIds },
      status: "ACTIVE",
      cancelledAt: null,
    },
    select: {
      officialTitleId: true,
      plannedAccountId: true,
      expectedDate: true,
      confirmedDate: true,
      scheduledDate: true,
      status: true,
    },
  });
  for (const row of rows) {
    map.set(row.officialTitleId, {
      plannedAccountId: row.plannedAccountId,
      expectedDate: row.expectedDate,
      confirmedDate: row.confirmedDate,
      scheduledDate: row.scheduledDate,
      status: row.status,
    });
  }
  return map;
}

async function loadActivePromisesByTitleIds(
  prisma: PrismaClient,
  titleIds: string[]
): Promise<Map<string, ProjectionActivePromiseInputRow>> {
  const map = new Map<string, ProjectionActivePromiseInputRow>();
  if (titleIds.length === 0) return map;
  const rows = await prisma.treasuryPaymentPromise.findMany({
    where: {
      titleType: "RECEIVABLE",
      officialTitleId: { in: titleIds },
      cancelledAt: null,
    },
    select: {
      officialTitleId: true,
      promisedDate: true,
      status: true,
    },
    orderBy: { promisedDate: "desc" },
  });
  for (const row of rows) {
    if (!isActivePromiseStatus(row.status)) continue;
    // orderBy desc → primeira promessa ativa vista é a mais recente; mantém.
    if (!map.has(row.officialTitleId)) {
      map.set(row.officialTitleId, {
        promisedDate: row.promisedDate,
        status: row.status,
      });
    }
  }
  return map;
}

async function loadLedgerEntries(
  ledgerRepository: ReturnType<typeof createTreasuryLedgerEntryRepository>,
  companyCode: string,
  from: string,
  to: string
) {
  const out: Awaited<ReturnType<typeof ledgerRepository.list>>["rows"] = [];
  for (let page = 1; page <= MAX_LEDGER_PAGES; page += 1) {
    const { rows, total } = await ledgerRepository.list({
      companyCode,
      status: "ACTIVE",
      from,
      to,
      page,
      pageSize: LEDGER_PAGE_SIZE,
    });
    out.push(...rows);
    if (out.length >= total || rows.length === 0) break;
  }
  return out.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    civilDate: toCivilDateKey(r.civilDate) ?? "",
    amount: r.amount,
    direction: r.direction,
    nature: r.nature,
    status: r.status,
    transferGroupId: r.transferGroupId,
  }));
}
