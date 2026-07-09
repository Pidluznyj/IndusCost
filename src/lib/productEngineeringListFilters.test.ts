import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterProductEngineeringListItems,
  hasProductEngineeringListFilters,
} from "./productEngineeringListFilters.js";

describe("productEngineeringListFilters", () => {
  const items = [
    { id: "1", sku: "P-100", name: "Produto Alpha", status: "ACTIVE" },
    { id: "2", sku: "C-200", name: "Componente Beta", status: "INACTIVE" },
    { id: "3", sku: "P-300", name: "Produto Gama", status: "ACTIVE" },
  ];

  it("filtra por SKU ou nome somente quando search aplicado", () => {
    assert.equal(
      filterProductEngineeringListItems(items, { search: "", status: "" }).length,
      3
    );
    assert.deepEqual(
      filterProductEngineeringListItems(items, { search: "p-100", status: "" }).map((i) => i.id),
      ["1"]
    );
    assert.deepEqual(
      filterProductEngineeringListItems(items, { search: "beta", status: "" }).map((i) => i.id),
      ["2"]
    );
  });

  it("filtra por status aplicado", () => {
    assert.deepEqual(
      filterProductEngineeringListItems(items, { search: "", status: "ACTIVE" }).map((i) => i.id),
      ["1", "3"]
    );
  });

  it("combina busca e status", () => {
    assert.deepEqual(
      filterProductEngineeringListItems(items, { search: "produto", status: "ACTIVE" }).map(
        (i) => i.id
      ),
      ["1", "3"]
    );
  });

  it("hasProductEngineeringListFilters detecta rascunho ou aplicado", () => {
    assert.equal(
      hasProductEngineeringListFilters({
        draftSearch: "",
        appliedSearch: "",
        draftStatus: "",
        appliedStatus: "",
      }),
      false
    );
    assert.equal(
      hasProductEngineeringListFilters({
        draftSearch: "abc",
        appliedSearch: "",
        draftStatus: "",
        appliedStatus: "",
      }),
      true
    );
    assert.equal(
      hasProductEngineeringListFilters({
        draftSearch: "",
        appliedSearch: "xyz",
        draftStatus: "",
        appliedStatus: "",
      }),
      true
    );
  });
});
