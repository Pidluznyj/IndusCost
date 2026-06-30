import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  apGroupMatchesSearchTerm,
  resolveApIdentityKeyFromPerson,
} from "./financeSupplierEngine.js";
import { extractSupplierFromAccountsPayable, groupAccountsPayableSuppliers } from "./financeSupplierIdentity.js";
import { serializeFinancialSupplierSearchRow } from "./financeSupplierCostCenterRules.js";

describe("financeSupplierEngine", () => {
  it("apGroupMatchesSearchTerm encontra SGF por parte do nome", () => {
    const groups = groupAccountsPayableSuppliers([
      {
        externalId: 1001,
        personName: "SGF SERVIÇOS DE CAPATAZIA LTDA",
        personCnpj: null,
      },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(apGroupMatchesSearchTerm(groups[0]!, "sgf"), true);
    assert.equal(apGroupMatchesSearchTerm(groups[0]!, "capatazia"), true);
  });

  it("apGroupMatchesSearchTerm encontra fornecedor sem CNPJ por nome", () => {
    const groups = groupAccountsPayableSuppliers([
      {
        externalId: 2002,
        personName: "JOAO DA SILVA",
        personCnpj: null,
      },
    ]);
    assert.equal(apGroupMatchesSearchTerm(groups[0]!, "joao"), true);
  });

  it("apGroupMatchesSearchTerm encontra por documento parcial", () => {
    const groups = groupAccountsPayableSuppliers([
      {
        externalId: 3003,
        personName: "EMPRESA TESTE",
        personCnpj: "11.444.777/0001-61",
      },
    ]);
    assert.equal(apGroupMatchesSearchTerm(groups[0]!, "11444777"), true);
  });

  it("resolveApIdentityKeyFromPerson gera chave estável por nome", () => {
    const key = resolveApIdentityKeyFromPerson("SGF SERVIÇOS DE CAPATAZIA LTDA");
    assert.ok(key?.startsWith("name:"));
  });

  it("serializeFinancialSupplierSearchRow inclui metadados do motor oficial", () => {
    const row = serializeFinancialSupplierSearchRow({
      id: "uuid-1",
      displayName: "Fornecedor A",
      document: null,
      normalizedDocument: null,
      status: "ACTIVE",
      titlesCount: 3,
      totalAmountSeen: 100,
      lastSeenAt: new Date("2026-06-01T00:00:00.000Z"),
      aliases: [{ externalSupplierId: 42 }],
    });
    assert.equal(row.id, "uuid-1");
    assert.equal(row.matched, true);
    assert.equal(row.source, "MASTER");
    assert.equal(row.externalCode, "42");
  });

  it("extractSupplierFromAccountsPayable aceita pessoa física sem documento", () => {
    const extracted = extractSupplierFromAccountsPayable({
      externalId: 99,
      personName: "PAGAMENTO RESCISAO MARIA",
      personCnpj: null,
    });
    assert.equal(extracted.normalizedDocument, null);
    assert.ok(extracted.normalizedName);
  });
});

describe("FinanceGeneralClassificationRulesPanel contract", () => {
  it("tipo SUPPLIER exige supplierId no payload de regra", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../components/finance/cost-centers/FinanceGeneralClassificationRulesPanel.tsx", import.meta.url),
        "utf8"
      )
    );
    assert.match(source, /ruleType === "SUPPLIER"/);
    assert.match(source, /FinanceSupplierAutocomplete/);
    assert.match(source, /ensureFinanceSupplierSearchResult/);
  });
});

describe("FinanceUnclassifiedPayablesTab classify modal", () => {
  it("expõe fluxo de usar origem AP", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("../components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx", import.meta.url),
        "utf8"
      )
    );
    assert.match(source, /finance-unclassified-use-ap-origin/);
    assert.match(source, /ensure-from-ap-identity/);
  });
});
