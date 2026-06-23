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
    assert.match(read("src/components/finance/FinanceBillingPage.tsx"), /enableDrilldown/);
  });

  it("AP e AR exibem descrição do lançamento no grid de drilldown", () => {
    const source = read("src/components/finance/shared/FinanceAgingBucketDrilldownSection.tsx");
    assert.match(source, /Descrição do lançamento/);
    assert.match(source, /LaunchDescriptionCell/);
    assert.match(source, /resolveFinanceLaunchDescription/);
    assert.match(source, /row\.description/);
    assert.doesNotMatch(source, /costCenterLabel/);
    assert.doesNotMatch(source, /FINANCE_AP_NO_CLASSIFICATION/);
    assert.match(source, /max-w-\[220px\] truncate/);
    assert.match(source, /title=\{resolved/);
  });
});
