import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ORDER_FULL_AUDIT_PROPOSAL_PRODUCT_SELECT,
  readOrderFullAuditProposalProductSku,
} from "./orderFullAuditService.js";

const SERVICE_SRC = readFileSync(
  join(process.cwd(), "src/lib/finance/orderFullAuditService.ts"),
  "utf8"
);

describe("orderFullAudit — Proposal block Product.sku", () => {
  it("select Prisma usa Product.sku (não skuCode)", () => {
    assert.deepEqual(ORDER_FULL_AUDIT_PROPOSAL_PRODUCT_SELECT, {
      sku: true,
      name: true,
    });
    assert.equal("skuCode" in ORDER_FULL_AUDIT_PROPOSAL_PRODUCT_SELECT, false);
    assert.doesNotMatch(
      SERVICE_SRC,
      /loadProposalBlock[\s\S]*?select:\s*\{\s*skuCode\s*:\s*true/s
    );
    assert.match(
      SERVICE_SRC,
      /ORDER_FULL_AUDIT_PROPOSAL_PRODUCT_SELECT/
    );
  });

  it("readOrderFullAuditProposalProductSku preenche productSku a partir de Product.sku", () => {
    assert.equal(
      readOrderFullAuditProposalProductSku({ sku: "309.86AA" }),
      "309.86AA"
    );
  });

  it("Product nulo retorna productSku null", () => {
    assert.equal(readOrderFullAuditProposalProductSku(null), null);
    assert.equal(readOrderFullAuditProposalProductSku(undefined), null);
  });

  it("loadProposalBlock não referencia Product.skuCode na leitura", () => {
    assert.doesNotMatch(SERVICE_SRC, /Product\?\.skuCode/);
    assert.match(
      SERVICE_SRC,
      /readOrderFullAuditProposalProductSku\(pi\.Product\)/
    );
  });
});
