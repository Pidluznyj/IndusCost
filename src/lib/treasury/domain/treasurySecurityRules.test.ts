import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TREASURY_CSRF_ARCHITECTURE_NOTE,
  assertTreasuryPathInsideRoot,
  checkTreasurySlidingWindowRateLimit,
  redactTreasuryBankSummaryJson,
  resolveTreasuryOfxPreviewSecret,
  sanitizeTreasuryLogMessage,
  sanitizeTreasuryLogValue,
} from "./treasurySecurityRules.js";
import { TreasuryDomainError } from "./treasuryErrors.js";
import {
  neutralizeTreasuryCsvFormulaInjection,
  escapeTreasuryCsvCell,
} from "../treasuryReportExport.js";

describe("treasurySecurityRules — rate limit", () => {
  it("permite até o limite e bloqueia o excedente", () => {
    let stamps: number[] = [];
    const now = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      const r = checkTreasurySlidingWindowRateLimit({
        timestampsMs: stamps,
        nowMs: now + i,
        limit: 5,
        windowMs: 60_000,
      });
      assert.equal(r.allowed, true);
      stamps = r.nextTimestampsMs;
    }
    const blocked = checkTreasurySlidingWindowRateLimit({
      timestampsMs: stamps,
      nowMs: now + 10,
      limit: 5,
      windowMs: 60_000,
    });
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterMs > 0);
  });
});

describe("treasurySecurityRules — path traversal / logs / summary", () => {
  it("bloqueia path fora do root", () => {
    assert.throws(
      () =>
        assertTreasuryPathInsideRoot(
          "C:/tmp/induscost-treasury-ofx-abc",
          "C:/tmp/evil.ofx"
        ),
      /área permitida|FORBIDDEN/i
    );
    assert.doesNotThrow(() =>
      assertTreasuryPathInsideRoot(
        "C:/tmp/induscost-treasury-ofx-abc",
        "C:/tmp/induscost-treasury-ofx-abc/file.ofx"
      )
    );
  });

  it("sanitiza logs sensíveis e tokens longos", () => {
    const cleaned = sanitizeTreasuryLogValue({
      previewToken: "abc.def",
      ofxPayload: "OFXHEADER:100",
      ok: "safe",
    }) as Record<string, unknown>;
    assert.equal(cleaned.previewToken, "[redacted]");
    assert.equal(cleaned.ofxPayload, "[redacted]");
    assert.equal(cleaned.ok, "safe");
    assert.match(
      sanitizeTreasuryLogMessage("token=" + "x".repeat(60)),
      /redacted/
    );
  });

  it("redige summaryJson sem expor payload bancário bruto", () => {
    const redacted = redactTreasuryBankSummaryJson({
      createdCount: 2,
      rawOfx: "<OFX>...</OFX>",
      previewToken: "a.b",
      nested: { movements: [{ a: 1 }, { a: 2 }] },
    });
    assert.equal(redacted?.createdCount, 2);
    assert.equal(redacted?.rawOfx, undefined);
    assert.equal(redacted?.previewToken, undefined);
    assert.equal(
      (redacted?.nested as Record<string, unknown> | undefined)?.movements,
      2
    );
  });
});

describe("treasurySecurityRules — OFX secret + CSV + CSRF note", () => {
  it("exige segredo em produção e aceita fallback em dev", () => {
    assert.throws(
      () =>
        resolveTreasuryOfxPreviewSecret({
          NODE_ENV: "production",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FEATURE_DISABLED"
    );
    assert.equal(
      resolveTreasuryOfxPreviewSecret({ NODE_ENV: "development" }).length > 0,
      true
    );
    assert.equal(
      resolveTreasuryOfxPreviewSecret({
        NODE_ENV: "production",
        SESSION_SECRET: "sess",
      }),
      "sess"
    );
  });

  it("protege CSV contra formula injection", () => {
    assert.equal(neutralizeTreasuryCsvFormulaInjection("=1+2"), "'=1+2");
    assert.equal(escapeTreasuryCsvCell("+2+2"), "'+2+2");
  });

  it("documenta arquitetura CSRF SameSite=Lax", () => {
    assert.match(TREASURY_CSRF_ARCHITECTURE_NOTE, /SameSite=Lax/);
    assert.match(TREASURY_CSRF_ARCHITECTURE_NOTE, /requireAppAuth/);
  });
});
