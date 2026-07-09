import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  MODAL_Z_INDEX_BASE,
  MODAL_Z_INDEX_STACKED,
  resolveModalStackZIndex,
} from "./modalStack.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("customerCnpjModalStack", () => {
  it("1 — botão Consulta CNPJ abre o painel de inteligência", () => {
    const mod = read("src/components/CustomerModule.tsx");
    assert.match(mod, /Consulta CNPJ/);
    assert.match(mod, /openCnpjLookup/);
    assert.match(mod, /CustomerCnpjIntelligencePanel/);
    assert.match(mod, /intelligenceOpen/);
  });

  it("2 — Consulta CNPJ empilha acima do Editar Cliente com z-index maior", () => {
    const panel = read("src/components/customers/CustomerCnpjIntelligencePanel.tsx");
    const mod = read("src/components/CustomerModule.tsx");
    assert.match(mod, /stacked=\{isModalOpen\}/);
    assert.match(panel, /stacked\?: boolean/);
    assert.match(panel, /resolveModalStackZIndex\(stacked\)/);
    assert.match(panel, /data-modal-stacked/);
    assert.match(mod, /z-50/);
    assert.equal(resolveModalStackZIndex(true), MODAL_Z_INDEX_STACKED);
    assert.equal(resolveModalStackZIndex(false), MODAL_Z_INDEX_BASE);
  });

  it("3 — modal Consulta CNPJ recebe foco ao abrir", () => {
    const panel = read("src/components/customers/CustomerCnpjIntelligencePanel.tsx");
    assert.match(panel, /closeButtonRef/);
    assert.match(panel, /closeButtonRef\.current\?\.focus/);
    assert.match(panel, /returnFocusRef/);
  });

  it("4 — ESC fecha primeiro a Consulta CNPJ (capture)", () => {
    const panel = read("src/components/customers/CustomerCnpjIntelligencePanel.tsx");
    assert.match(panel, /event\.key !== "Escape"/);
    assert.match(panel, /stopPropagation/);
    assert.match(panel, /addEventListener\("keydown", onKeyDown, true\)/);
  });

  it("5 — fechar Consulta CNPJ mantém Editar Cliente aberto", () => {
    const mod = read("src/components/CustomerModule.tsx");
    assert.match(mod, /onClose=\{\(\) => setIntelligenceOpen\(false\)\}/);
    assert.match(mod, /isModalOpen/);
    assert.doesNotMatch(
      mod,
      /onClose=\{\(\) => \{[\s\S]*setIsModalOpen\(false\)[\s\S]*setIntelligenceOpen\(false\)/
    );
  });

  it("6 — botão Visão comercial continua no modal Editar Cliente", () => {
    const mod = read("src/components/CustomerModule.tsx");
    assert.match(mod, /Visão comercial/);
    assert.match(mod, /setCommercial360CustomerId\(editingCustomer\.id\)/);
    assert.match(mod, /CustomerCommercial360/);
  });

  it("7 — Editar Cliente continua salvando normalmente", () => {
    const mod = read("src/components/CustomerModule.tsx");
    assert.match(mod, /handleSubmit/);
    assert.match(mod, /Salvar Alterações/);
    assert.match(mod, /method = editingCustomer \? "PUT" : "POST"/);
  });

  it("8 — Consulta CNPJ standalone permanece com z-index base", () => {
    const panel = read("src/components/customers/CustomerCnpjIntelligencePanel.tsx");
    assert.match(panel, /stacked = false/);
    assert.match(panel, /createPortal\(screenOverlay, document\.body\)/);
    assert.equal(resolveModalStackZIndex(), MODAL_Z_INDEX_BASE);
  });
});
