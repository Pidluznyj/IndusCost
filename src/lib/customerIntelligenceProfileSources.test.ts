import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractNomusRegistrationDateFromRaw,
  isNomusSyncedCustomer,
  parseNomusExternalPersonId,
  resolveCustomerRegistrationDate,
} from "./customerIntelligenceProfileSources.js";

describe("customerIntelligenceProfileSources", () => {
  it("detecta cliente sincronizado do Nomus via notes", () => {
    assert.equal(parseNomusExternalPersonId("[NOMUS] externalPersonId=12345"), 12345);
    assert.equal(isNomusSyncedCustomer("[NOMUS] externalPersonId=99"), true);
    assert.equal(isNomusSyncedCustomer(null), false);
  });

  it("extrai data de cadastro do raw Nomus quando disponível", () => {
    const date = extractNomusRegistrationDateFromRaw({
      dataCadastro: "2019-03-15",
    });
    assert.ok(date);
    assert.equal(date!.toISOString().slice(0, 10), "2019-03-15");
  });

  it("cadastro Nomus usa data oficial quando existir", () => {
    const resolved = resolveCustomerRegistrationDate({
      nomusRegistrationDate: new Date("2018-05-20T12:00:00.000Z"),
      createdAt: new Date("2024-01-10T00:00:00.000Z"),
      isNomusSynced: true,
    });
    assert.equal(resolved.date, "2018-05-20");
    assert.equal(resolved.source, "nomus");
    assert.equal(resolved.headerLabel, "Cadastro no Nomus");
  });

  it("cliente Nomus sem data oficial retorna Não informado — não usa createdAt", () => {
    const resolved = resolveCustomerRegistrationDate({
      nomusRegistrationDate: null,
      createdAt: new Date("2024-01-10T00:00:00.000Z"),
      isNomusSynced: true,
    });
    assert.equal(resolved.date, null);
    assert.equal(resolved.source, "unavailable");
    assert.equal(resolved.headerLabel, "Cadastro no Nomus");
  });

  it("cliente local usa createdAt rotulado como IndusCost", () => {
    const resolved = resolveCustomerRegistrationDate({
      nomusRegistrationDate: null,
      createdAt: new Date("2024-01-10T00:00:00.000Z"),
      isNomusSynced: false,
    });
    assert.equal(resolved.date, "2024-01-10");
    assert.equal(resolved.source, "induscost");
    assert.equal(resolved.headerLabel, "Importado no IndusCost");
  });
});
