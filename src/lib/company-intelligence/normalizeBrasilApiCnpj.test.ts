import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUsableBrasilApiPayload, normalizeBrasilApiCnpjPayload } from "./normalizeBrasilApiCnpj.js";

describe("normalizeBrasilApiCnpj", () => {
  it("exige razão social e CNPJ para payload utilizável", () => {
    assert.equal(isUsableBrasilApiPayload({ razao_social: "X" }), false);
    assert.equal(
      isUsableBrasilApiPayload({ cnpj: "11444777000161", razao_social: "EMPRESA TESTE LTDA" }),
      true
    );
  });

  it("normaliza campos cadastrais da BrasilAPI", () => {
    const summary = normalizeBrasilApiCnpjPayload({
      cnpj: "11444777000161",
      razao_social: "EMPRESA TESTE LTDA",
      nome_fantasia: "FANTASIA",
      descricao_situacao_cadastral: "Ativa",
      uf: "pr",
      cep: "80010000",
      capital_social: 1000,
      cnae_fiscal: "2511000",
      cnae_fiscal_descricao: "Estruturas",
      qsa: [{ nome_socio: "Ana", qualificacao_socio: "Sócia" }],
    });
    assert.equal(summary.companyName, "EMPRESA TESTE LTDA");
    assert.equal(summary.state, "PR");
    assert.equal(summary.zipCode, "80010-000");
    assert.equal(summary.registrationStatusNormalized, "ATIVA");
    assert.equal(summary.mainCnae?.code, "2511000");
    assert.equal(summary.hasPartners, true);
  });
});
