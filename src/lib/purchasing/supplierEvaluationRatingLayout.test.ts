import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  SUPPLIER_EVALUATION_CRITERIA,
  SUPPLIER_EVALUATION_RATING_VALUES,
} from "./supplierPerformance.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const RATING = read(
  "src/components/supply-chain/supplier-performance/SupplierEvaluationRatingScale.tsx"
);
const PAGE = read(
  "src/components/supply-chain/supplier-performance/NomusSupplierEvaluationWorklistPage.tsx"
);

describe("supplier evaluation rating layout", () => {
  it("cada critério expõe exatamente as opções 1 a 5", () => {
    assert.deepEqual([...SUPPLIER_EVALUATION_RATING_VALUES], [1, 2, 3, 4, 5]);
    assert.match(RATING, /SUPPLIER_EVALUATION_RATING_VALUES\.map\(\(rating\)/);
    assert.equal(SUPPLIER_EVALUATION_CRITERIA.length, 4);
  });

  it("o grupo 1–5 não permite wrap", () => {
    assert.match(RATING, /SUPPLIER_EVALUATION_RATING_GROUP_CLASS/);
    assert.match(RATING, /inline-flex w-max flex-nowrap whitespace-nowrap/);
    const radioGroup = RATING.split('role="radiogroup"')[1]?.slice(0, 400) ?? "";
    assert.match(radioGroup, /SUPPLIER_EVALUATION_RATING_GROUP_CLASS/);
    assert.doesNotMatch(radioGroup, /flex-wrap/);
    assert.match(RATING, /h-8 w-8 shrink-0 grow-0 basis-8/);
  });

  it("modo compacto não repete o rótulo visual do critério na célula", () => {
    const selector = RATING.split("export function SupplierEvaluationRatingSelector")[1] ?? "";
    assert.match(selector, /compact \? \(/);
    assert.match(selector, /sr-only/);
    assert.match(PAGE, /criterionLabel=\{c\.shortLabel\}/);
    assert.match(PAGE, /compact/);
    const compactBranch = selector.split("compact ? (")[1]?.split(") : (")[0] ?? "";
    assert.match(compactBranch, /sr-only/);
    assert.doesNotMatch(compactBranch, /font-semibold text-muted-foreground/);
  });

  it("seleção continua no handler onChange existente", () => {
    assert.match(RATING, /onClick=\{\(\) => onChange\(rating\)\}/);
    assert.match(PAGE, /onChange=\{\(value\) => setScore\(id, c\.key, value\)\}/);
  });

  it("estado selecionado continua refletindo o valor do pedido", () => {
    assert.match(RATING, /const selected = value === rating;/);
    assert.match(RATING, /aria-checked=\{selected\}/);
    assert.match(PAGE, /value=\{draft\[c\.key\]\}/);
  });

  it("estado disabled/finalizado continua correto", () => {
    assert.match(RATING, /disabled=\{disabled\}/);
    assert.match(PAGE, /disabled=\{locked\}/);
    assert.match(
      PAGE,
      /const locked = !row\.eligible \|\| \(row\.evaluation != null && !reviewing\[id\]\) \|\| !canUpdate;/
    );
  });

  it("a tabela preserva geometria; a barra horizontal só existe se transbordar, também no topo", () => {
    const SCROLL = read(
      "src/components/supply-chain/supplier-performance/SupplierEvaluationWorklistTableScroll.tsx"
    );
    assert.match(PAGE, /SupplierEvaluationWorklistTableScroll/);
    assert.match(SCROLL, /nse-grid-top-scroll/);
    assert.match(SCROLL, /overflows \? \(/);
    assert.match(SCROLL, /el\.scrollWidth > el\.clientWidth \+ 1/);
    assert.match(SCROLL, /min-w-full/);
    assert.doesNotMatch(SCROLL, /min-w-max/);
    assert.match(PAGE, /min-w-\[11rem\]/);
    assert.match(PAGE, /sticky left-0/);
    assert.match(PAGE, /sticky left-10/);
    assert.match(PAGE, /sticky left-\[10rem\]/);
    assert.match(PAGE, /truncate/);
  });

  it("o cabeçalho tem checkbox de selecionar todos os elegíveis da página", () => {
    assert.match(PAGE, /data-testid="nse-select-all"/);
    assert.match(PAGE, /applySelectAllEligible/);
    assert.match(PAGE, /eligibleWorklistRowIds/);
    assert.match(PAGE, /selectAllRef\.current\.indeterminate/);
  });
});
