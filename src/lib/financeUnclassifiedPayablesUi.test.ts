import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  formatImportApplySuccessMessage,
  IMPORT_APPLY_LOADING_TITLE,
  importApplyButtonDisabled,
} from "./financeUnclassifiedPayablesUi.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("financeUnclassifiedPayablesUi", () => {
  it("formatImportApplySuccessMessage resume fornecedores, regras e títulos", () => {
    const msg = formatImportApplySuccessMessage({
      suppliersCreated: 2,
      suppliersLinked: 1,
      rulesCreated: 3,
      titlesAllocated: 10,
      titlesIgnoredManualLocked: 1,
      skippedSensitiveUnconfirmed: 0,
    });
    assert.match(msg, /Importação aplicada com sucesso/);
    assert.match(msg, /2 fornecedor\(es\) criado\(s\)/);
    assert.match(msg, /1 fornecedor\(es\) vinculado\(s\)/);
    assert.match(msg, /3 regra\(s\) criada\(s\)/);
    assert.match(msg, /10 título\(s\) classificado\(s\)/);
    assert.match(msg, /manual preservados/);
  });

  it("importApplyButtonDisabled bloqueia durante apply e sensíveis sem confirmação", () => {
    assert.equal(
      importApplyButtonDisabled({
        applying: true,
        loadingPreview: false,
        sensitiveCount: 1,
        confirmSensitive: false,
        canApply: true,
      }),
      true
    );
    assert.equal(
      importApplyButtonDisabled({
        applying: false,
        loadingPreview: false,
        sensitiveCount: 2,
        confirmSensitive: false,
        canApply: true,
      }),
      true
    );
    assert.equal(
      importApplyButtonDisabled({
        applying: false,
        loadingPreview: false,
        sensitiveCount: 2,
        confirmSensitive: true,
        canApply: true,
      }),
      false
    );
  });
});

describe("FinanceUnclassifiedPayablesTab — UX modais", () => {
  const tab = () => read("src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx");
  const modalUi = () => read("src/components/finance/cost-centers/financeUnclassifiedModalUi.tsx");

  it("importação mostra overlay de loading com título e stats", () => {
    assert.match(tab(), /finance-unclassified-import-loading/);
    assert.match(tab(), /IMPORT_APPLY_LOADING_TITLE/);
    assert.match(tab(), /IMPORT_APPLY_LOADING_MESSAGE/);
    assert.match(tab(), /importApplyLoadingStats/);
    assert.equal(IMPORT_APPLY_LOADING_TITLE, "Aplicando classificação…");
  });

  it("importação desabilita botões durante apply e mostra sucesso antes de fechar", () => {
    assert.match(tab(), /importApplyDisabled/);
    assert.match(tab(), /disabled=\{importApplying\}/);
    assert.match(tab(), /ModalSuccessBlock/);
    assert.match(tab(), /importApplyResult/);
    assert.match(tab(), /finishImportSuccess/);
    assert.match(modalUi(), /finance-unclassified-modal-success/);
    assert.doesNotMatch(tab(), /closeImportModal\(\);\s*await load/);
  });

  it("erro de importação mostra bloco amigável com detalhes recolhíveis", () => {
    assert.match(tab(), /Corrija a planilha e gere novo preview antes de aplicar/);
    assert.match(modalUi(), /Detalhes técnicos/);
    assert.match(modalUi(), /finance-unclassified-import-confirm-sensitive/);
    assert.match(tab(), /importErrorDetails/);
  });

  it("classificação manual mostra overlay de loading ao confirmar", () => {
    assert.match(tab(), /finance-unclassified-classify-loading/);
    assert.match(tab(), /CLASSIFY_APPLY_LOADING_TITLE/);
    assert.match(tab(), /modalSaving \? "Classificando…"/);
    assert.match(tab(), /disabled=\{!modalCanConfirm\}/);
    assert.match(tab(), /modalSaving && !force\) return/);
  });

  it("chips de causa mantêm labels principais", () => {
    const ui = read("src/lib/financeUnclassifiedPayablesUi.ts");
    assert.match(tab(), /UNCLASSIFIED_CAUSE_LABEL/);
    assert.match(ui, /Fornecedor não casado/);
    assert.match(tab(), /Classificar fornecedor/);
  });

  it("frontend não importa prisma/xlsx", () => {
    for (const file of [
      "src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx",
      "src/components/finance/cost-centers/financeUnclassifiedModalUi.tsx",
      "src/lib/financeUnclassifiedPayablesUi.ts",
    ]) {
      const src = read(file);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /from ["'].*xlsx/i);
      assert.doesNotMatch(src, /financeUnclassifiedImport"/);
    }
  });
});
