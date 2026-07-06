import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { normalizePublicCnpjPayload } from "./companyCnpjNormalize.js";
import {
  buildSupplierApplyPatch,
  compareSupplierWithCnpjData,
} from "./financeSupplierCnpjCompare.js";
import { assertSuperAdminCanDeleteSupplier, FinanceSupplierProfileError } from "./financeSupplierProfile.js";

const MOCK_PAYLOAD = {
  razao_social: "FORNECEDOR TESTE LTDA",
  capital_social: "100000.00",
  porte: { descricao: "Demais" },
  natureza_juridica: { descricao: "Sociedade Limitada" },
  socios: [],
  estabelecimento: {
    cnpj: "11444777000161",
    nome_fantasia: "FORN TESTE",
    situacao_cadastral: "Ativa",
    data_inicio_atividade: "2010-05-01",
    tipo_logradouro: "RUA",
    logradouro: "DAS FLORES",
    numero: "100",
    bairro: "CENTRO",
    cep: "80010000",
    ddd1: "41",
    telefone1: "33334444",
    email: "fiscal@fornecedor.com",
    atividade_principal: { id: "2511000", descricao: "Fabricação de estruturas metálicas" },
    atividades_secundarias: [],
    cidade: { nome: "Curitiba" },
    estado: { sigla: "PR" },
    inscricoes_estaduais: [{ inscricao_estadual: "1234567890", estado: "PR", situacao: "Ativa" }],
  },
};

describe("financeSupplierCnpjCompare", () => {
  const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);

  it("compara campos cadastrais do fornecedor com dados da Receita", () => {
    const result = compareSupplierWithCnpjData(
      {
        displayName: "Nome Antigo",
        legalName: "NOME DIFERENTE",
        tradeName: null,
        document: "11.444.777/0001-61",
      },
      summary
    );

    const legal = result.fields.find((f) => f.field === "legalName");
    assert.equal(legal?.status, "DIFFERENT");
    assert.equal(legal?.selectable, true);

    const address = result.fields.find((f) => f.field === "address");
    assert.equal(address?.erpValue, null);
    assert.equal(address?.selectable, false);

    assert.ok(result.suggestedUpdates >= 2);
  });

  it("aplica apenas campos selecionados e atualiza displayName", () => {
    const supplier = {
      displayName: "Nome Antigo",
      legalName: "NOME DIFERENTE",
      tradeName: null,
      document: "11444777000161",
    };

    const patch = buildSupplierApplyPatch(supplier, summary, ["legalName", "tradeName"]);
    assert.equal(patch.legalName, summary.companyName);
    assert.equal(patch.tradeName, summary.tradeName);
    assert.equal(patch.displayName, summary.tradeName);
    assert.equal(patch.document, undefined);
  });

  it("permite preencher CNPJ vazio", () => {
    const patch = buildSupplierApplyPatch(
      { displayName: "Fornecedor", legalName: null, tradeName: null, document: null },
      summary,
      ["document", "legalName"]
    );
    assert.equal(patch.document, "11444777000161");
    assert.equal(patch.legalName, summary.companyName);
  });

  it("não sobrescreve CNPJ existente divergente", () => {
    const patch = buildSupplierApplyPatch(
      { displayName: "X", legalName: "X", tradeName: null, document: "11222333000181" },
      summary,
      ["document"]
    );
    assert.equal(Object.keys(patch).length, 0);
  });
});

describe("financeSupplierProfile permissions", () => {
  it("SUPER_ADMIN pode excluir", () => {
    assert.doesNotThrow(() => assertSuperAdminCanDeleteSupplier("SUPER_ADMIN"));
  });

  it("usuário comum não pode excluir", () => {
    assert.throws(
      () => assertSuperAdminCanDeleteSupplier("USER"),
      (e: unknown) => e instanceof FinanceSupplierProfileError && e.code === "FORBIDDEN"
    );
  });
});

describe("financeSuppliersRoutes wiring", () => {
  function read(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
  }

  it("expõe rotas de cadastro, CNPJ e exclusão", () => {
    const routes = read("src/lib/financeSuppliersRoutes.ts");
    assert.match(routes, /\/api\/finance\/suppliers\/:id/);
    assert.match(routes, /company-intelligence/);
    assert.match(routes, /apply-company-intelligence/);
    assert.match(routes, /assertSuperAdminCanDeleteSupplier/);
    assert.match(routes, /app\.delete\("\/api\/finance\/suppliers\/:id"/);
  });
});

describe("finance supplier cadastro UI", () => {
  function read(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
  }

  it("componentes de cadastro e ações existem", () => {
    const drawer = read("src/components/finance/cost-centers/FinanceSupplierCadastroDrawer.tsx");
    const tab = read("src/components/finance/cost-centers/FinanceSuppliersTab.tsx");
    assert.match(drawer, /finance-supplier-cadastro-drawer/);
    assert.match(drawer, /finance-supplier-consult-cnpj-button/);
    assert.match(drawer, /finance-supplier-apply-cnpj-button/);
    assert.match(drawer, /finance-supplier-delete-button/);
    assert.match(tab, /finance-suppliers-open-cadastro-button/);
    assert.match(tab, /finance-suppliers-create-cadastro-button/);
  });
});
