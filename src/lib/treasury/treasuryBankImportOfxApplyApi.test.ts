/**
 * Wiring + apply OFX: cria lote/movimentos, idempotência e sem duplicar.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryBankImportOfxApplyControllers } from "./controllers/treasuryBankImportOfxApplyController.js";
import { TREASURY_BANK_IMPORTS_OFX_APPLY_PATH } from "./contracts/treasuryContracts.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import {
  clearTreasuryOfxPreviewTokenStoreForTests,
  issueTreasuryOfxPreviewToken,
  peekTreasuryOfxPreviewToken,
} from "./ofx/treasuryOfxPreviewToken.server.js";
import { parseTreasuryOfxBuffer } from "./ofx/treasuryOfxParser.js";
import { buildTreasuryOfxPreviewClassification } from "./domain/treasuryOfxPreviewRules.js";
import type {
  TreasuryAccountAccessRow,
  TreasuryAccountRow,
} from "./mappers/treasuryAccountMappers.js";
import type { TreasuryAccountRepository } from "./repositories/treasuryAccountRepository.server.js";
import type {
  TreasuryBankImportBatchRow,
  TreasuryBankMovementRepository,
} from "./repositories/treasuryBankMovementRepository.server.js";
import {
  createTreasuryBankImportOfxApplyService,
  type TreasuryBankImportOfxApplyActor,
} from "./services/treasuryBankImportOfxApplyService.server.js";
import {
  clearTreasuryReconciliationSuggestionsRequests,
  listTreasuryReconciliationSuggestionsRequests,
} from "./services/treasuryReconciliationSuggestions.server.js";
import {
  clearTreasuryProjectionRecalcRequests,
  listTreasuryProjectionRecalcRequests,
} from "./services/treasuryProjectionRecalc.server.js";
import { hashTreasuryOfxPreviewContent } from "./ofx/treasuryOfxPreviewToken.server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "ofx", "fixtures");
const ACCOUNT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const USER_ID = "user-ops";

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  setHeader: (key: string, value: string) => void;
};

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
  };
  return res;
}

function actor(
  overrides: Partial<TreasuryBankImportOfxApplyActor> = {}
): TreasuryBankImportOfxApplyActor {
  return {
    userId: USER_ID,
    role: "USER",
    isSuperAdmin: false,
    canManageReconciliation: true,
    canManageAccounts: false,
    canViewAccounts: true,
    requestId: "req-apply",
    ...overrides,
  };
}

function accountRow(): TreasuryAccountRow {
  return {
    id: ACCOUNT_ID,
    companyCode: "EMP1",
    companyName: "Empresa",
    code: "CX1",
    name: "Conta",
    institutionName: "Banco",
    institutionCode: "341",
    accountType: "CHECKING",
    currency: "BRL",
    agencyMasked: "***",
    accountNumberMasked: "****",
    includeInConsolidated: true,
    minimumBalance: "0.00",
    allowNegativeBalance: false,
    liquidity: "IMMEDIATE",
    defaultBalanceOrigin: "MANUAL",
    sortOrder: 1,
    nomusBankAccountId: null,
    isActive: true,
    createdByUserId: USER_ID,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    deactivatedAt: null,
    deactivatedByUserId: null,
    deactivationReason: null,
  };
}

function accessRow(
  level: "VIEW" | "OPERATE" | "MANAGE" = "OPERATE"
): TreasuryAccountAccessRow {
  return {
    id: "acc-1",
    accountId: ACCOUNT_ID,
    userId: USER_ID,
    accessLevel: level,
    canViewBalance: true,
    canMutateBalance: true,
    isActive: true,
    grantedByUserId: "admin",
    grantedAt: new Date("2026-07-01T00:00:00.000Z"),
    revokedAt: null,
  };
}

function createMemoryMovementRepo(): TreasuryBankMovementRepository & {
  batches: TreasuryBankImportBatchRow[];
  movements: { id: string; fingerprint: string; batchId: string }[];
  auditCalls: number;
} {
  const state = {
    batches: [] as TreasuryBankImportBatchRow[],
    movements: [] as { id: string; fingerprint: string; batchId: string }[],
    auditCalls: 0,
  };
  let seq = 0;
  const repo: TreasuryBankMovementRepository = {
    async findExistingFingerprints(accountId, fingerprints) {
      const set = new Set(
        state.movements
          .filter((m) =>
            state.batches.some(
              (b) => b.id === m.batchId && b.accountId === accountId
            )
          )
          .map((m) => m.fingerprint)
          .filter((fp) => fingerprints.includes(fp))
      );
      return set;
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

function issuePreviewFromFixture(): {
  previewToken: string;
  contentHash: string;
  fileSha256: string;
} {
  const buffer = readFileSync(join(fixturesDir, "sample-ofx1.ofx"));
  const parsed = parseTreasuryOfxBuffer(buffer, { quarantineInvalid: true });
  const classified = buildTreasuryOfxPreviewClassification({
    accountId: ACCOUNT_ID,
    transactions: parsed.transactions,
    invalidSeeds: parsed.invalidTransactions,
    existingFingerprints: new Set(),
    fileAlreadyImported: false,
  });
  const contentHash = hashTreasuryOfxPreviewContent(classified.movements);
  const token = issueTreasuryOfxPreviewToken({
    userId: USER_ID,
    accountId: ACCOUNT_ID,
    companyCode: "EMP1",
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
}

function createApplyService(movementRepo: TreasuryBankMovementRepository) {
  const accountRepo = {
    async findById(id: string) {
      return id === ACCOUNT_ID ? accountRow() : null;
    },
    async findAccess(accountId: string, userId: string) {
      if (accountId !== ACCOUNT_ID || userId !== USER_ID) return null;
      return accessRow("OPERATE");
    },
  } as unknown as TreasuryAccountRepository;

  const audits: unknown[] = [];
  return {
    service: createTreasuryBankImportOfxApplyService({
      prisma: {
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
        treasuryAuditLog: {
          create: async ({ data }: { data: unknown }) => {
            audits.push(data);
            return { id: `audit-${audits.length}`, ...((data as object) ?? {}) };
          },
        },
      } as never,
      accountRepo,
      movementRepo,
      runInTransaction: async (fn) =>
        fn({
          treasuryAuditLog: {
            create: async ({ data }: { data: unknown }) => {
              audits.push(data);
              return { id: `audit-${audits.length}` };
            },
          },
        } as never),
    }),
    audits,
  };
}

describe("treasuryBankImportOfxApplyApi — wiring", () => {
  it("registra POST apply OFX com flag e ACL", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(
      TREASURY_BANK_IMPORTS_OFX_APPLY_PATH,
      "/api/finance/treasury/bank-imports/ofx/apply"
    );
    assert.match(routes, /TREASURY_BANK_IMPORTS_OFX_APPLY_PATH/);
    assert.match(routes, /createTreasuryBankImportOfxApplyControllers/);
    assert.match(routes, /treasury\.ofxImport\.enabled/);
  });
});

describe("treasuryBankImportOfxApplyApi — handlers", () => {
  beforeEach(() => {
    clearTreasuryOfxPreviewTokenStoreForTests();
    clearTreasuryReconciliationSuggestionsRequests();
    clearTreasuryProjectionRecalcRequests();
  });

  it("aplica preview: cria lote/movimentos, audita, solicita sugestões e recalc", async () => {
    const movementRepo = createMemoryMovementRepo();
    const { service, audits } = createApplyService(movementRepo);
    const preview = issuePreviewFromFixture();

    const result = await service.apply(actor(), {
      previewToken: preview.previewToken,
      contentHash: preview.contentHash,
      notes: "import test",
    });

    assert.equal(result.ok, true);
    assert.equal(result.idempotent, false);
    assert.equal(result.created.count, 2);
    assert.equal(result.ignored.count, 0);
    assert.equal(result.invalid.count, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(movementRepo.batches.length, 1);
    assert.equal(movementRepo.movements.length, 2);
    assert.equal(movementRepo.batches[0]?.status, "PROCESSED");
    assert.equal(audits.length, 1);
    assert.equal((audits[0] as { action: string }).action, "IMPORT");
    assert.equal(result.suggestionsRequested.accepted, true);
    assert.equal(result.projectionRecalc.accepted, true);
    assert.equal(listTreasuryReconciliationSuggestionsRequests().length, 1);
    assert.equal(listTreasuryProjectionRecalcRequests().length, 1);
    assert.equal(
      peekTreasuryOfxPreviewToken(preview.previewToken, {
        expectedUserId: USER_ID,
      }),
      null
    );
  });

  it("reaplicar o mesmo arquivo não duplica movimentos (idempotente)", async () => {
    const movementRepo = createMemoryMovementRepo();
    const { service } = createApplyService(movementRepo);
    const first = issuePreviewFromFixture();
    const firstResult = await service.apply(actor(), {
      previewToken: first.previewToken,
      contentHash: first.contentHash,
      notes: null,
    });
    assert.equal(firstResult.created.count, 2);

    const secondPreview = issuePreviewFromFixture();
    const second = await service.apply(actor(), {
      previewToken: secondPreview.previewToken,
      contentHash: secondPreview.contentHash,
      notes: null,
    });

    assert.equal(second.idempotent, true);
    assert.equal(second.created.count, 0);
    assert.equal(second.batchId, firstResult.batchId);
    assert.equal(movementRepo.batches.length, 1);
    assert.equal(movementRepo.movements.length, 2);
    assert.ok(second.ignored.count >= 2);
  });

  it("rejeita previewToken inválido", async () => {
    const movementRepo = createMemoryMovementRepo();
    const { service } = createApplyService(movementRepo);
    await assert.rejects(
      () =>
        service.apply(actor(), {
          previewToken: "invalid.token",
          contentHash: null,
          notes: null,
        }),
      (err: unknown) => {
        assert.ok(err instanceof TreasuryDomainError);
        assert.equal(err.code, "VALIDATION_ERROR");
        assert.equal(err.field, "previewToken");
        return true;
      }
    );
  });

  it("controller retorna 201 no apply e 200 no idempotente", async () => {
    const movementRepo = createMemoryMovementRepo();
    const { service } = createApplyService(movementRepo);
    const controllers = createTreasuryBankImportOfxApplyControllers({
      getCurrentAppUser: async () =>
        ({
          id: USER_ID,
          name: "Ops",
          email: "ops@test.local",
          role: "SUPER_ADMIN",
          permissions: ["finance.treasury.reconciliation.manage"],
          effectivePermissions: ["finance.treasury.reconciliation.manage"],
          permissionsVersion: 1,
          accessProfileId: null,
          accessProfileName: null,
          employeeId: null,
          employeeName: null,
          employeeDepartment: null,
          isActive: true,
          externalSellerId: null,
          externalSellerIds: [],
          sellerResponsibleName: null,
          lastLoginAt: null,
          createdAt: "2026-07-27T00:00:00.000+00:00",
          updatedAt: "2026-07-27T00:00:00.000+00:00",
          sessionId: "sess",
          sessionPermissionsVersionAtIssue: 1,
        }) as AppAuthContext,
      service,
    });

    const preview = issuePreviewFromFixture();
    const res1 = createMockRes();
    await controllers.apply(
      {
        body: {
          previewToken: preview.previewToken,
          contentHash: preview.contentHash,
        },
        headers: {},
        header: () => "req-1",
        query: {},
        params: {},
      } as unknown as Request,
      res1 as unknown as Response
    );
    assert.equal(res1.statusCode, 201);
    assert.equal((res1.body as { ok: boolean }).ok, true);

    const preview2 = issuePreviewFromFixture();
    const res2 = createMockRes();
    await controllers.apply(
      {
        body: {
          previewToken: preview2.previewToken,
          contentHash: preview2.contentHash,
        },
        headers: {},
        header: () => "req-2",
        query: {},
        params: {},
      } as unknown as Request,
      res2 as unknown as Response
    );
    assert.equal(res2.statusCode, 200);
    assert.equal((res2.body as { idempotent: boolean }).idempotent, true);
  });
});
