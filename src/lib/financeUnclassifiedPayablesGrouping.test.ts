import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupUnclassifiedPayablesBySupplier,
  resolveUnclassifiedPayableGroupKey,
} from "./financeUnclassifiedPayablesGrouping.js";

describe("financeUnclassifiedPayablesGrouping", () => {
  it("agrupa variantes de nome pela mesma identidade AP", () => {
    const grouped = groupUnclassifiedPayablesBySupplier([
      {
        externalId: 1,
        titleAmount: 100,
        companyName: null,
        personName: "JOAO DA SILVA",
        personDocument: null,
        identityKey: "name:joao da silva",
        cause: "NO_SUPPLIER",
      },
      {
        externalId: 2,
        titleAmount: 50,
        companyName: null,
        personName: "João da Silva",
        personDocument: null,
        identityKey: "name:joao da silva",
        cause: "NO_SUPPLIER",
      },
    ]);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0]?.titlesCount, 2);
    assert.equal(grouped[0]?.amount, 150);
    assert.equal(grouped[0]?.identityKey, "name:joao da silva");
    assert.equal(grouped[0]?.groupKey, "name:joao da silva");
  });

  it("não agrupa nomes parecidos sem identidade compartilhada", () => {
    const grouped = groupUnclassifiedPayablesBySupplier([
      {
        externalId: 10,
        titleAmount: 30,
        companyName: null,
        personName: "ALEF COMERCIO",
        personDocument: null,
        identityKey: "name:alef comercio",
      },
      {
        externalId: 11,
        titleAmount: 20,
        companyName: null,
        personName: "ALEF SERVICOS",
        personDocument: null,
        identityKey: "name:alef servicos",
      },
    ]);
    assert.equal(grouped.length, 2);
  });

  it("resolveUnclassifiedPayableGroupKey usa supplierId quando casado", () => {
    const key = resolveUnclassifiedPayableGroupKey({
      externalId: 99,
      titleAmount: 1,
      companyName: null,
      personName: "X",
      supplierId: "uuid-abc",
    });
    assert.equal(key, "fs:uuid-abc");
  });

  it("groupKey do agrupamento usa fs: quando há supplierId", () => {
    const grouped = groupUnclassifiedPayablesBySupplier([
      {
        externalId: 1,
        titleAmount: 100,
        companyName: null,
        personName: "CONTA ADMINISTRATIVA",
        identityKey: "name:conta administrativa",
        supplierId: "uuid-admin",
        cause: "NO_SUPPLIER",
      },
    ]);
    assert.equal(grouped[0]?.groupKey, "fs:uuid-admin");
    assert.equal(grouped[0]?.identityKey, "name:conta administrativa");
  });
});
