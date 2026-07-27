import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TREASURY_ERROR_CODES } from "./contracts/treasuryErrorCodes.js";
import { treasuryErrorStatus } from "./treasuryHttp.js";
import {
  evaluateTreasuryCriticalRateLimit,
  resetTreasuryRateLimitBucketsForTests,
} from "./treasuryRateLimit.js";
import { TREASURY_CRITICAL_RATE_LIMITS } from "./domain/treasurySecurityRules.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("treasurySecurity audit — wiring", () => {
  it("rotas críticas têm auth + rate limit", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.match(routes, /requireAppAuth/);
    assert.match(routes, /rateOfxPreview/);
    assert.match(routes, /rateOfxApply/);
    assert.match(routes, /rateReverse/);
    assert.match(routes, /rateClose/);
    assert.match(routes, /rateReopen/);
    assert.match(routes, /rateReportExport/);
    assert.match(routes, /requireTreasuryCriticalRateLimit/);
  });

  it("movimentos bancários aplicam ACL por conta (anti-IDOR)", () => {
    const svc = readFileSync(
      join(here, "services/treasuryBankMovementQueryService.server.ts"),
      "utf8"
    );
    assert.match(svc, /resolveAuthorizedAccountIds/);
    assert.match(svc, /canTreasuryActorViewAccountBalance/);
    assert.match(svc, /Sem acesso ao movimento bancário/);
    assert.match(svc, /accountIds/);
  });

  it("OFX temp storage valida path containment", () => {
    const temp = readFileSync(
      join(here, "ofx/treasuryOfxTempStorage.server.ts"),
      "utf8"
    );
    assert.match(temp, /assertTreasuryPathInsideRoot/);
    assert.match(temp, /resolve\(/);
  });

  it("logs HTTP sanitizam dados sensíveis", () => {
    const http = readFileSync(join(here, "treasuryHttp.ts"), "utf8");
    assert.match(http, /sanitizeTreasuryLogValue/);
    assert.match(http, /RATE_LIMITED/);
  });

  it("RATE_LIMITED está no contrato e mapeia 429", () => {
    assert.ok((TREASURY_ERROR_CODES as readonly string[]).includes("RATE_LIMITED"));
    assert.equal(treasuryErrorStatus("RATE_LIMITED"), 429);
  });
});

describe("treasurySecurity audit — rate limit runtime", () => {
  it("bloqueia após limite de ofxApply", () => {
    resetTreasuryRateLimitBucketsForTests();
    const userId = "user-rate-1";
    for (let i = 0; i < TREASURY_CRITICAL_RATE_LIMITS.ofxApply; i += 1) {
      const r = evaluateTreasuryCriticalRateLimit({
        userId,
        action: "ofxApply",
        nowMs: 1_000_000 + i,
      });
      assert.equal(r.allowed, true);
    }
    const blocked = evaluateTreasuryCriticalRateLimit({
      userId,
      action: "ofxApply",
      nowMs: 1_000_010,
    });
    assert.equal(blocked.allowed, false);
  });
});
