import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryReportExportControllers } from "./controllers/treasuryReportExportController.js";
import { TREASURY_REPORTS_PATH } from "./contracts/treasuryContracts.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryReportExportService } from "./services/treasuryReportExportService.server.js";

const here = dirname(fileURLToPath(import.meta.url));

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  send: (payload: unknown) => MockRes;
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
    send(payload) {
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
    role: "SUPER_ADMIN",
    permissions: [
      "finance.treasury.reports.view",
      "finance.treasury.export",
    ],
    effectivePermissions: [
      "finance.treasury.reports.view",
      "finance.treasury.export",
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
    createdAt: "2026-07-27T00:00:00.000+00:00",
    updatedAt: "2026-07-27T00:00:00.000+00:00",
    sessionId: "sess-1",
    sessionPermissionsVersionAtIssue: 1,
    ...overrides,
  };
}

describe("treasuryReportExportApi — wiring", () => {
  it("registra export.csv/xlsx/pdf com viewReports + export", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_REPORTS_PATH, "/api/finance/treasury/reports");
    assert.match(routes, /export\.csv/);
    assert.match(routes, /export\.xlsx/);
    assert.match(routes, /export\.pdf/);
    assert.match(routes, /exportTreasury/);
    assert.match(routes, /createTreasuryReportExportControllers/);
    assert.match(routes, /TREASURY_ACTIONS\.export/);
  });
});

describe("treasuryReportExportApi — handlers", () => {
  it("retorna CSV com content-disposition; 403 sem export", async () => {
    const service: TreasuryReportExportService = {
      async exportReport(actor, _query, format) {
        if (!actor.canExport && !actor.isSuperAdmin) {
          throw new TreasuryDomainError("FORBIDDEN", "negado");
        }
        return {
          filename: `tesouraria-exceptions-2026-07-27.${format}`,
          contentType:
            format === "csv"
              ? "text/csv; charset=utf-8"
              : format === "pdf"
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          body: Buffer.from(format === "csv" ? "a,b\n1,2\n" : "%PDF-1.4"),
          generatedAt: "2026-07-27T15:00:00.000Z",
        };
      },
    };

    const ok = createTreasuryReportExportControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });
    const res = createMockRes();
    await ok.exportCsv(
      {
        params: { reportKey: "exceptions" },
        query: { from: "2026-07-01", to: "2026-07-27" },
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      res as unknown as Response
    );
    assert.equal(res.statusCode, 200);
    assert.match(
      res.headers["content-disposition"] ?? "",
      /attachment; filename="tesouraria-exceptions-2026-07-27\.csv"/
    );
    assert.equal(res.headers["content-type"], "text/csv; charset=utf-8");
    assert.equal(res.headers["x-generated-at"], "2026-07-27T15:00:00.000Z");

    const denied = createTreasuryReportExportControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "VIEWER",
          permissions: ["finance.treasury.reports.view"],
          effectivePermissions: ["finance.treasury.reports.view"],
        }),
      service: {
        async exportReport(actor) {
          if (!actor.canExport && !actor.isSuperAdmin) {
            throw new TreasuryDomainError("FORBIDDEN", "negado");
          }
          return {
            filename: "x.csv",
            contentType: "text/csv",
            body: Buffer.from("x"),
            generatedAt: "2026-07-27T15:00:00.000Z",
          };
        },
      },
    });
    const deniedRes = createMockRes();
    await denied.exportCsv(
      {
        params: { reportKey: "exceptions" },
        query: { from: "2026-07-01", to: "2026-07-27" },
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      deniedRes as unknown as Response
    );
    assert.equal(deniedRes.statusCode, 403);
  });
});
