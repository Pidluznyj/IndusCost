/**
 * Aba Desempenho: Pedidos IndusCost e Pedidos Nomus lado a lado, com selo de
 * origem, KPIs próprios da origem Nomus e avaliação inline na mesma régua —
 * sem nota consolidada única. Render estático (sem browser, sem fetch).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NomusSupplierEvaluationWorklistRow } from "@/src/lib/purchasing/nomusPurchaseOrderEvaluation";
import {
  SUPPLIER_NOMUS_ORDERS_UNMATCHABLE_LABEL,
  SUPPLIER_ORDERS_NO_CONSOLIDATED_SCORE_NOTE,
  type SupplierNomusOrdersIdentityDto,
} from "@/src/lib/purchasing/supplierNomusOrders";
import {
  EMPTY_NOMUS_ORDER_DRAFT,
  SupplierNomusOrdersIdentityNote,
  SupplierNomusOrdersKpis,
  SupplierNomusOrdersTable,
  SupplierOrderOriginBadge,
  draftFromNomusOrderRow,
  previewNomusOrderDraft,
} from "./SupplierNomusOrdersSection";

const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";
const noop = () => undefined;

function row(partial: Partial<NomusSupplierEvaluationWorklistRow> & { externalId: number }): NomusSupplierEvaluationWorklistRow {
  return {
    nomusPurchaseOrderId: `id-${partial.externalId}`,
    orderNumber: `PC-${partial.externalId}`,
    issuedAt: "2026-03-10T12:00:00.000Z",
    stage: "RECEIVED",
    canceled: false,
    eligible: true,
    eligibilityReason: null,
    evaluationStatus: "PENDING",
    supplier: {
      nomusExternalId: 10,
      nomusName: "Alpha Nomus",
      resolvedName: "Alpha",
      resolvedDocument: "12345678000190",
      financialSupplierId: SUPPLIER_ID,
      matchMethod: "SUPPLIER_ALIAS",
      matchConfidence: "EXACT",
      identitySafe: true,
    },
    evaluation: null,
    suggestions: { quality: 3, delivery: 3, conformity: 3, service: 3 },
    ...partial,
  };
}

const PENDING = row({ externalId: 1 });
const EVALUATED = row({
  externalId: 2,
  evaluationStatus: "EVALUATED",
  supplier: { ...row({ externalId: 2 }).supplier, matchMethod: "SUPPLIER_DOCUMENT" },
  evaluation: {
    id: "ev-2",
    nomusPurchaseOrderId: "id-2",
    financialSupplierId: SUPPLIER_ID,
    supplierMatchMethod: "SUPPLIER_DOCUMENT",
    supplierMatchConfidence: "EXACT",
    supplierIdentitySafe: true,
    scores: { quality: 5, delivery: 4, conformity: 5, service: 3, overall: 4.25 },
    methodologyVersion: 2,
    notes: null,
    revision: 1,
    createdAt: "2026-03-11T12:00:00.000Z",
    createdBy: { id: "u", name: "User" },
    updatedAt: "2026-03-11T12:00:00.000Z",
    updatedBy: { id: "u", name: "User" },
  },
});

function renderTable(rows: NomusSupplierEvaluationWorklistRow[], canEvaluate: boolean, overrides: Partial<React.ComponentProps<typeof SupplierNomusOrdersTable>> = {}) {
  return renderToStaticMarkup(
    <SupplierNomusOrdersTable
      rows={rows}
      drafts={Object.fromEntries(rows.map((r) => [r.nomusPurchaseOrderId, draftFromNomusOrderRow(r)]))}
      reviewing={{}}
      reasons={{}}
      rowErrors={{}}
      savingId={null}
      canEvaluate={canEvaluate}
      onScore={noop}
      onToggleReview={noop}
      onReason={noop}
      onSave={noop}
      {...overrides}
    />
  );
}

const IDENTITY: SupplierNomusOrdersIdentityDto = {
  aliasExternalIds: [10],
  ambiguousExternalIds: [],
  normalizedDocument: "12345678000190",
  documentUnique: true,
  documentOwners: 1,
  matchable: true,
  excludedOnPage: 0,
};

describe("SupplierOrderOriginBadge", () => {
  it("22. distingue as duas origens com rótulo e test id próprios", () => {
    const nomus = renderToStaticMarkup(<SupplierOrderOriginBadge origin="NOMUS" />);
    const internal = renderToStaticMarkup(<SupplierOrderOriginBadge origin="INTERNAL" />);
    assert.match(nomus, /data-testid="supplier-order-origin-nomus"[^>]*>Nomus</);
    assert.match(internal, /data-testid="supplier-order-origin-internal"[^>]*>IndusCost</);
  });
});

describe("SupplierNomusOrdersTable — avaliação inline na mesma régua", () => {
  it("23. cada linha traz selo Nomus, status Nomus, método de identidade e seletores 1–5", () => {
    const html = renderTable([PENDING, EVALUATED], true);
    assert.match(html, /data-testid="supplier-nomus-order-1"/);
    assert.match(html, /data-testid="supplier-nomus-order-2"/);
    assert.equal((html.match(/data-testid="supplier-order-origin-nomus"/g) ?? []).length, 2);
    assert.match(html, /Alias Nomus/);
    assert.match(html, /CNPJ exato/);
    assert.match(html, /Recebido/);
    assert.match(html, /Pendente/);
    assert.match(html, /Finalizada · 4,25 \/ 5/);
    assert.equal((html.match(/data-testid="supplier-evaluation-score-quality"/g) ?? []).length, 2);
    assert.doesNotMatch(html, /Ver\/Revisar/, "botão da origem IndusCost não aparece aqui");
  });

  it("24. pendente pode avaliar; finalizada só depois de Revisar (seletores travados)", () => {
    const html = renderTable([PENDING, EVALUATED], true);
    assert.match(html, /data-testid="supplier-nomus-order-save-1"[^>]*>Avaliar</);
    assert.match(html, /<button type="button" disabled=""[^>]*data-testid="supplier-nomus-order-save-2"/);
    assert.match(html, /data-testid="supplier-nomus-order-review-2"[^>]*>Revisar</);
    assert.doesNotMatch(html, /supplier-nomus-order-review-1/);
    const reviewing = renderTable([EVALUATED], true, { reviewing: { "id-2": true } });
    assert.match(reviewing, /data-testid="supplier-nomus-order-reason-2"/);
    assert.match(reviewing, /data-testid="supplier-nomus-order-review-2"[^>]*>Cancelar revisão</);
    assert.match(reviewing, /data-testid="supplier-nomus-order-save-2"[^>]*>Salvar revisão</);
  });

  it("25. sem permissão de atualizar: nenhuma ação, seletores desabilitados", () => {
    const html = renderTable([PENDING], false);
    assert.doesNotMatch(html, /supplier-nomus-order-save-/);
    assert.doesNotMatch(html, /supplier-nomus-order-review-/);
    assert.match(html, /role="radiogroup"/);
    assert.ok(/aria-disabled="true"|disabled=""/.test(html), "controles 1–5 travados");
  });

  it("26. lista vazia e erro de linha", () => {
    assert.match(renderTable([], true), /Nenhum Pedido Nomus no período com este filtro\./);
    const withError = renderTable([PENDING], true, { rowErrors: { "id-1": "Informe o motivo da revisão." } });
    assert.match(withError, /data-testid="supplier-nomus-order-error-1"[^>]*>Informe o motivo da revisão\.</);
  });

  it("rascunho e prévia usam o motor oficial (5+4+5+3 = 4,25); incompleto → null", () => {
    assert.deepEqual(draftFromNomusOrderRow(PENDING), EMPTY_NOMUS_ORDER_DRAFT);
    assert.deepEqual(draftFromNomusOrderRow(EVALUATED), { quality: 5, delivery: 4, conformity: 5, service: 3 });
    assert.equal(previewNomusOrderDraft(draftFromNomusOrderRow(EVALUATED), 2)?.overallScore, 4.25);
    assert.equal(previewNomusOrderDraft({ ...EMPTY_NOMUS_ORDER_DRAFT, quality: 5 }, 2), null);
    assert.equal(previewNomusOrderDraft(undefined, 2), null);
  });
});

describe("KPIs e identidade da origem Nomus", () => {
  it("27. KPIs próprios da origem Nomus, sem nota consolidada com a origem IndusCost", () => {
    const html = renderToStaticMarkup(
      <SupplierNomusOrdersKpis
        kpis={{ eligibleOrders: 8, evaluatedOrders: 2, pendingOrders: 6, coverage: 0.25, overallScore: 4.1, qualityScore: 4, deliveryScore: 4, conformityScore: 4.5, serviceScore: 3.9 }}
        scaleMax={5}
      />
    );
    assert.match(html, /data-testid="supplier-nomus-orders-eligible"[^>]*>8</);
    assert.match(html, /data-testid="supplier-nomus-orders-evaluated"[^>]*>2</);
    assert.match(html, /data-testid="supplier-nomus-orders-coverage"[^>]*>25,00%</);
    assert.match(html, /data-testid="supplier-nomus-orders-overall"[^>]*>4,10 \/ 5</);
    assert.doesNotMatch(html, /consolidad/i);
  });

  it("28. sem chave segura: aviso explícito; com alias ambíguo ou linhas excluídas: notas de conflito", () => {
    const unmatchable = renderToStaticMarkup(
      <SupplierNomusOrdersIdentityNote identity={{ ...IDENTITY, aliasExternalIds: [], documentUnique: false, documentOwners: 2, matchable: false }} />
    );
    assert.match(unmatchable, /data-testid="supplier-nomus-orders-unmatchable"/);
    assert.ok(unmatchable.includes(SUPPLIER_NOMUS_ORDERS_UNMATCHABLE_LABEL));

    const conflict = renderToStaticMarkup(
      <SupplierNomusOrdersIdentityNote identity={{ ...IDENTITY, ambiguousExternalIds: [77], documentUnique: false, documentOwners: 2, excludedOnPage: 1 }} />
    );
    assert.match(conflict, /Chave de identidade: alias Nomus 10 · CNPJ 12345678000190 ignorado: 2 cadastros/);
    assert.match(conflict, /Nunca por nome\./);
    assert.match(conflict, /data-testid="supplier-nomus-orders-ambiguous"/);
    assert.match(conflict, /data-testid="supplier-nomus-orders-excluded"/);
  });
});

describe("paridade das telas (código-fonte)", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("29. a aba Desempenho mostra as duas origens com selo, monta a seção Nomus e declara que não há nota consolidada", () => {
    const tab = read("src/components/supply-chain/supplier-performance/SupplierPerformanceTab.tsx");
    assert.match(tab, /Pedidos IndusCost/);
    assert.match(tab, /<SupplierOrderOriginBadge origin="INTERNAL" \/>/);
    assert.match(tab, /<SupplierNomusOrdersSection/);
    assert.match(tab, /SUPPLIER_ORDERS_NO_CONSOLIDATED_SCORE_NOTE/);
    assert.match(tab, /<th className="p-3">Origem<\/th>/);
    assert.ok(SUPPLIER_ORDERS_NO_CONSOLIDATED_SCORE_NOTE.includes("não se somam"));
    const section = read("src/components/supply-chain/supplier-performance/SupplierNomusOrdersSection.tsx");
    assert.match(section, /saveNomusPurchaseOrderSupplierEvaluationRequest/, "persistência pelo endpoint Nomus, não pelo interno");
    assert.doesNotMatch(section, /savePurchaseOrderSupplierEvaluationRequest|PurchaseOrderSupplierEvaluationForm/);
    assert.match(section, /fetchSupplierNomusOrders/);
  });

  it("30. drawer preenche CNPJ e cnpjInput do perfil (14 dígitos habilita a consulta); a grade usa o documento do cadastro mestre", () => {
    const drawer = read("src/components/finance/cost-centers/FinanceSupplierCadastroDrawer.tsx");
    assert.match(drawer, /setDocument\(data\.document \?\? ""\)/);
    assert.match(drawer, /setCnpjInput\(data\.document \?\? ""\)/);
    assert.match(drawer, /cnpjInput\.replace\(\/\\D\/g, ""\)\.length !== 14/);
    assert.doesNotMatch(drawer, /useEffect\([^)]*consultarCnpj|autoConsult/i, "sem consulta externa automática");
    const grid = read("src/components/finance/cost-centers/SuppliersManagementView.tsx");
    assert.match(grid, /documentById\.get\(row\.supplierId\)/);
    assert.match(grid, /\?\? row\.document/);
    // As duas telas continuam renderizando a MESMA view e o MESMO drawer.
    const page = read("src/components/finance/FinanceSuppliersPage.tsx");
    const tab = read("src/components/finance/cost-centers/FinanceSuppliersTab.tsx");
    assert.match(page, /<SuppliersManagementView/);
    assert.match(tab, /<SuppliersManagementView/);
  });
});
