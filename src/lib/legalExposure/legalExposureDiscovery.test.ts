import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDjenDiscoveryTerms, genericDiscoveryHasAdditionalEvidence } from "./legalExposureDiscovery.js";

describe("buildDjenDiscoveryTerms", () => {
  it("legalName + tradeName + aliases ativos geram termos", () => {
    const terms = buildDjenDiscoveryTerms({
      legalName: "Lazarios Comercio de Plasticos LTDA",
      tradeName: "Lazarios",
      aliases: [
        { type: "OLD_LEGAL_NAME", value: "Lazarios Plasticos", active: true },
        { type: "ABBREVIATION", value: "LZ", active: true },
      ],
    });
    assert.deepEqual(
      terms.map((term) => term.value),
      ["Lazarios Comercio de Plasticos LTDA", "Lazarios", "Lazarios Plasticos", "LZ"]
    );
    assert.deepEqual(
      terms.map((term) => term.trust),
      ["TRUSTED", "TRUSTED", "TRUSTED", "GENERIC"]
    );
  });

  it("termos duplicados normalizados viram uma consulta", () => {
    const terms = buildDjenDiscoveryTerms({
      legalName: "SM Comércio de Plásticos LTDA",
      tradeName: "sm comercio de plasticos ltda",
      aliases: [{ type: "LEGAL_NAME", value: "SM COMERCIO DE PLASTICOS LTDA", active: true }],
    });
    assert.equal(terms.length, 1);
    assert.equal(terms[0]?.value, "SM Comércio de Plásticos LTDA");
  });

  it("alias inativo não consulta", () => {
    const terms = buildDjenDiscoveryTerms({
      legalName: "Koppetel Comercio de Plasticos LTDA",
      aliases: [
        { type: "TRADE_NAME", value: "Koppetel", active: false },
        { type: "OTHER", value: "Koppetel Plasticos", active: true },
      ],
    });
    assert.deepEqual(
      terms.map((term) => term.value),
      ["Koppetel Comercio de Plasticos LTDA", "Koppetel Plasticos"]
    );
  });

  it("ignora vazio e whitespace", () => {
    const terms = buildDjenDiscoveryTerms({
      legalName: "   ",
      tradeName: "",
      aliases: [{ type: "OTHER", value: "   ", active: true }],
    });
    assert.equal(terms.length, 0);
  });
});

describe("genericDiscoveryHasAdditionalEvidence", () => {
  it("CNPJ explícito ou nome compatível confirmam; abreviação sozinha não", () => {
    const base = {
      entityCnpj: "11222333000181",
      entityLegalName: "Sm Comercio de Plasticos LTDA - SM",
      trustedAliasValues: ["SM Comercio de Plasticos"],
    };
    assert.equal(
      genericDiscoveryHasAdditionalEvidence({
        ...base,
        explicitCnpj: "11.222.333/0001-81",
        candidateName: "Outra Empresa",
      }),
      true
    );
    assert.equal(
      genericDiscoveryHasAdditionalEvidence({
        ...base,
        explicitCnpj: null,
        candidateName: "Sm Comercio de Plasticos LTDA - SM",
      }),
      true
    );
    assert.equal(
      genericDiscoveryHasAdditionalEvidence({
        ...base,
        explicitCnpj: null,
        candidateName: "SM",
      }),
      false
    );
  });
});
