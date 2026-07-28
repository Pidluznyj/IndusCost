import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  filterProductEngineeringListItems,
  hasProductEngineeringListFilters,
  isProductEngineeringCiuComplete,
  isProductEngineeringCiuPartial,
} from "./productEngineeringListFilters.js";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("productEngineeringListFilters", () => {
  const items = [
    {
      id: "1",
      sku: "P-100",
      name: "Produto Alpha",
      status: "ACTIVE",
      costSummary: { totalIndustrialCost: 10, partial: true },
    },
    {
      id: "2",
      sku: "C-200",
      name: "Componente Beta",
      status: "INACTIVE",
      costSummary: { totalIndustrialCost: 20 },
    },
    {
      id: "3",
      sku: "P-300",
      name: "Produto Gama",
      status: "ACTIVE",
      costSummary: { totalIndustrialCost: 30, partial: false },
    },
    {
      id: "4",
      sku: "P-400",
      name: "Produto Delta",
      status: "ACTIVE",
      costSummary: { unavailable: true as const, reason: "x" },
    },
  ];

  it("filtra por SKU ou nome somente quando search aplicado", () => {
    assert.equal(
      filterProductEngineeringListItems(items, { search: "", status: "" }).length,
      4
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
      ["1", "3", "4"]
    );
  });

  it("filtra por CIU parcial / completo", () => {
    assert.equal(isProductEngineeringCiuPartial(items[0]!.costSummary), true);
    assert.equal(isProductEngineeringCiuPartial(items[1]!.costSummary), false);
    assert.equal(isProductEngineeringCiuComplete(items[1]!.costSummary), true);
    assert.equal(isProductEngineeringCiuComplete(items[3]!.costSummary), false);

    assert.deepEqual(
      filterProductEngineeringListItems(items, {
        search: "",
        status: "",
        ciu: "PARTIAL",
      }).map((i) => i.id),
      ["1"]
    );
    assert.deepEqual(
      filterProductEngineeringListItems(items, {
        search: "",
        status: "",
        ciu: "COMPLETE",
      }).map((i) => i.id),
      ["2", "3"]
    );
  });

  it("combina busca, status e CIU parcial", () => {
    assert.deepEqual(
      filterProductEngineeringListItems(items, {
        search: "produto",
        status: "ACTIVE",
        ciu: "PARTIAL",
      }).map((i) => i.id),
      ["1"]
    );
  });

  it("hasProductEngineeringListFilters detecta rascunho ou aplicado", () => {
    assert.equal(
      hasProductEngineeringListFilters({
        draftSearch: "",
        appliedSearch: "",
        draftStatus: "",
        appliedStatus: "",
        draftCiu: "",
        appliedCiu: "",
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
        appliedSearch: "",
        draftStatus: "",
        appliedStatus: "",
        draftCiu: "PARTIAL",
        appliedCiu: "",
      }),
      true
    );
    assert.equal(
      hasProductEngineeringListFilters({
        draftSearch: "",
        appliedSearch: "",
        draftStatus: "",
        appliedStatus: "",
        draftCiu: "",
        appliedCiu: "COMPLETE",
      }),
      true
    );
  });

  it("ProductModule expõe select de CIU parcial na toolbar", () => {
    const mod = read("src/components/ProductModule.tsx");
    assert.match(mod, /data-testid="products-ciu-filter"/);
    assert.match(mod, /value="PARTIAL"/);
    assert.match(mod, /appliedCiuFilter/);
    assert.match(mod, /ciu:\s*appliedCiuFilter/);
  });
});
