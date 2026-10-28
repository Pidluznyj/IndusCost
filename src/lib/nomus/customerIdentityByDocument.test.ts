import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerIdentityIndexes,
  decideCustomerIdentity,
  documentDigits,
} from "./customerIdentityByDocument.ts";

describe("identidade de cliente por documento (syncs Nomus)", () => {
  it("CNPJ com e sem máscara têm os mesmos dígitos", () => {
    assert.equal(documentDigits("11.222.333/0001-81"), "11222333000181");
    assert.equal(documentDigits("11222333000181"), "11222333000181");
    assert.equal(documentDigits(" 11 222 333 0001 81 "), "11222333000181");
  });

  it("CPF em formatos diferentes", () => {
    assert.equal(documentDigits("123.456.789-09"), "12345678909");
    assert.equal(documentDigits("12345678909"), "12345678909");
    assert.equal(documentDigits(12345678909), "12345678909");
  });

  it("documento curto ou vazio não identifica cliente", () => {
    assert.equal(documentDigits(""), null);
    assert.equal(documentDigits("0"), null);
    assert.equal(documentDigits("1234567890"), null);
    assert.equal(documentDigits(null), null);
  });

  it("índice agrupa clientes equivalentes (máscara × dígitos) sem escolher um", () => {
    const idx = buildCustomerIdentityIndexes([
      { id: "b", taxId: "11222333000181", nomusExternalPersonId: null },
      { id: "a", taxId: "11.222.333/0001-81", nomusExternalPersonId: 7 },
      { id: "c", taxId: null, nomusExternalPersonId: 7 },
    ]);
    assert.deepEqual(idx.byDocument.get("11222333000181"), ["a", "b"]);
    assert.deepEqual(idx.byPersonId.get(7), ["a", "c"]);
  });

  it("duplicidade vira conflito; etapa seguinte só desempata dentro do conjunto", () => {
    assert.deepEqual(decideCustomerIdentity({ documentCustomerIds: ["a", "b"] }), {
      status: "CONFLICT",
      via: "DOCUMENT_DIGITS",
      candidateCustomerIds: ["a", "b"],
    });
    assert.deepEqual(
      decideCustomerIdentity({ salesOrderHistoryCustomerIds: ["a", "b"], personIdCustomerIds: ["b"] }),
      { status: "RESOLVED", customerId: "b", via: "NOMUS_PERSON_ID" }
    );
    // desempate fora do conjunto conflitante não vale
    assert.equal(
      decideCustomerIdentity({ salesOrderHistoryCustomerIds: ["a", "b"], personIdCustomerIds: ["z"] }).status,
      "CONFLICT"
    );
  });

  it("histórico de pedidos tem prioridade (preserva o cliente já gravado)", () => {
    assert.deepEqual(
      decideCustomerIdentity({ salesOrderHistoryCustomerIds: ["a"], personIdCustomerIds: ["b"], documentCustomerIds: ["c"] }),
      { status: "RESOLVED", customerId: "a", via: "SALES_ORDER_HISTORY" }
    );
    assert.deepEqual(decideCustomerIdentity({}), { status: "NOT_FOUND" });
  });
});
