/**
 * Harness de integração E2E da Tesouraria sobre banco de teste seguro in-process.
 * Suporta snapshot/rollback explícito (TX); não usa DATABASE_URL de produção.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyOfficialTitlesMemoryStore,
  createMemoryTreasuryOfficialTitlesAdapter,
} from "../adapters/treasuryOfficialTitlesAdapter.memory.js";
import type { TreasuryDailyClosingPreviewDto } from "../contracts/treasuryDto.js";
import { TREASURY_REPORT_KEYS } from "../contracts/treasuryEnums.js";
import { buildTreasuryOfxPreviewClassification } from "../domain/treasuryOfxPreviewRules.js";
import type {
  OfficialNomusPayableRow,
  OfficialNomusReceivableRow,
} from "../mappers/treasuryOfficialTitleMappers.js";
import { parseTreasuryOfxBuffer } from "../ofx/treasuryOfxParser.js";
import {
  clearTreasuryOfxPreviewTokenStoreForTests,
  hashTreasuryOfxPreviewContent,
  issueTreasuryOfxPreviewToken,
} from "../ofx/treasuryOfxPreviewToken.server.js";
import {
  createEmptyTreasuryAccountMemoryStore,
  createMemoryTreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.memory.js";
import {
  createEmptyTreasuryBalanceMemoryStore,
  createMemoryTreasuryBalanceRepository,
} from "../repositories/treasuryBalanceRepository.memory.js";
import type {
  TreasuryBankImportBatchRow,
  TreasuryBankMovementRepository,
} from "../repositories/treasuryBankMovementRepository.server.js";
import {
  createEmptyTreasuryDailyClosingMemoryStore,
  createMemoryTreasuryDailyClosingRepository,
} from "../repositories/treasuryDailyClosingRepository.memory.js";
import {
  createEmptyTreasuryExceptionMemoryStore,
  createMemoryTreasuryExceptionRepository,
} from "../repositories/treasuryExceptionRepository.memory.js";
import {
  createEmptyTreasuryPayableQueryMemoryStore,
  createMemoryTreasuryPayableQueryRepository,
} from "../repositories/treasuryPayableQueryRepository.memory.js";
import {
  createEmptyTreasuryPaymentPromiseMemoryStore,
  createMemoryTreasuryPaymentPromiseRepository,
} from "../repositories/treasuryPaymentPromiseRepository.memory.js";
import {
  createEmptyTreasuryProjectionRunMemoryStore,
  createMemoryTreasuryProjectionRunRepository,
} from "../repositories/treasuryProjectionRunRepository.memory.js";
import {
  createEmptyTreasuryReceivableQueryMemoryStore,
  createMemoryTreasuryReceivableQueryRepository,
} from "../repositories/treasuryReceivableQueryRepository.memory.js";
import {
  createEmptyTreasuryReconciliationMatchMemoryStore,
  createMemoryTreasuryReconciliationMatchRepository,
  seedMemoryBankMovement,
} from "../repositories/treasuryReconciliationMatchRepository.memory.js";
import {
  createMemoryTreasuryReportRepository,
  type TreasuryReportFacts,
} from "../repositories/treasuryReportRepository.server.js";
import {
  createEmptyTreasuryTitleComplementMemoryStore,
  createMemoryTreasuryTitleOperationalComplementRepository,
} from "../repositories/treasuryTitleOperationalComplementRepository.memory.js";
import type { TreasuryAuditDb } from "../services/treasuryAuditService.server.js";
import { createTreasuryAccountService } from "../services/treasuryAccountService.server.js";
import { createTreasuryBalanceService } from "../services/treasuryBalanceService.server.js";
import { createTreasuryBankImportOfxApplyService } from "../services/treasuryBankImportOfxApplyService.server.js";
import { createTreasuryDailyClosingService } from "../services/treasuryDailyClosingService.server.js";
import { createTreasuryExceptionService } from "../services/treasuryExceptionService.server.js";
import { createTreasuryPayableProgrammingService } from "../services/treasuryPayableProgrammingService.server.js";
import { createTreasuryPayableQueryService } from "../services/treasuryPayableQueryService.server.js";
import { createTreasuryPaymentPromiseService } from "../services/treasuryPaymentPromiseService.server.js";
import {
  createTreasuryProjectionApiService,
  type TreasuryProjectionEngineInputLoader,
} from "../services/treasuryProjectionApiService.server.js";
import {
  clearTreasuryProjectionRecalcRequests,
  listTreasuryProjectionRecalcRequests,
} from "../services/treasuryProjectionRecalc.server.js";
import { createTreasuryReceivableExpectationService } from "../services/treasuryReceivableExpectationService.server.js";
import { createTreasuryReceivableQueryService } from "../services/treasuryReceivableQueryService.server.js";
import { createTreasuryReconciliationMatchService } from "../services/treasuryReconciliationMatchService.server.js";
import { clearTreasuryReconciliationSuggestionsRequests } from "../services/treasuryReconciliationSuggestions.server.js";
import { createTreasuryReportService } from "../services/treasuryReportService.server.js";
import {
  cloneTreasuryTestState,
  resolveTreasurySafeTestDatabaseMode,
} from "./treasurySafeTestDatabase.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "ofx", "fixtures");

export const FULL_FLOW_COMPANY = "EMP1";
export const FULL_FLOW_USER = "user-full-flow";
export const FULL_FLOW_AR_ID = "ar-full-1";
export const FULL_FLOW_AP_ID = "ap-full-1";
export const FULL_FLOW_CLOSING_DATE = "2026-07-20";
export const FULL_FLOW_SOURCE_HASH = "a".repeat(64);

function decimalLike(value: string): { toFixed(digits: number): string } {
  return {
    toFixed(digits: number) {
      return Number(value).toFixed(digits);
    },
  };
}

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

const AR_SEED: OfficialNomusReceivableRow = {
  id: FULL_FLOW_AR_ID,
  externalId: 88001,
  status: false,
  personId: 10,
  personName: "Cliente Full Flow",
  personCnpj: "12345678000199",
  description: "NF FF-100",
  competenceDate: utcDate(2026, 6, 1),
  dueDate: utcDate(2026, 7, 15),
  amountReceivable: decimalLike("1000.00"),
  balanceReceivable: decimalLike("150.00"),
  amountReceived: decimalLike("850.00"),
  settlementDate: null,
  sourceInvoiceId: 100,
  sourceInvoiceNumber: "FF-100",
  sourcePresenceStatus: "PRESENT",
  sourceRemovedAt: null,
  syncedAt: new Date("2026-07-18T12:00:00.000Z"),
  rawPayload: {},
};

const AP_SEED: OfficialNomusPayableRow = {
  id: FULL_FLOW_AP_ID,
  externalId: 55001,
  status: false,
  personId: 20,
  personName: "Fornecedor Full Flow",
  personCnpj: "11222333000144",
  description: "NF FF-900",
  documentNumber: "DOC-FF-900",
  classification: "Servico",
  comments: null,
  competenceDate: utcDate(2026, 6, 1),
  dueDate: utcDate(2026, 7, 25),
  scheduleDate: null,
  amountPayable: decimalLike("500.00"),
  balancePayable: decimalLike("200.00"),
  amountPaid: decimalLike("300.00"),
  amountScheduled: null,
  settlementDate: null,
  paymentDate: null,
  sourceInvoiceId: 900,
  sourceInvoiceNumber: "FF-900",
  sourcePresenceStatus: "PRESENT",
  sourceRemovedAt: null,
  syncedAt: new Date("2026-07-18T12:00:00.000Z"),
  rawPayload: {},
};

function closingPreview(accountId: string): TreasuryDailyClosingPreviewDto {
  return {
    ok: true,
    civilDate: FULL_FLOW_CLOSING_DATE,
    companyCode: FULL_FLOW_COMPANY,
    sourceHash: FULL_FLOW_SOURCE_HASH,
    generatedAt: "2026-07-20T18:00:00.000-03:00",
    summary: {
      openingBalance: "1000.00",
      realizedInflows: "0.00",
      realizedOutflows: "0.00",
      pendenciesAmount: "0.00",
      closingBalance: "1000.00",
      observedBalance: "1000.00",
      reconciledBalance: "1000.00",
      differenceAmount: "0.00",
      accountCount: 1,
      pendingReceivablesCount: 0,
      pendingPayablesCount: 0,
      absoluteBlockCount: 0,
      warningCount: 0,
      caveatRequiredCount: 0,
    },
    accounts: [
      {
        accountId,
        code: "CXFF",
        name: "Conta Full Flow",
        openingBalance: "1000.00",
        realizedInflows: "0.00",
        realizedOutflows: "0.00",
        pendenciesAmount: "0.00",
        closingBalance: "1000.00",
        observedBalance: "1000.00",
        reconciledBalance: "1000.00",
        differenceAmount: "0.00",
        minimumBalance: "0.00",
        allowNegativeBalance: true,
        balanceStale: false,
        lastBalanceAt: "2026-07-20T12:00:00.000-03:00",
      },
    ],
    absoluteBlocks: [],
    warnings: [],
    pendingReceivables: [],
    pendingPayables: [],
    unreconciledMovements: [],
    staleBalances: [],
    expiredPromises: [],
    transfersInTransit: [],
    canCloseWithoutCaveats: true,
    canCloseWithCaveats: true,
    requiredCaveatCodes: [],
  };
}

function reportFacts(): TreasuryReportFacts {
  return {
    buckets: [
      { key: "A", label: "A", amount: "150.00", count: 1 },
      { key: "B", label: "B", amount: "50.00", count: 1 },
    ],
    rows: [{ id: "1", label: "row", amount: "150.00", count: 1 }],
    totalRows: 1,
    totalsAmountOverride: "200.00",
    totalsCountOverride: 2,
    extras: { note: "full-flow" },
    paginate: true,
  };
}

function createMemoryOfxMovementRepo(): TreasuryBankMovementRepository & {
  batches: TreasuryBankImportBatchRow[];
  movements: { id: string; fingerprint: string; batchId: string }[];
} {
  const state = {
    batches: [] as TreasuryBankImportBatchRow[],
    movements: [] as { id: string; fingerprint: string; batchId: string }[],
  };
  let seq = 0;
  const repo: TreasuryBankMovementRepository = {
    async findExistingFingerprints(accountId, fingerprints) {
      return new Set(
        state.movements
          .filter((m) =>
            state.batches.some(
              (b) => b.id === m.batchId && b.accountId === accountId
            )
          )
          .map((m) => m.fingerprint)
          .filter((fp) => fingerprints.includes(fp))
      );
    },
    async findBatchIdByFileSha256(accountId, fileSha256) {
      return (
        state.batches.find(
          (b) => b.accountId === accountId && b.fileSha256 === fileSha256
        )?.id ?? null
      );
    },
    async findBatchByFileSha256(accountId, fileSha256) {
      return (
        state.batches.find(
          (b) => b.accountId === accountId && b.fileSha256 === fileSha256
        ) ?? null
      );
    },
    async findBatchById(id) {
      return state.batches.find((b) => b.id === id) ?? null;
    },
    async createBatch(data) {
      if (
        state.batches.some(
          (b) =>
            b.accountId === data.accountId && b.fileSha256 === data.fileSha256
        )
      ) {
        const err = new Error("Unique constraint");
        (err as { code?: string }).code = "P2002";
        throw err;
      }
      seq += 1;
      const row: TreasuryBankImportBatchRow = {
        id: `batch-${seq}`,
        companyCode: data.companyCode,
        accountId: data.accountId,
        fileSha256: data.fileSha256,
        originalFileName: data.originalFileName,
        byteLength: data.byteLength,
        format: data.format,
        status: data.status,
        transactionCount: data.transactionCount,
        summaryJson: data.summaryJson,
        requestId: data.requestId,
        notes: data.notes,
        createdByUserId: data.createdByUserId,
        createdAt: new Date(),
        processedAt: data.processedAt,
      };
      state.batches.push(row);
      return row;
    },
    async createMovements(rows) {
      const out: { id: string; fingerprint: string }[] = [];
      for (const row of rows) {
        if (
          state.movements.some(
            (m) =>
              m.fingerprint === row.fingerprint &&
              state.batches.some(
                (b) => b.id === m.batchId && b.accountId === row.accountId
              )
          )
        ) {
          const err = new Error("Unique fingerprint");
          (err as { code?: string }).code = "P2002";
          throw err;
        }
        seq += 1;
        const id = `mov-${seq}`;
        state.movements.push({
          id,
          fingerprint: row.fingerprint,
          batchId: row.batchId,
        });
        out.push({ id, fingerprint: row.fingerprint });
      }
      return out;
    },
    async listBatches() {
      return { rows: state.batches, totalRows: state.batches.length };
    },
    async listMovements() {
      return { rows: state.movements, totalRows: state.movements.length };
    },
    async findMovementById(id) {
      return state.movements.find((m) => m.id === id) ?? null;
    },
  };
  return Object.assign(repo, state);
}

export const fullFlowActor = {
  userId: FULL_FLOW_USER,
  userName: "Operador Full Flow",
  role: "SUPER_ADMIN",
  isSuperAdmin: true,
  canViewAccounts: true,
  canManageAccounts: true,
  canManageBalances: true,
  canViewReceivables: true,
  canManageReceivables: true,
  canPromiseReceivables: true,
  canViewPayables: true,
  canProgramPayables: true,
  canViewDashboard: true,
  canViewAgenda: true,
  canViewExceptions: true,
  canManageExceptions: true,
  canViewClosing: true,
  canCloseDay: true,
  canReopenDay: true,
  canViewReconciliation: true,
  canManageReconciliation: true,
  canReverseReconciliation: true,
  canViewReports: true,
  sessionId: "sess-full-flow",
  requestId: "req-full-flow",
} as const;

export function createTreasuryFullFlowHarness() {
  const dbMode = resolveTreasurySafeTestDatabaseMode();

  const accountStore = createEmptyTreasuryAccountMemoryStore();
  const balanceStore = createEmptyTreasuryBalanceMemoryStore();
  const officialStore = createEmptyOfficialTitlesMemoryStore();
  officialStore.receivables = [{ ...AR_SEED }];
  officialStore.payables = [{ ...AP_SEED }];
  const complementStore = createEmptyTreasuryTitleComplementMemoryStore();
  const promiseStore = createEmptyTreasuryPaymentPromiseMemoryStore();
  const receivableQueryStore = createEmptyTreasuryReceivableQueryMemoryStore();
  receivableQueryStore.receivables = officialStore.receivables;
  receivableQueryStore.complements = complementStore.rows;
  const payableQueryStore = createEmptyTreasuryPayableQueryMemoryStore();
  payableQueryStore.payables = officialStore.payables;
  payableQueryStore.complements = complementStore.rows;
  const projectionStore = createEmptyTreasuryProjectionRunMemoryStore();
  const exceptionStore = createEmptyTreasuryExceptionMemoryStore();
  const closingStore = createEmptyTreasuryDailyClosingMemoryStore();
  const matchStore = createEmptyTreasuryReconciliationMatchMemoryStore();
  const ofxMovementRepo = createMemoryOfxMovementRepo();
  const audits: Array<Record<string, unknown>> = [];

  const fakeTx = {
    treasuryAuditLog: {
      async create(args: { data: Record<string, unknown> }) {
        const row = { id: `audit-${audits.length + 1}`, ...args.data };
        audits.push(row);
        return row;
      },
    },
  } as unknown as TreasuryAuditDb;

  const snapshotStores = () =>
    cloneTreasuryTestState({
      accounts: accountStore.accounts,
      access: accountStore.access,
      balances: balanceStore.snapshots,
      complements: complementStore.rows,
      promises: promiseStore.rows,
      exceptions: exceptionStore.rows,
      closings: closingStore.closings,
      positions: closingStore.positions,
      reopenings: closingStore.reopenings,
      matches: matchStore.matches,
      matchMovements: matchStore.movements,
      ofxBatches: ofxMovementRepo.batches,
      ofxMovements: ofxMovementRepo.movements,
      projections: projectionStore.runs,
      audits,
    });

  const restoreStores = (snap: ReturnType<typeof snapshotStores>) => {
    accountStore.accounts.splice(0, accountStore.accounts.length, ...snap.accounts);
    accountStore.access.splice(0, accountStore.access.length, ...snap.access);
    balanceStore.snapshots.splice(
      0,
      balanceStore.snapshots.length,
      ...snap.balances
    );
    complementStore.rows.splice(
      0,
      complementStore.rows.length,
      ...snap.complements
    );
    promiseStore.rows.splice(0, promiseStore.rows.length, ...snap.promises);
    exceptionStore.rows.splice(
      0,
      exceptionStore.rows.length,
      ...snap.exceptions
    );
    closingStore.closings.splice(
      0,
      closingStore.closings.length,
      ...snap.closings
    );
    closingStore.positions.splice(
      0,
      closingStore.positions.length,
      ...snap.positions
    );
    closingStore.reopenings.splice(
      0,
      closingStore.reopenings.length,
      ...snap.reopenings
    );
    matchStore.matches.splice(0, matchStore.matches.length, ...snap.matches);
    matchStore.movements.splice(
      0,
      matchStore.movements.length,
      ...snap.matchMovements
    );
    ofxMovementRepo.batches.splice(
      0,
      ofxMovementRepo.batches.length,
      ...snap.ofxBatches
    );
    ofxMovementRepo.movements.splice(
      0,
      ofxMovementRepo.movements.length,
      ...snap.ofxMovements
    );
    projectionStore.runs.splice(
      0,
      projectionStore.runs.length,
      ...snap.projections
    );
    audits.splice(0, audits.length, ...snap.audits);
  };

  /** TX padrão (como demais integrações): só executa o callback. */
  const runTransaction = async <T>(
    fn: (tx: TreasuryAuditDb) => Promise<T>
  ): Promise<T> => fn(fakeTx);

  /**
   * TX com rollback: snapshot → fn → restore se lançar.
   * Usado para provar atomicidade no banco de teste seguro.
   */
  const runTransactionWithRollback = async <T>(
    fn: (tx: TreasuryAuditDb) => Promise<T>
  ): Promise<T> => {
    const snap = snapshotStores();
    try {
      return await fn(fakeTx);
    } catch (err) {
      restoreStores(snap);
      throw err;
    }
  };

  clearTreasuryProjectionRecalcRequests();
  clearTreasuryReconciliationSuggestionsRequests();
  clearTreasuryOfxPreviewTokenStoreForTests();

  const accountRepository = createMemoryTreasuryAccountRepository(accountStore);
  const balanceRepository = createMemoryTreasuryBalanceRepository(balanceStore);
  const officialAdapter = createMemoryTreasuryOfficialTitlesAdapter(officialStore);
  const complementRepository =
    createMemoryTreasuryTitleOperationalComplementRepository(complementStore);

  const accountService = createTreasuryAccountService({
    prisma: {} as PrismaClient,
    repository: accountRepository,
    runTransaction,
  });
  const balanceService = createTreasuryBalanceService({
    prisma: {} as PrismaClient,
    accountRepository,
    balanceRepository,
    runTransaction: runTransaction as never,
  });
  const receivableQueryService = createTreasuryReceivableQueryService({
    repository: createMemoryTreasuryReceivableQueryRepository(
      receivableQueryStore
    ),
  });
  const payableQueryService = createTreasuryPayableQueryService({
    repository: createMemoryTreasuryPayableQueryRepository(payableQueryStore),
  });
  const expectationService = createTreasuryReceivableExpectationService({
    prisma: {} as PrismaClient,
    officialAdapter,
    complementRepository,
    runTransaction,
  });
  const promiseService = createTreasuryPaymentPromiseService({
    prisma: {} as PrismaClient,
    officialAdapter,
    promiseRepository: createMemoryTreasuryPaymentPromiseRepository(promiseStore),
    runTransaction,
  });
  const payableProgrammingService = createTreasuryPayableProgrammingService({
    prisma: {} as PrismaClient,
    officialAdapter,
    complementRepository,
    accountRepository,
    balanceRepository,
    runTransaction,
  });

  let accountIdForProjection: string | null = null;
  const loadEngineInput: TreasuryProjectionEngineInputLoader = async () => ({
    accounts: accountIdForProjection
      ? [
          {
            accountId: accountIdForProjection,
            code: "CXFF",
            includeInConsolidated: true,
            minimumBalance: "0.00",
            openingBalance: "1000.00",
          },
        ]
      : [],
    receivables: [
      {
        id: "r-ff",
        officialTitleId: FULL_FLOW_AR_ID,
        nomusExternalId: AR_SEED.externalId,
        accountId: accountIdForProjection,
        dueDate: "2026-07-28",
        originalAmount: "150.00",
        openBalance: "150.00",
      },
    ],
    payables: [],
    settlements: [],
    expectations: [],
    promises: [],
    programming: [],
    ledgerEntries: [],
    transfers: [],
    fallbackAccountId: accountIdForProjection,
  });

  const projectionService = createTreasuryProjectionApiService({
    repository: createMemoryTreasuryProjectionRunRepository(projectionStore),
    loadEngineInput,
    maxHorizonDays: 90,
    now: () => new Date("2026-07-20T15:00:00.000Z"),
  });

  const exceptionService = createTreasuryExceptionService({
    prisma: {} as PrismaClient,
    repository: createMemoryTreasuryExceptionRepository(exceptionStore),
    runTransaction,
  });

  let previewAccountId = "pending";
  const closingService = createTreasuryDailyClosingService({
    repository: createMemoryTreasuryDailyClosingRepository(closingStore),
    recalcJobRepository: null,
    loadPreview: async () => closingPreview(previewAccountId),
    runTransaction: runTransaction as never,
  });

  const ofxApplyService = createTreasuryBankImportOfxApplyService({
    prisma: {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        runTransaction(async (tx) => fn(tx)),
      treasuryAuditLog: fakeTx.treasuryAuditLog,
    } as never,
    accountRepo: accountRepository,
    movementRepo: ofxMovementRepo,
    runInTransaction: runTransaction as never,
  });

  const reconciliationService = createTreasuryReconciliationMatchService({
    prisma: {} as PrismaClient,
    accountRepository,
    matchRepository: createMemoryTreasuryReconciliationMatchRepository(matchStore),
    runTransaction,
    notifyPostClosing: async () => ({
      raised: false,
      reason: "DAY_NOT_CLOSED",
    }),
  });

  const factsByKey = Object.fromEntries(
    TREASURY_REPORT_KEYS.map((k) => [k, reportFacts()])
  ) as Record<(typeof TREASURY_REPORT_KEYS)[number], TreasuryReportFacts>;

  const reportService = createTreasuryReportService({
    accountRepository,
    reportRepository: createMemoryTreasuryReportRepository(factsByKey),
  });

  return {
    dbMode,
    actor: fullFlowActor,
    audits,
    stores: {
      accountStore,
      balanceStore,
      complementStore,
      promiseStore,
      exceptionStore,
      closingStore,
      matchStore,
      ofxMovementRepo,
      projectionStore,
      officialStore,
    },
    services: {
      accountService,
      balanceService,
      receivableQueryService,
      payableQueryService,
      expectationService,
      promiseService,
      payableProgrammingService,
      projectionService,
      exceptionService,
      closingService,
      ofxApplyService,
      reconciliationService,
      reportService,
    },
    runTransaction,
    runTransactionWithRollback,
    snapshotStores,
    restoreStores,
    bindAccountId(accountId: string) {
      accountIdForProjection = accountId;
      previewAccountId = accountId;
    },
    issueOfxPreview(accountId: string) {
      const buffer = readFileSync(join(fixturesDir, "sample-ofx1.ofx"));
      const parsed = parseTreasuryOfxBuffer(buffer, { quarantineInvalid: true });
      const classified = buildTreasuryOfxPreviewClassification({
        accountId,
        transactions: parsed.transactions,
        invalidSeeds: parsed.invalidTransactions,
        existingFingerprints: new Set(),
        fileAlreadyImported: false,
      });
      const contentHash = hashTreasuryOfxPreviewContent(classified.movements);
      const token = issueTreasuryOfxPreviewToken({
        userId: FULL_FLOW_USER,
        accountId,
        companyCode: FULL_FLOW_COMPANY,
        fileSha256: parsed.fileSha256,
        originalFileName: "sample-ofx1.ofx",
        format: parsed.format,
        byteLength: parsed.byteLength,
        contentHash,
        movements: classified.movements,
      });
      return {
        previewToken: token.previewToken,
        contentHash: token.contentHash,
        fileSha256: parsed.fileSha256,
      };
    },
    seedMatchMovementsFromOfx(
      accountId: string,
      movementIds: string[],
      amounts: string[]
    ) {
      for (let i = 0; i < movementIds.length; i += 1) {
        seedMemoryBankMovement(matchStore, {
          id: movementIds[i]!,
          companyCode: FULL_FLOW_COMPANY,
          accountId,
          amount: amounts[i] ?? "0.00",
          reconciliationStatus: "PENDING",
          reconciledAmount: "0.00",
        });
      }
    },
    listProjectionRecalcRequests: listTreasuryProjectionRecalcRequests,
  };
}
