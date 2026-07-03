import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCustomerExclusionCreateBody,
  CUSTOMER_EXCLUSION_ALERT_MESSAGE,
  emptyCustomerExclusionForm,
  validateCustomerExclusionForm,
} from "../components/commissions/customerExclusions/commissionsCustomerExclusionLabels.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("commissionsCustomerExclusionsUi", () => {
  it("renderiza tela com data-testid e seções principais", () => {
    const page = read("src/components/commissions/pages/CommissionsCustomerExclusionsPage.tsx");
    assert.match(page, /data-testid="commissions-customer-exclusions-page"/);
    assert.match(page, /Exceções por cliente/);
    assert.match(page, /Nova exclusão de cliente/);
    assert.match(page, /useCommissionsCustomerExclusionsData/);
    const hook = read(
      "src/components/commissions/customerExclusions/useCommissionsCustomerExclusionsData.ts"
    );
    assert.match(hook, /\/api\/commissions\/customer-exclusions/);
  });

  it("usa CustomerAutocompleteFilter no modal", () => {
    const modal = read(
      "src/components/commissions/customerExclusions/CommissionsCustomerExclusionFormModal.tsx"
    );
    assert.match(modal, /CustomerAutocompleteFilter/);
    assert.match(modal, /CUSTOMER_EXCLUSION_ALERT_MESSAGE/);
    assert.match(modal, /data-testid="commissions-customer-exclusion-modal"/);
  });

  it("CommissionsModule registra rota exclusoes-cliente", () => {
    const moduleSrc = read("src/components/CommissionsModule.tsx");
    assert.match(moduleSrc, /CommissionsCustomerExclusionsPage/);
    assert.match(moduleSrc, /exclusoes-cliente/);
    assert.match(moduleSrc, /customerExclusions/);
  });

  it("navegação expõe aba Exceções por cliente", () => {
    const nav = read("src/lib/commissionsNavigation.ts");
    assert.match(nav, /customerExclusions/);
    assert.match(nav, /exclusoes-cliente/);
    assert.match(nav, /Exceções por cliente/);
  });

  it("cliente obrigatório na validação do formulário", () => {
    const form = emptyCustomerExclusionForm();
    assert.equal(validateCustomerExclusionForm(form), "Selecione um cliente cadastrado.");
  });

  it("motivo obrigatório", () => {
    const form = {
      ...emptyCustomerExclusionForm(),
      customerSelection: {
        id: "cust-1",
        name: "ESMALTEC",
        source: "induscost" as const,
      },
      reason: "",
    };
    assert.equal(validateCustomerExclusionForm(form), "Informe o motivo da exclusão.");
  });

  it("vigência inicial obrigatória", () => {
    const form = {
      ...emptyCustomerExclusionForm(),
      customerSelection: {
        id: "cust-1",
        name: "ESMALTEC",
        source: "induscost" as const,
      },
      reason: "Política comercial",
      effectiveFrom: "",
    };
    assert.equal(validateCustomerExclusionForm(form), "Informe a vigência inicial.");
  });

  it("cria payload para API com cliente selecionado", () => {
    const body = buildCustomerExclusionCreateBody({
      customerSelection: {
        id: "cust-1",
        name: "ESMALTEC S/A",
        taxId: "12345678000199",
        code: "12345",
        source: "induscost",
      },
      effectiveFrom: "2026-07-01",
      effectiveTo: "",
      reason: "Cliente excluído de comissionamento",
      notes: "",
    });
    assert.equal(body.customerId, "cust-1");
    assert.equal(body.customerExternalId, 12345);
    assert.equal(body.customerNameSnapshot, "ESMALTEC S/A");
    assert.equal(body.reason, "Cliente excluído de comissionamento");
  });

  it("não permite salvar sem cliente — body exige id", () => {
    const form = emptyCustomerExclusionForm();
    assert.notEqual(validateCustomerExclusionForm(form), null);
  });

  it("exibe mensagem de alerta sobre impacto da regra", () => {
    assert.match(CUSTOMER_EXCLUSION_ALERT_MESSAGE, /Não altera pedidos, NFs ou Contas a Receber/);
  });

  it("página trata conflito de vigência (HTTP 409)", () => {
    const page = read("src/components/commissions/pages/CommissionsCustomerExclusionsPage.tsx");
    assert.match(page, /status === 409/);
    assert.match(page, /inactivateCustomerExclusionApi/);
  });

  it("inativa regra via endpoint dedicado", () => {
    const hook = read(
      "src/components/commissions/customerExclusions/useCommissionsCustomerExclusionsData.ts"
    );
    assert.match(hook, /\/inactivate/);
    assert.match(hook, /method: "POST"/);
  });
});
