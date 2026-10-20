import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyPartyDocuments } from "./eligibility.js";

const CNPJ = "11444777000161";

describe("elegibilidade de CNPJ", () => {
  it("consulta cliente e fornecedor e unifica o mesmo CNPJ", () => {
    const rows = classifyPartyDocuments([
      { partyType: "CUSTOMER", partyId: "c1", rawDocument: "11.444.777/0001-61" },
      { partyType: "SUPPLIER", partyId: "s1", rawDocument: CNPJ },
      { partyType: "SUPPLIER", partyId: "s2", rawDocument: "00000000000191" },
    ]);
    const shared = rows.find((row) => row.kind === "CNPJ" && row.cnpj === CNPJ);
    assert.ok(shared && shared.kind === "CNPJ");
    assert.deepEqual(shared.customers, ["c1"]);
    assert.deepEqual(shared.suppliers, ["s1"]);
    assert.equal(rows.filter((row) => row.kind === "CNPJ").length, 2);
  });

  it("separa inválido, CPF e documento ausente sem tratá-los como CNPJ", () => {
    const rows = classifyPartyDocuments([
      { partyType: "CUSTOMER", partyId: "vazio", rawDocument: "  " },
      { partyType: "CUSTOMER", partyId: "cpf", rawDocument: "529.982.247-25" },
      { partyType: "SUPPLIER", partyId: "ruim", rawDocument: "11.111.111/1111-11" },
    ]);
    assert.equal(rows.some((row) => row.kind === "CNPJ"), false);
    const missing = rows.find((row) => row.kind === "MISSING");
    const cpf = rows.find((row) => row.kind === "CPF");
    const invalid = rows.find((row) => row.kind === "INVALID");
    assert.equal(missing?.kind === "MISSING" ? missing.partyId : null, "vazio");
    assert.equal(cpf?.kind === "CPF" ? cpf.digitLength : null, 11);
    assert.equal(invalid?.kind === "INVALID" ? invalid.partyId : null, "ruim");
  });
});
