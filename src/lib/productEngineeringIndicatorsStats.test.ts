import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Product } from "@/src/types/product";
import { productEngineeringRollup } from "./productEngineeringIndicatorsStats";

describe("productEngineeringIndicatorsStats", () => {
  it("resume tipos e BOM", () => {
    const products = [
      {
        id: "1",
        type: "PRODUCT",
        ProductBOM: [{ quantity: 1 } as any],
        ProductRouting: [{ sequence: 1 } as any],
      },
      {
        id: "2",
        type: "COMPONENT",
        ProductBOM: [],
        ProductRouting: [],
      },
    ] as Product[];
    const r = productEngineeringRollup(products);
    assert.equal(r.total, 2);
    assert.equal(r.byType.PRODUCT, 1);
    assert.equal(r.bomLines, 1);
    assert.equal(r.manufacturedWithoutBom, 1);
  });
});
