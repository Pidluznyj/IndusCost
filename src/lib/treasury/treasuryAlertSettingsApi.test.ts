import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryAlertSettingsControllers } from "./controllers/treasuryAlertSettingsController.js";
import { TREASURY_ALERT_SETTINGS_PATH } from "./contracts/treasuryContracts.js";
import { DEFAULT_TREASURY_ALERT_SETTINGS } from "./contracts/treasuryAlertConfig.js";
import type { TreasuryAlertSettingsService } from "./services/treasuryAlertSettingsService.server.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";

const here = dirname(fileURLToPath(import.meta.url));

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
    id: "user-admin",
    name: "Admin",
    email: "admin@test.local",
    role: "ADMIN",
    permissions: [
      "finance.treasury.view",
      "finance.treasury.exceptions.manage",
    ],
    effectivePermissions: [
      "finance.treasury.view",
      "finance.treasury.exceptions.manage",
    ],
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
    sessionId: "sess-1",
    sessionPermissionsVersionAtIssue: 1,
    ...overrides,
  };
}

describe("treasuryAlertSettingsApi — wiring", () => {
  it("registra GET/PUT alert-settings", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(
      TREASURY_ALERT_SETTINGS_PATH,
      "/api/finance/treasury/alert-settings"
    );
    assert.match(routes, /TREASURY_ALERT_SETTINGS_PATH/);
    assert.match(routes, /createTreasuryAlertSettingsControllers/);
  });
});

describe("treasuryAlertSettingsApi — permissão e fluxo", () => {
  it("GET devolve settings; PUT exige manage", async () => {
    const settings = {
      id: "GLOBAL",
      ...DEFAULT_TREASURY_ALERT_SETTINGS,
      updatedAt: "2026-08-14T12:00:00.000+00:00",
      updatedByUserId: null,
    };
    const service = {
      async get() {
        return settings;
      },
      async update(_actor: unknown, body: Record<string, unknown>) {
        return {
          ...settings,
          relevantReceiptMinAmount: String(
            body.relevantReceiptMinAmount ?? settings.relevantReceiptMinAmount
          ),
          updatedByUserId: "user-admin",
        };
      },
      async getFields() {
        return DEFAULT_TREASURY_ALERT_SETTINGS;
      },
    } as unknown as TreasuryAlertSettingsService;

    const controllers = createTreasuryAlertSettingsControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });

    const getRes = createMockRes();
    await controllers.get(
      { query: {}, params: {}, body: {}, headers: {}, header: () => "r1" } as unknown as Request,
      getRes as unknown as Response
    );
    assert.equal(getRes.statusCode, 200);
    assert.equal(
      (getRes.body as { settings: { id: string } }).settings.id,
      "GLOBAL"
    );

    const forbiddenService = {
      async update() {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para alterar configuração de alertas."
        );
      },
    } as unknown as TreasuryAlertSettingsService;

    const denied = createTreasuryAlertSettingsControllers({
      getCurrentAppUser: async () =>
        baseUser({
          permissions: ["finance.treasury.view"],
          effectivePermissions: ["finance.treasury.view"],
        }),
      service: forbiddenService,
    });
    const putRes = createMockRes();
    await denied.put(
      {
        query: {},
        params: {},
        body: { relevantReceiptMinAmount: "1" },
        headers: {},
        header: () => "r2",
      } as unknown as Request,
      putRes as unknown as Response
    );
    assert.ok(putRes.statusCode >= 400);
  });
});
