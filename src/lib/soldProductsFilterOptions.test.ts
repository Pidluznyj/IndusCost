import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSoldProductsCustomerSelectOptions,
  buildSoldProductsProductSelectOptions,
  buildSoldProductsTaxIdSelectOptions,
  syncCustomerIdFromTaxId,
  syncCustomerTaxIdFromId,
} from "./soldProductsFilterOptions.js";

describe("soldProductsFilterOptions", () => {
  const customers = [
    { id: "c1", companyName: "Esmaltec S.A.", taxId: "12.345.678/0001-90" },
    { id: "c2", companyName: "Cliente B", taxId: "98.765.432/0001-10" },
  ];

  it("monta opções de cliente com CNPJ no sublabel", () => {
    const options = buildSoldProductsCustomerSelectOptions(customers);
    assert.equal(options[0]?.value, "");
    assert.equal(options[1]?.label, "Esmaltec S.A.");
    assert.match(options[1]?.sublabel ?? "", /12\.345\.678/);
  });

  it("monta opções de CNPJ sem duplicar documento", () => {
    const options = buildSoldProductsTaxIdSelectOptions([
      ...customers,
      { id: "c3", companyName: "Outro", taxId: "12.345.678/0001-90" },
    ]);
    const taxValues = options.filter((o) => o.value).map((o) => o.value);
    assert.equal(taxValues.length, 2);
  });

  it("sincroniza customerId e taxId", () => {
    assert.equal(syncCustomerTaxIdFromId("c1", customers), "12.345.678/0001-90");
    assert.equal(syncCustomerIdFromTaxId("98.765.432/0001-10", customers), "c2");
  });

  it("monta opções de produto com código e nome", () => {
    const options = buildSoldProductsProductSelectOptions([
      { id: "p1", sku: "680.03", name: "Conjunto Pincel" },
    ]);
    assert.match(options[1]?.label ?? "", /680\.03/);
    assert.match(options[1]?.label ?? "", /Conjunto Pincel/);
  });
});
