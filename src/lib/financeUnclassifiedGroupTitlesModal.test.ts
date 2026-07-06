import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("FinanceUnclassifiedGroupTitlesModal", () => {
  it("modal lista títulos do grupo com coluna descritiva", () => {
    const modal = read("src/components/finance/cost-centers/FinanceUnclassifiedGroupTitlesModal.tsx");
    assert.match(modal, /finance-unclassified-group-titles-modal/);
    assert.match(modal, /Títulos sem classificação —/);
    assert.match(modal, /unclassified-groups/);
    assert.match(modal, /groupKey/);
    assert.match(modal, /Descrição \/ comentário \/ histórico/);
    assert.match(modal, /rawDescriptionSource/);
    assert.match(modal, /Nenhum título encontrado para este grupo no filtro atual/);
  });

  it("modal é somente leitura", () => {
    const modal = read("src/components/finance/cost-centers/FinanceUnclassifiedGroupTitlesModal.tsx");
    assert.doesNotMatch(modal, /cost-center-reclassification/);
    assert.doesNotMatch(modal, /classify-batch-apply/);
    assert.match(modal, /UNCLASSIFIED_GROUP_TITLES_SCOPE_NOTE/);
  });
});

describe("FinanceUnclassifiedPayablesTab — Ver títulos", () => {
  it("ação Ver títulos aparece na linha do agrupamento", () => {
    const tab = read("src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx");
    assert.match(tab, /data-testid="finance-unclassified-view-titles-button"/);
    assert.match(tab, /Ver títulos/);
    assert.match(tab, /FinanceUnclassifiedGroupTitlesModal/);
    assert.match(tab, /setViewTitlesGroup\(row\)/);
    assert.match(tab, /row\.groupKey/);
  });
});
