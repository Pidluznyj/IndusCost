import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError } from "@/src/lib/http.js";
import type {
  TreasuryDailyClosingDto,
  TreasuryDailyClosingPreviewDto,
} from "./contracts/index.js";
import {
  canCloseTreasuryDailyClosing,
  canReopenTreasuryDailyClosing,
  canViewTreasuryDailyClosing,
} from "./treasuryDailyClosingPermissions.js";
import {
  TREASURY_DAILY_CLOSING_409_MESSAGE,
  TREASURY_DAILY_CLOSING_PAGE_TITLE,
  TREASURY_DAILY_CLOSING_STATUS_LABELS,
  buildTreasuryDailyClosingCaveatPayload,
  buildTreasuryDailyClosingChecklist,
  compareTreasuryDailyClosingVersions,
  formatTreasuryDailyClosingCivilDate,
  formatTreasuryDailyClosingMoney,
  isTreasuryDailyClosingChecklistReady,
  resolveTreasuryDailyClosingConflictMessage,
  resolveTreasuryDailyClosingViewKind,
} from "./treasuryDailyClosingUi.js";

function samplePreview(
  overrides: Partial<TreasuryDailyClosingPreviewDto> = {}
): TreasuryDailyClosingPreviewDto {
  return {
    ok: true,
    civilDate: "2026-07-27",
    companyCode: "EMP1",
    sourceHash: "b".repeat(64),
    generatedAt: "2026-07-27T18:00:00.000-03:00",
    summary: {
      openingBalance: "100.00",
      realizedInflows: "10.00",
      realizedOutflows: "5.00",
      pendenciesAmount: "0.00",
      closingBalance: "105.00",
      observedBalance: "105.00",
      reconciledBalance: "105.00",
      differenceAmount: "0.00",
      accountCount: 1,
      pendingReceivablesCount: 0,
      pendingPayablesCount: 0,
      absoluteBlockCount: 0,
      warningCount: 0,
      caveatRequiredCount: 0,
    },
    accounts: [],
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
    ...overrides,
  };
}

function sampleClosing(
  overrides: Partial<TreasuryDailyClosingDto> = {}
): TreasuryDailyClosingDto {
  return {
    id: "c1",
    companyCode: "EMP1",
    civilDate: "2026-07-27",
    status: "CLOSED",
    version: 1,
    sourceHash: "b".repeat(64),
    contentHash: null,
    openingBalance: "100.00",
    realizedInflows: "10.00",
    realizedOutflows: "5.00",
    pendenciesAmount: "0.00",
    closingBalance: "105.00",
    observedBalance: "105.00",
    reconciledBalance: "105.00",
    differenceAmount: "0.00",
    exceptionsCount: 0,
    exceptionsAmount: "0.00",
    caveatsCount: 0,
    previousClosingId: null,
    supersededByClosingId: null,
    closedByUserId: "u1",
    closedAt: "2026-07-27T20:00:00.000-03:00",
    createdByUserId: "u1",
    createdAt: "2026-07-27T20:00:00.000-03:00",
    ...overrides,
  };
}

describe("treasuryDailyClosingUi", () => {
  it("título, status e formatação", () => {
    assert.equal(TREASURY_DAILY_CLOSING_PAGE_TITLE, "Fechamento diário");
    assert.equal(TREASURY_DAILY_CLOSING_STATUS_LABELS.CLOSED, "Fechado");
    assert.equal(formatTreasuryDailyClosingCivilDate("2026-07-27"), "27/07/2026");
    assert.match(formatTreasuryDailyClosingMoney("105.00"), /105/);
  });

  it("view kind e checklist com ressalvas", () => {
    assert.equal(
      resolveTreasuryDailyClosingViewKind({
        canView: false,
        loading: false,
        error: null,
        hasPreview: false,
      }),
      "denied"
    );
    assert.equal(
      resolveTreasuryDailyClosingViewKind({
        canView: true,
        loading: true,
        error: null,
        hasPreview: false,
      }),
      "loading"
    );

    const preview = samplePreview({
      canCloseWithoutCaveats: false,
      canCloseWithCaveats: true,
      requiredCaveatCodes: ["STALE_BALANCE"],
      summary: {
        ...samplePreview().summary,
        caveatRequiredCount: 1,
      },
    });
    const incomplete = buildTreasuryDailyClosingChecklist(preview, {});
    assert.equal(isTreasuryDailyClosingChecklistReady(incomplete), false);
    const complete = buildTreasuryDailyClosingChecklist(preview, {
      STALE_BALANCE: "Saldo conferido manualmente.",
    });
    assert.equal(isTreasuryDailyClosingChecklistReady(complete), true);
    assert.deepEqual(
      buildTreasuryDailyClosingCaveatPayload(["STALE_BALANCE"], {
        STALE_BALANCE: " ok ",
      }),
      [{ code: "STALE_BALANCE", message: "ok", severity: "WARNING" }]
    );
  });

  it("409 mapeia mensagem de revisão e comparação de versões", () => {
    assert.equal(
      resolveTreasuryDailyClosingConflictMessage(new HttpError(409, "hash")),
      TREASURY_DAILY_CLOSING_409_MESSAGE
    );
    assert.equal(
      resolveTreasuryDailyClosingConflictMessage(new Error("x")),
      null
    );
    const diffs = compareTreasuryDailyClosingVersions(
      sampleClosing({ version: 1, closingBalance: "100.00" }),
      sampleClosing({
        id: "c2",
        version: 2,
        status: "OPEN",
        closingBalance: "110.00",
      })
    );
    const changed = diffs.filter((d) => d.changed).map((d) => d.field);
    assert.ok(changed.includes("version"));
    assert.ok(changed.includes("closingBalance"));
    assert.ok(changed.includes("status"));
  });

  it("permissões view/close/reopen", () => {
    assert.equal(canViewTreasuryDailyClosing({}), false);
    assert.equal(
      canViewTreasuryDailyClosing({
        canPerformAction: (r, a) =>
          r === "finance.treasury.closing" && a === "view",
      }),
      true
    );
    assert.equal(
      canCloseTreasuryDailyClosing({
        canPerformAction: (r, a) =>
          r === "finance.treasury.closing" && a === "close",
      }),
      true
    );
    assert.equal(
      canReopenTreasuryDailyClosing({
        hasPermission: (k) => k === "finance.treasury.closing.reopen",
      }),
      true
    );
  });
});
