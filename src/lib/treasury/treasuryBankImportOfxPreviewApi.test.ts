/**
 * Wiring + casos de preview OFX: válido, duplicado, inválido, conta sem permissão.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryBankImportOfxPreviewControllers } from "./controllers/treasuryBankImportOfxPreviewController.js";
import { TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH } from "./contracts/treasuryContracts.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import { buildTreasuryBankMovementFingerprint } from "./domain/treasuryBankMovementFingerprint.js";
import { absoluteTreasuryMoneyString } from "./domain/treasuryOfxPreviewRules.js";
import { clearTreasuryOfxPreviewTokenStoreForTests } from "./ofx/treasuryOfxPreviewToken.server.js";
import { parseTreasuryOfxBuffer } from "./ofx/treasuryOfxParser.js";
import type { TreasuryAccountAccessRow, TreasuryAccountRow } from "./mappers/treasuryAccountMappers.js";
import type { TreasuryAccountRepository } from "./repositories/treasuryAccountRepository.server.js";
import type { TreasuryBankMovementRepository } from "./repositories/treasuryBankMovementRepository.server.js";
import {
  createTreasuryBankImportOfxPreviewService,
  type TreasuryBankImportOfxPreviewActor,
} from "./services/treasuryBankImportOfxPreviewService.server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "ofx", "fixtures");
const ACCOUNT_ID = "11111111-2222-3333-4444-555555555555";

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

function baseUser(overrides: Partial<AppAuthContext> = {}): AppAuthContext {
  return {
    id: "user-ops",
    name: "Ops",
    email: "ops@test.local",
    role: "VIEWER",
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
    mustChangePassword: false,
    passwordChangedAt: null,
    createdAt: "2026-07-27T00:00:00.000+00:00",
    updatedAt: "2026-07-27T00:00:00.000+00:00",
    sessionId: "sess-ofx",
    sessionPermissionsVersionAtIssue: 1,
    ...overrides,
  };
}

function actor(
  overrides: Partial<TreasuryBankImportOfxPreviewActor> = {}
): TreasuryBankImportOfxPreviewActor {
  return {
    userId: "user-ops",
    role: "VIEWER",
    isSuperAdmin: false,
    canManageReconciliation: true,
    canManageAccounts: false,
    canViewAccounts: true,
    requestId: "req-ofx",
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
    liquidity: "OPERATING",
    defaultBalanceOrigin: "MANUAL",
    sortOrder: 1,
    nomusBankAccountId: null,
    isActive: true,
    createdByUserId: "user-ops",
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
    userId: "user-ops",
    accessLevel: level,
    canViewBalance: true,
    canMutateBalance: true,
    isActive: true,
    grantedByUserId: "admin",
    grantedAt: new Date("2026-07-01T00:00:00.000Z"),
    revokedAt: null,
  };
}

function loadFixture(name: string): Buffer {
  return readFileSync(join(fixturesDir, name));
}

function createRepos(options?: {
  access?: TreasuryAccountAccessRow | null;
  existingFingerprints?: Set<string>;
  existingBatchId?: string | null;
}) {
  const accountRepo = {
    async findById(id: string) {
      return id === ACCOUNT_ID ? accountRow() : null;
    },
    async findAccess(accountId: string, userId: string) {
      if (accountId !== ACCOUNT_ID || userId !== "user-ops") return null;
      if (options && "access" in options) return options.access ?? null;
      return accessRow();
    },
  } as unknown as TreasuryAccountRepository;

  const movementRepo = {
    async findExistingFingerprints() {
      return options?.existingFingerprints ?? new Set();
    },
    async findBatchIdByFileSha256() {
      return options?.existingBatchId ?? null;
    },
  } as unknown as TreasuryBankMovementRepository;

  return createTreasuryBankImportOfxPreviewService({
    prisma: {} as never,
    accountRepo,
    movementRepo,
  });
}

describe("treasuryBankImportOfxPreviewApi — wiring", () => {
  it("registra POST preview OFX com flag, ACL e multer", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(
      TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH,
      "/api/finance/treasury/bank-imports/ofx/preview"
    );
    assert.match(routes, /TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH/);
    assert.match(routes, /createTreasuryBankImportOfxPreviewControllers/);
    assert.match(routes, /treasury\.ofxImport\.enabled/);
    assert.match(routes, /ofxUpload\.single\("file"\)/);
    assert.match(routes, /TREASURY_RESOURCE_KEYS\.reconciliation/);
  });
});

describe("treasuryBankImportOfxPreviewApi — handlers", () => {
  it("arquivo válido: normaliza, fingerprint, totais/período e token temporário", async () => {
    clearTreasuryOfxPreviewTokenStoreForTests();
    const service = createRepos();
    const result = await service.preview(actor(), {
      accountId: ACCOUNT_ID,
      buffer: loadFixture("sample-ofx1.ofx"),
      originalName: "sample-ofx1.ofx",
      mimeType: "application/x-ofx",
    });

    assert.equal(result.ok, true);
    assert.equal(result.persisted, false);
    assert.match(result.previewToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(result.expiresAt);
    assert.equal(result.totals.movementCount, 2);
    assert.equal(result.totals.newCount, 2);
    assert.equal(result.totals.duplicateCount, 0);
    assert.equal(result.totals.invalidCount, 0);
    assert.deepEqual(result.period, {
      startCivilDate: "2026-07-15",
      endCivilDate: "2026-07-16",
    });
    assert.equal(result.totals.creditAmount, "150.00");
    assert.equal(result.totals.debitAmount, "40.50");
    assert.ok(result.movements.every((m) => m.status === "NEW" && m.fingerprint));
    assert.equal(result.fileAlreadyImported, false);
  });

  it("duplicado: marca movimentos já existentes por fingerprint", async () => {
    clearTreasuryOfxPreviewTokenStoreForTests();
    const parsed = parseTreasuryOfxBuffer(loadFixture("sample-ofx1.ofx"), {
      quarantineInvalid: true,
    });
    const existing = new Set(
      parsed.transactions.map((tx) =>
        buildTreasuryBankMovementFingerprint({
          accountId: ACCOUNT_ID,
          fitId: tx.fitId,
          postedCivilDate: tx.postedCivilDate,
          direction: tx.direction,
          amount: absoluteTreasuryMoneyString(tx.amount),
          description: tx.memo,
        })
      )
    );
    const service = createRepos({ existingFingerprints: existing });
    const result = await service.preview(actor(), {
      accountId: ACCOUNT_ID,
      buffer: loadFixture("sample-ofx1.ofx"),
      originalName: "sample-ofx1.ofx",
      mimeType: "application/x-ofx",
    });

    assert.equal(result.totals.newCount, 0);
    assert.equal(result.totals.duplicateCount, 2);
    assert.ok(
      result.movements.every(
        (m) =>
          m.status === "DUPLICATE" && m.duplicateReason === "EXISTING_MOVEMENT"
      )
    );
    assert.equal(result.persisted, false);
    assert.ok(result.previewToken);
  });

  it("arquivo inválido: rejeita malformado sem gravar", async () => {
    clearTreasuryOfxPreviewTokenStoreForTests();
    const service = createRepos();
    await assert.rejects(
      () =>
        service.preview(actor(), {
          accountId: ACCOUNT_ID,
          buffer: loadFixture("malformed.ofx"),
          originalName: "malformed.ofx",
          mimeType: "application/x-ofx",
        }),
      (err: unknown) => {
        assert.ok(err instanceof TreasuryDomainError);
        assert.equal(err.code, "VALIDATION_ERROR");
        return true;
      }
    );
  });

  it("conta sem permissão operacional: FORBIDDEN", async () => {
    clearTreasuryOfxPreviewTokenStoreForTests();
    const service = createRepos({ access: accessRow("VIEW") });
    await assert.rejects(
      () =>
        service.preview(actor(), {
          accountId: ACCOUNT_ID,
          buffer: loadFixture("sample-ofx1.ofx"),
          originalName: "sample-ofx1.ofx",
          mimeType: "application/x-ofx",
        }),
      (err: unknown) => {
        assert.ok(err instanceof TreasuryDomainError);
        assert.equal(err.code, "FORBIDDEN");
        assert.equal(err.field, "accountId");
        return true;
      }
    );
  });

  it("controller retorna 200 com requestId no arquivo válido", async () => {
    clearTreasuryOfxPreviewTokenStoreForTests();
    const service = createRepos();
    const controllers = createTreasuryBankImportOfxPreviewControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "SUPER_ADMIN",
          permissions: [
            "finance.treasury.reconciliation.manage",
            "finance.treasury.accounts.manage",
          ],
          effectivePermissions: [
            "finance.treasury.reconciliation.manage",
            "finance.treasury.accounts.manage",
          ],
        }),
      service,
    });
    const res = createMockRes();
    const file = {
      buffer: loadFixture("sample-ofx1.ofx"),
      originalname: "sample-ofx1.ofx",
      mimetype: "application/x-ofx",
      size: 100,
    };
    await controllers.preview(
      {
        body: { accountId: ACCOUNT_ID },
        file,
        headers: {},
        header: () => "req-ctrl",
        query: {},
        params: {},
      } as unknown as Request,
      res as unknown as Response
    );
    assert.equal(res.statusCode, 200);
    const body = res.body as {
      ok: boolean;
      previewToken: string;
      persisted: boolean;
      requestId: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.persisted, false);
    assert.ok(body.previewToken);
    assert.equal(body.requestId, "req-ctrl");
  });
});
