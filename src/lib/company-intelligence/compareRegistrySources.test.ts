import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePublicCnpjPayload } from "@/src/lib/companyCnpjNormalize.js";
import { buildRegistryProvenance, provenanceConflicts, valuesAreEquivalent } from "./compareRegistrySources.js";
import { normalizeBrasilApiCnpjPayload } from "./normalizeBrasilApiCnpj.js";
import { CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA } from "./registryTypes.js";

const PUBLICA = normalizePublicCnpjPayload({
  razao_social: "EMPRESA TESTE LTDA",
  estabelecimento: {
    cnpj: "11444777000161",
    nome_fantasia: "EMPRESA TESTE",
    situacao_cadastral: "Ativa",
    cidade: { nome: "Curitiba" },
    estado: { sigla: "PR" },
    cep: "80010000",
    logradouro: "DAS FLORES",
    numero: "100",
  },
});

describe("compareRegistrySources — provenance determinística", () => {
  it("considera equivalentes valores com caixa/CEP diferentes", () => {
    assert.equal(valuesAreEquivalent("Curitiba", "CURITIBA"), true);
    assert.equal(valuesAreEquivalent("80010-000", "80010000"), true);
    assert.equal(valuesAreEquivalent("EMPRESA A", "EMPRESA B"), false);
  });

  it("escolhe a fonte principal quando ambas respondem", () => {
    const secondary = normalizeBrasilApiCnpjPayload({
      cnpj: "11444777000161",
      razao_social: "OUTRA RAZAO LTDA",
      municipio: "CURITIBA",
      uf: "PR",
      cep: "80010000",
    });
    const rows = buildRegistryProvenance(PUBLICA, secondary);
    const name = rows.find((row) => row.field === "companyName");
    assert.equal(name?.chosenSource, CNPJ_SOURCE_PUBLICA);
    assert.equal(name?.chosenValue, "EMPRESA TESTE LTDA");
    assert.equal(name?.status, "DIFFERENT");
    assert.ok(provenanceConflicts(rows).some((row) => row.field === "companyName"));
  });

  it("não promove campo complementar para o summary da principal", () => {
    const secondary = normalizeBrasilApiCnpjPayload({
      cnpj: "11444777000161",
      razao_social: "EMPRESA TESTE LTDA",
      nome_fantasia: "FANTASIA BRASILAPI",
    });
    const primary = normalizePublicCnpjPayload({
      razao_social: "EMPRESA TESTE LTDA",
      estabelecimento: { cnpj: "11444777000161", nome_fantasia: null, cidade: { nome: "Curitiba" } },
    });
    const rows = buildRegistryProvenance(primary, secondary);
    const trade = rows.find((row) => row.field === "tradeName");
    assert.equal(primary.tradeName, null);
    assert.equal(trade?.chosenSource, CNPJ_SOURCE_BRASIL_API);
    assert.equal(trade?.status, "MISSING_PRIMARY");
  });
});
