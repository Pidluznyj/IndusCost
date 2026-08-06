import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProposalsIntegrationRunData } from "./nomusProposalsIntegrationRun.js";
import { NOMUS_PROPOSALS_SYNC_TARGET } from "./nomusProposalsSyncConstants.js";

const BASE = {
  mode: "apply" as const,
  startedAt: new Date("2026-08-05T14:37:00.000Z"),
  finishedAt: new Date("2026-08-05T14:38:22.000Z"),
  durationMs: 82000,
};

describe("buildProposalsIntegrationRunData — sempre um estado final auditável", () => {
  it("sucesso: success=true, status=SUCCESS, contadores extraídos de summary/applied", () => {
    const data = buildProposalsIntegrationRunData({
      ...BASE,
      status: "SUCCESS",
      exitCode: 0,
      summary: { totalRead: 27, eligibleCount: 25, blockedCount: 2 },
      applied: { created: 3, updated: 12, replacedItemsCount: 40 },
    });
    assert.equal(data.target, NOMUS_PROPOSALS_SYNC_TARGET);
    assert.equal(data.status, "SUCCESS");
    assert.equal(data.success, true);
    assert.equal(data.mode, "apply");
    assert.equal(data.exitCode, 0);
    assert.equal(data.pageRead, 27);
    assert.equal(data.eligibleCount, 25);
    assert.equal(data.blockedCount, 2);
    assert.equal(data.createdCount, 3);
    assert.equal(data.updatedCount, 12);
    assert.equal(data.itemsCreated, 40);
    assert.equal(data.durationMs, 82000);
  });

  it("falha: success=false, status=FAILED, errorMessage mascarada", () => {
    const data = buildProposalsIntegrationRunData({
      ...BASE,
      status: "FAILED",
      exitCode: 1,
      errorMessage: "Timeout HTTP após 60000ms; Authorization: Bearer abc123secret em https://nomus.example/propostas",
    });
    assert.equal(data.status, "FAILED");
    assert.equal(data.success, false);
    assert.equal(data.exitCode, 1);
    assert.ok(data.errorMessage);
    assert.doesNotMatch(String(data.errorMessage), /abc123secret/);
    assert.match(String(data.errorMessage), /Authorization: \*\*\*/);
  });

  it("skip por lock: success=false, status=SKIPPED, skipReason preservado em summaryJson", () => {
    const data = buildProposalsIntegrationRunData({
      ...BASE,
      status: "SKIPPED",
      exitCode: 0,
      skipReason: "LOCK_HELD",
      errorMessage: "Outra execução de propostas já está em andamento.",
    });
    assert.equal(data.status, "SKIPPED");
    // Skip nunca é sucesso, mesmo com exitCode 0 (critério de aceitação #12).
    assert.equal(data.success, false);
    const summaryJson = data.summaryJson as Record<string, unknown>;
    assert.equal(summaryJson.skipReason, "LOCK_HELD");
  });

  it("sem summary/applied (skip cedo) não quebra — contadores ficam null, não zero forjado", () => {
    const data = buildProposalsIntegrationRunData({
      ...BASE,
      status: "SKIPPED",
      exitCode: 0,
    });
    assert.equal(data.pageRead, null);
    assert.equal(data.createdCount, null);
  });

  it("logFile é repassado tal como recebido (link pro log real, quando existir)", () => {
    const data = buildProposalsIntegrationRunData({
      ...BASE,
      status: "SUCCESS",
      exitCode: 0,
      logFile: "/tmp/induscost-nomus-sync/runner-proposals-hourly_apply_2026-08-05.log",
    });
    assert.equal(
      data.logFile,
      "/tmp/induscost-nomus-sync/runner-proposals-hourly_apply_2026-08-05.log"
    );
  });

  it("sem logFile (invocação direta via npm run) fica null, não quebra", () => {
    const data = buildProposalsIntegrationRunData({ ...BASE, status: "SUCCESS", exitCode: 0 });
    assert.equal(data.logFile, null);
  });
});
