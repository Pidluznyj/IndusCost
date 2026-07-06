import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAccountsPayableDescriptiveText,
  pickDescriptiveTextFromRawPayload,
  resolveAccountsPayableDescriptiveText,
  resolveAccountsPayableDescriptiveTextWithSource,
} from "./financeAccountsPayableDescriptiveText.js";

describe("financeAccountsPayableDescriptiveText", () => {
  it("prioriza description sobre comments e rawPayload", () => {
    assert.equal(
      resolveAccountsPayableDescriptiveText({
        description: "Frete SP",
        comments: "Comentário",
        rawPayload: { observacao: "Payload" },
      }),
      "Frete SP"
    );
  });

  it("usa comments quando description está vazia", () => {
    assert.equal(
      resolveAccountsPayableDescriptiveText({
        description: "  ",
        comments: "Pagamento referente NF 123",
      }),
      "Pagamento referente NF 123"
    );
  });

  it("lê campos equivalentes do rawPayload", () => {
    assert.equal(
      pickDescriptiveTextFromRawPayload({ observacao: "Manutenção preventiva" }),
      "Manutenção preventiva"
    );
    assert.equal(
      pickDescriptiveTextFromRawPayload({ historico: "Combustível frota" }),
      "Combustível frota"
    );
  });

  it("retorna fallback — quando não há texto descritivo", () => {
    assert.equal(formatAccountsPayableDescriptiveText({}), "—");
    assert.equal(resolveAccountsPayableDescriptiveText({ comments: null }), null);
  });

  it("resolveAccountsPayableDescriptiveTextWithSource informa a fonte", () => {
    assert.deepEqual(
      resolveAccountsPayableDescriptiveTextWithSource({
        description: "Frete",
        comments: "Comentário",
      }),
      { text: "Frete", source: "description" }
    );
    assert.deepEqual(
      resolveAccountsPayableDescriptiveTextWithSource({
        rawPayload: { observacao: "Manutenção" },
      }),
      { text: "Manutenção", source: "rawPayload.observacao" }
    );
  });
});
