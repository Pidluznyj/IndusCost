import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("FinanceAgingBucketDrilldownSection — UI", () => {
  it("renderiza grid ao selecionar card e permite limpar seleção", () => {
    const source = read("src/components/finance/shared/FinanceAgingBucketDrilldownSection.tsx");
    assert.match(source, /aria-pressed/);
    assert.match(source, /Títulos da faixa:/);
    assert.match(source, /Limpar seleção/);
    assert.match(source, /setSelectedKey\(\(current\) => \(current === key \? null : key\)\)/);
    assert.match(source, /agingBucket: selectedKey/);
    assert.match(source, /bucketTotals/);
  });

  it("páginas AR e AP integram drilldown de aging", () => {
    assert.match(read("src/components/finance/FinanceAccountsReceivablePage.tsx"), /FinanceAgingBucketDrilldownSection/);
    assert.match(read("src/components/finance/FinanceAccountsPayablePage.tsx"), /FinanceAgingBucketDrilldownSection/);
    assert.match(read("src/components/finance/FinanceArOpenHorizonSection.tsx"), /horizonMode/);
    assert.match(read("src/components/finance/shared/FinanceHorizonSection.tsx"), /enableDrilldown/);
  });

  it("AP inclui centro de custo no grid", () => {
    const source = read("src/components/finance/shared/FinanceAgingBucketDrilldownSection.tsx");
    assert.match(source, /Centro de custo/);
    assert.match(source, /costCenterLabel/);
    assert.match(source, /FINANCE_AP_NO_CLASSIFICATION/);
  });
});
