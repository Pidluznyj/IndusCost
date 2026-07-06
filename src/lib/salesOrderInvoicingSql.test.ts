import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("salesOrderInvoicingSql", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/salesOrderInvoicingSql.ts"), "utf8");

  it("nomusNfesJsonbArraySql trata array no topo e nfes aninhado (regra CRM)", () => {
    assert.match(src, /jsonb_typeof\(\$\{raw\}\) = 'array'/);
    assert.match(src, /\$\{raw\} -> 'nfes'/);
    assert.match(src, /THEN \$\{raw\}/);
  });

  it("nomusNfesJsonbArraySql trata NFe única como objeto", () => {
    assert.match(src, /jsonb_typeof\(\$\{raw\} -> 'nfes'\) = 'object'/);
    assert.match(src, /jsonb_build_array/);
  });

  it("nomusNfesJsonbArraySql retorna array vazio quando nomusRawResponse é null", () => {
    assert.match(src, /WHEN \$\{raw\} IS NULL THEN '\[\]'::jsonb/);
  });

  it("orderIsInvoicedSql usa dataProcessamento preenchida", () => {
    assert.match(src, /dataProcessamento/);
    assert.match(src, /orderIsInvoicedSql/);
    assert.match(src, /orderNotInvoicedSql/);
  });
});
