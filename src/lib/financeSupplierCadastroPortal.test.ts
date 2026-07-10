import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getPortalContainer } from "./getPortalContainer.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("getPortalContainer", () => {
  it("retorna null sem document (SSR)", () => {
    assert.equal(getPortalContainer(), null);
  });
});

describe("finance supplier cadastro portal", () => {
  it("drawer usa usePortalContainer e não chama createPortal com document.body direto", () => {
    const drawer = read("src/components/finance/cost-centers/FinanceSupplierCadastroDrawer.tsx");
    assert.match(drawer, /usePortalContainer/);
    assert.match(drawer, /portalContainer/);
    assert.doesNotMatch(drawer, /createPortal\([\s\S]*document\.body/);
  });

  it("modal de títulos pagos protege createPortal com container válido", () => {
    const modal = read("src/components/finance/cost-centers/FinanceSupplierPaidTitlesModal.tsx");
    assert.match(modal, /usePortalContainer/);
    assert.match(modal, /portalContainer/);
    assert.doesNotMatch(modal, /createPortal\([\s\S]*document\.body/);
  });

  it("aba fornecedores mantém ação Criar cadastro e drawer de cadastro", () => {
    const tab = read("src/components/finance/cost-centers/SuppliersManagementView.tsx");
    assert.match(tab, /finance-suppliers-create-cadastro-button/);
    assert.match(tab, /Criar cadastro/);
    assert.match(tab, /FinanceSupplierCadastroDrawer/);
    assert.match(tab, /setCadastroSupplierId/);
    assert.match(tab, /finance-suppliers-define-rule-button/);
    assert.match(tab, /finance-suppliers-view-aliases-button/);
    assert.match(tab, /sup_q/);
  });

  it("fechar cadastro não limpa filtros de URL", () => {
    const tab = read("src/components/finance/cost-centers/SuppliersManagementView.tsx");
    assert.match(tab, /onClose=\{\(\) => setCadastroSupplierId\(null\)\}/);
    assert.doesNotMatch(tab, /setCadastroSupplierId\(null\)[\s\S]*patchUrl/);
  });
});
