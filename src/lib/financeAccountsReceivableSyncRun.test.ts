import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatFinanceArSyncDurationMs,
  interpretFinanceArSyncRunResponse,
} from "./financeAccountsReceivableSyncRun.js";

describe("financeAccountsReceivableSyncRun", () => {
  it("trata 409 como conflito em andamento", () => {
    const result = interpretFinanceArSyncRunResponse(409, {
      message: "Já existe uma execução em andamento.",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.conflict, true);
      assert.match(result.message, /andamento/i);
    }
  });

  it("trata 202 como sucesso", () => {
    const result = interpretFinanceArSyncRunResponse(202, {
      message: "Iniciado.",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.message, "Iniciado.");
  });

  it("formata duração sem NaN", () => {
    assert.equal(formatFinanceArSyncDurationMs(null), "—");
    assert.equal(formatFinanceArSyncDurationMs(125000), "2m 5s");
    assert.equal(formatFinanceArSyncDurationMs(Number.NaN), "—");
  });
});
