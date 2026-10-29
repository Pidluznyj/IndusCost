import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractNomusProposalReferences,
  listCandidateProposalReferenceKeys,
  NOMUS_CONFIRMED_PROPOSAL_REFERENCE_FIELDS,
  type NomusProposalReferenceField,
} from "./nomusProposalOrderReference.ts";

// Campos FICTÍCIOS, só para exercitar o leitor; não representam o contrato do Nomus.
const TEST_FIELDS: NomusProposalReferenceField[] = [
  { path: "campoTesteIdProposta", identifies: "EXTERNAL_ID" },
  { path: "origem.codigoTeste", identifies: "CODE" },
];

describe("referência explícita Pedido → Proposta no payload do Nomus", () => {
  it("nenhum campo confirmado: payloads reais nunca produzem referência explícita", () => {
    assert.equal(NOMUS_CONFIRMED_PROPOSAL_REFERENCE_FIELDS.length, 0);
    assert.deepEqual(extractNomusProposalReferences({ idProposta: 10, proposta: "PR-1" }), []);
  });

  it("payload sem referência → vazio", () => {
    assert.deepEqual(extractNomusProposalReferences({ id: 1, itensPedido: [] }, TEST_FIELDS), []);
  });

  it("payload incompleto ou inválido → vazio (zero, texto não numérico, nulo, objeto)", () => {
    for (const value of [0, -3, "abc", null, {}, [], "  "]) {
      assert.deepEqual(
        extractNomusProposalReferences({ campoTesteIdProposta: value, origem: { codigoTeste: value === "abc" ? "  " : null } }, TEST_FIELDS),
        [],
        `valor ${JSON.stringify(value)}`
      );
    }
    assert.deepEqual(extractNomusProposalReferences(null, TEST_FIELDS), []);
  });

  it("lê id numérico (inclusive texto numérico) e código aninhado", () => {
    assert.deepEqual(
      extractNomusProposalReferences({ campoTesteIdProposta: " 42 ", origem: { codigoTeste: "PR-0042" } }, TEST_FIELDS),
      [
        { field: "campoTesteIdProposta", identifies: "EXTERNAL_ID", value: "42" },
        { field: "origem.codigoTeste", identifies: "CODE", value: "PR-0042" },
      ]
    );
  });

  it("diagnóstico lista só NOMES de chaves candidatas, nunca valores", () => {
    const keys = listCandidateProposalReferenceKeys({
      codigoPedido: "PD-1",
      idPropostaOrigem: 5,
      itensPedido: [{ idProduto: 1, codigoOrcamento: "X" }],
    });
    assert.deepEqual(keys, ["idPropostaOrigem", "itensPedido[].codigoOrcamento"]);
  });
});
