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

  it("FinanceKpiCard repassa helperText negocial ao tooltip do ícone de informação", () => {
    const bi = readFileSync(biKpiCardPath, "utf8");
    const tooltip = readFileSync(tooltipPath, "utf8");
    assert.match(bi, /FinanceBiCalcTooltip/);
    assert.match(bi, /hint \? <FinanceBiCalcTooltip rule={hint} \/>/);
    assert.match(tooltip, /title={rule}/);
    assert.match(tooltip, /aria-label={rule}/);
    assert.match(tooltip, /type="button"/);
  });

  it("FinanceKpiCard e FinanceBiKpiCard evitam quebra de valor monetário", () => {
    const bi = readFileSync(biKpiCardPath, "utf8");
    const kpi = readFileSync(kpiCardPath, "utf8");
    assert.match(bi, /indus-kpi-value/);
    assert.match(bi, /title=\{displayTitle\}/);
    assert.match(bi, /tabular-nums/);
    assert.match(kpi, /text-xl font-semibold sm:text-2xl/);
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
