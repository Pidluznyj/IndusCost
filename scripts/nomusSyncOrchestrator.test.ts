import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveStepStatusFromChildOutput } from "./nomusSyncOrchestrator.ts";

describe("nomus sync orchestrator — status do step a partir do output do filho", () => {
  it("exitCode != 0 é sempre FAILED, independente do stdout", () => {
    assert.equal(resolveStepStatusFromChildOutput(1, ""), "FAILED");
    assert.equal(
      resolveStepStatusFromChildOutput(1, JSON.stringify({ status: "SKIPPED" })),
      "FAILED"
    );
  });

  it("exitCode 0 sem campo status no JSON continua SUCCESS (outros targets não são afetados)", () => {
    assert.equal(resolveStepStatusFromChildOutput(0, ""), "SUCCESS");
    assert.equal(
      resolveStepStatusFromChildOutput(0, JSON.stringify({ mode: "apply", summary: {} })),
      "SUCCESS"
    );
  });

  it("exitCode 0 com status:SKIPPED no JSON do filho (ex.: propostas bloqueado por lock) reporta SKIPPED, não SUCCESS", () => {
    const stdout = JSON.stringify({
      mode: "apply",
      status: "SKIPPED",
      skipReason: "LOCK_HELD",
      summary: null,
      applied: null,
    });
    assert.equal(resolveStepStatusFromChildOutput(0, stdout), "SKIPPED");
  });

  it("stdout com JSON inválido não quebra — cai no comportamento padrão", () => {
    assert.equal(resolveStepStatusFromChildOutput(0, "não é json"), "SUCCESS");
  });
});
