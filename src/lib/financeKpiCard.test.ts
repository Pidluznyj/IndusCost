import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const kpiCardPath = join(
  process.cwd(),
  "src",
  "components",
  "finance",
  "shared",
  "FinanceKpiCard.tsx"
);
const biKpiCardPath = join(
  process.cwd(),
  "src",
  "components",
  "finance",
  "bi",
  "FinanceBiKpiCard.tsx"
);
const tooltipPath = join(
  process.cwd(),
  "src",
  "components",
  "finance",
  "bi",
  "FinanceBiCalcTooltip.tsx"
);

describe("financeKpiCard", () => {
  it("FinanceKpiCard renderiza label, value e subtitle via FinanceBiKpiCard", () => {
    const src = readFileSync(kpiCardPath, "utf8");
    assert.match(src, /label/);
    assert.match(src, /value/);
    assert.match(src, /subtitle/);
    assert.match(src, /sub={subtitle}/);
    assert.match(src, /hint={helperText}/);
    assert.match(src, /FinanceBiKpiCard/);
  });

  it("FinanceBiKpiCard delega para MetricCard com tooltip de cálculo", () => {
    const bi = readFileSync(biKpiCardPath, "utf8");
    const tooltip = readFileSync(tooltipPath, "utf8");
    assert.match(bi, /MetricCard/);
    assert.match(bi, /FinanceBiCalcTooltip/);
    assert.match(bi, /labelAccessory/);
    assert.match(tooltip, /title={rule}/);
    assert.match(tooltip, /aria-label={rule}/);
    assert.match(tooltip, /type="button"/);
  });

  it("FinanceBiKpiCard expõe title com valor completo", () => {
    const bi = readFileSync(biKpiCardPath, "utf8");
    assert.match(bi, /fullValue/);
    assert.match(bi, /formatKpiDisplayValue/);
  });

  it("FinanceBiKpiCard preserva value formatado quando amount não tem amountFormat", () => {
    const bi = readFileSync(biKpiCardPath, "utf8");
    assert.match(bi, /usesStructuredAmount/);
    assert.match(bi, /formattedValue=\{displayValue\}/);
    assert.doesNotMatch(bi, /metricAmount == null \? displayValue : undefined/);
  });

  it("FinanceKpiCard não importa backend ou Prisma", () => {
    const src = readFileSync(kpiCardPath, "utf8");
    const forbidden = [
      "@prisma/client",
      "src/lib/prisma",
      "@/src/lib/prisma",
      "projectsService",
      "projectsRoutes",
    ];
    for (const pattern of forbidden) {
      assert.equal(src.includes(pattern), false, `import proibido: ${pattern}`);
    }
  });
});
