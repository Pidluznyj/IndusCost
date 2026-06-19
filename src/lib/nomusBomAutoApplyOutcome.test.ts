import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAutoApplyBlockingBreakdown,
  isOperationalAutoApplyBlockMessage,
  orchestratorPipelineSuccess,
  resolveAutoApplyBatchOutcome,
} from "./nomusBomAutoApplyOutcome";
import type { NomusBomAutoApplyProductResult } from "./nomusBomAutoApplyAfterSyncTypes";

describe("nomusBomAutoApplyOutcome", () => {
  it("681.01AA — mensagem de opcional pendente é bloqueio operacional", () => {
    assert.equal(
      isOperationalAutoApplyBlockMessage(
        "BOM efetiva bloqueada ou incompleta. Opcionais de precificação ainda não estão resolvidos."
      ),
      true
    );
  });

  it("timeout genérico não é bloqueio operacional", () => {
    assert.equal(isOperationalAutoApplyBlockMessage("ECONNRESET timeout"), false);
  });

  it("lote só com BLOCKED → SUCCESS_WITH_BLOCKED e exit 0", () => {
    const totals = {
      parentsInNomusStage: 10,
      parentsEvaluated: 2,
      parentsApplied: 1,
      parentsReadyToApply: 0,
      parentsNoChanges: 0,
      parentsBlocked: 1,
      parentsSkipped: 0,
      parentsErrored: 0,
      linesCreated: 0,
      linesUpdated: 1,
      linesRemoved: 0,
      linesKept: 0,
    };
    assert.equal(resolveAutoApplyBatchOutcome(totals), "SUCCESS_WITH_BLOCKED");
  });

  it("erro técnico → FAILED", () => {
    const totals = {
      parentsInNomusStage: 10,
      parentsEvaluated: 2,
      parentsApplied: 0,
      parentsReadyToApply: 0,
      parentsNoChanges: 0,
      parentsBlocked: 0,
      parentsSkipped: 0,
      parentsErrored: 1,
      linesCreated: 0,
      linesUpdated: 0,
      linesRemoved: 0,
      linesKept: 0,
    };
    assert.equal(resolveAutoApplyBatchOutcome(totals), "FAILED");
  });

  it("orchestrator continua pipeline com bom SUCCESS_WITH_BLOCKED", () => {
    assert.equal(
      orchestratorPipelineSuccess({
        results: [
          { status: "SUCCESS" },
          { status: "SUCCESS_WITH_BLOCKED" },
          { status: "SKIPPED" },
        ],
        bomAutoApplyStatus: "SUCCESS_WITH_BLOCKED",
      }),
      true
    );
  });

  it("breakdown separa optionalPricing de technicalErrors", () => {
    const products: NomusBomAutoApplyProductResult[] = [
      {
        parentCode: "681.01AA",
        productId: "p1",
        status: "BLOCKED",
        canApply: false,
        blockingReasons: ["Opcionais de precificação ainda não estão resolvidos."],
      },
      {
        parentCode: "X.00",
        productId: "p2",
        status: "ERROR",
        canApply: false,
        blockingReasons: [],
        errorMessage: "database connection lost",
      },
    ];
    const b = buildAutoApplyBlockingBreakdown(products);
    assert.equal(b.blockedByOptionalPricing, 1);
    assert.equal(b.technicalErrors, 1);
  });
});
