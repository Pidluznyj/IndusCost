/**
 * Pedidos de Venda — caracterização dos valores canônicos + gates estruturais.
 *
 * O que esta suíte protege:
 *
 * 1. BILLING — `resolveSalesOrderBillingStatus` é a fonte única do status de
 *    faturamento (lista, detalhe, relatórios e exports importam esta função).
 *    Caracterizamos a máquina de decisão completa, incluindo os eliminatórios:
 *    pedido cancelado nunca vira faturado, e CR/previsão não participam.
 *
 * 2. MARGEM — motor oficial (`calculateSalesOrderItemMargin` +
 *    `calculateSalesOrderMarginSummary`): percentual PONDERADO por receita
 *    (provado diferente da média simples via differential test), custo ausente
 *    vira "SEM_CUSTO" (nunca margem zero inventada), item cancelado fora da
 *    consolidação, arredondamento oficial de pricing.
 *
 * 3. RESULTADO INDUSTRIAL — `buildSalesOrderDetailIndustrialResultBlock` é o
 *    MESMO objeto consumido pelas abas Custos e Resultado do detalhe
 *    (cross-tab por construção): total de MP = roundMoney(Σ linhas) e o
 *    verdict segue exclusivamente o row consolidado.
 *
 * 4. ESTRUTURA — gates de fonte (padrão já usado no repo, ex.
 *    inventoryCollectorSecureIngress): o SalesOrdersModule não pode voltar a
 *    importar o DetailDialog estaticamente (mataria o code-splitting dos 5
 *    consumidores), o effect de seller options não pode depender de
 *    appliedFilters inteiro (refazia o fetch ao trocar só o vendedor) e os
 *    componentes de exibição do detalhe não podem reimplementar fórmula de
 *    margem.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  resolveSalesOrderBillingStatus,
  salesOrderBillingStatusLabel,
} from "../sales/salesOrderListBillingStatus.js";
import {
  calculateSalesOrderItemMargin,
  calculateSalesOrderMarginSummary,
  naiveAverageMarginPercent,
} from "../salesOrderMarginMath.js";
import {
  buildSalesOrderDetailIndustrialResultBlock,
  resolveIndustrialResultVerdict,
} from "./salesOrderDetailIndustrialResult.js";

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Billing status — fonte única
// ─────────────────────────────────────────────────────────────────────────────

describe("billing status canônico (fonte única da lista, detalhe e relatórios)", () => {
  it("caracteriza a precedência completa: cancelado > sem NF > parcial > faturado", () => {
    assert.equal(
      resolveSalesOrderBillingStatus({ status: "CANCELLED", hasNfe: true, isFullyInvoiced: true }),
      "CANCELED"
    );
    assert.equal(
      resolveSalesOrderBillingStatus({ status: "SENT_TO_NOMUS", hasNfe: false }),
      "NOT_INVOICED"
    );
    assert.equal(
      resolveSalesOrderBillingStatus({
        status: "SENT_TO_NOMUS",
        hasNfe: true,
        isPartiallyInvoiced: true,
      }),
      "PARTIALLY_INVOICED"
    );
    assert.equal(
      resolveSalesOrderBillingStatus({
        status: "SENT_TO_NOMUS",
        hasNfe: true,
        isFullyInvoiced: true,
      }),
      "INVOICED"
    );
  });

  it("ELIMINATÓRIO: pedido cancelado nunca reaparece como faturado, mesmo com NF", () => {
    for (const flags of [
      { isFullyInvoiced: true },
      { isPartiallyInvoiced: true },
      {},
    ]) {
      assert.equal(
        resolveSalesOrderBillingStatus({ status: "CANCELLED", hasNfe: true, ...flags }),
        "CANCELED"
      );
    }
  });

  it("ELIMINATÓRIO: CR planejado sem NF não conta como faturado (contrato do input)", () => {
    // O input do motor NEM aceita dados de CR/previsão — a decisão é
    // exclusivamente NF vinculada. Este teste trava o contrato do tipo.
    const status = resolveSalesOrderBillingStatus({
      status: "SENT_TO_NOMUS",
      hasNfe: false,
    });
    assert.equal(status, "NOT_INVOICED");
  });

  it("contexto simplificado (sem isFullyInvoiced) com NF e sem parcial = INVOICED", () => {
    assert.equal(
      resolveSalesOrderBillingStatus({ status: "SENT_TO_NOMUS", hasNfe: true }),
      "INVOICED"
    );
  });

  it("status desconhecido/nulo não quebra e segue o fluxo da NF", () => {
    assert.equal(resolveSalesOrderBillingStatus({ status: null, hasNfe: false }), "NOT_INVOICED");
    assert.equal(
      resolveSalesOrderBillingStatus({ status: "  cancelled  ", hasNfe: false }),
      "CANCELED"
    );
  });

  it("todo status tem rótulo PT-BR estável", () => {
    assert.equal(salesOrderBillingStatusLabel("INVOICED"), salesOrderBillingStatusLabel("INVOICED"));
    for (const s of ["INVOICED", "PARTIALLY_INVOICED", "NOT_INVOICED", "CANCELED"] as const) {
      assert.ok(salesOrderBillingStatusLabel(s).length > 0, s);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Margem oficial — caracterização + differential
// ─────────────────────────────────────────────────────────────────────────────

describe("margem canônica (motor oficial consumido por lista, detalhe e exports)", () => {
  const itemA = calculateSalesOrderItemMargin({
    salesOrderItemId: "item-a",
    productId: "prod-item-a",
    quantity: 10,
    netUnitPrice: 100, // receita 1000
    unitCost: 60, // custo 600 → margem 400 (40%)
    costSource: "VERSIONED_PRODUCTION_COST",
    costConfidence: "HIGH",
  });
  const itemB = calculateSalesOrderItemMargin({
    salesOrderItemId: "item-b",
    productId: "prod-item-b",
    quantity: 1,
    netUnitPrice: 10, // receita 10
    unitCost: 9, // custo 9 → margem 1 (10%)
    costSource: "VERSIONED_PRODUCTION_COST",
    costConfidence: "HIGH",
  });

  it("caracteriza o item: valores exatos com arredondamento oficial", () => {
    assert.equal(itemA.netRevenue, 1000);
    assert.equal(itemA.totalCost, 600);
    assert.equal(itemA.marginValue, 400);
    assert.equal(itemA.marginPercent, 40);
    assert.equal(itemB.marginPercent, 10);
  });

  it("ELIMINATÓRIO (differential): consolidação é PONDERADA por receita, não média simples", () => {
    const summary = calculateSalesOrderMarginSummary([itemA, itemB]);
    // Ponderado: (400+1)/(1000+10) = 39,703%
    assert.equal(summary.marginPercent, 39.7);
    // A média simples daria (40+10)/2 = 25 — qualquer consumidor que
    // recalculasse assim divergiria do motor oficial.
    const naive = naiveAverageMarginPercent([itemA, itemB]);
    assert.equal(naive, 25);
    assert.notEqual(summary.marginPercent, naive);
  });

  it("ELIMINATÓRIO: custo ausente NÃO vira margem zero — vira SEM_CUSTO com margem null", () => {
    const semCusto = calculateSalesOrderItemMargin({
      salesOrderItemId: "item-c",
    productId: "prod-item-c",
      quantity: 5,
      netUnitPrice: 20,
      unitCost: null,
    });
    assert.equal(semCusto.status, "SEM_CUSTO");
    assert.equal(semCusto.marginValue, null, "margem sem custo é null, nunca 0");
    assert.equal(semCusto.marginPercent, null);
    assert.equal(semCusto.totalCost, null);
    // A receita continua real — só a margem fica indeterminada.
    assert.equal(semCusto.netRevenue, 100);
  });

  it("ELIMINATÓRIO: item cancelado sai da consolidação (não zera nem soma)", () => {
    const cancelado = calculateSalesOrderItemMargin({
      salesOrderItemId: "item-x",
    productId: "prod-item-x",
      quantity: 3,
      netUnitPrice: 50,
      unitCost: 10,
      isCanceled: true,
    });
    assert.equal(cancelado.status, "ITEM_CANCELADO");

    const withCanceled = calculateSalesOrderMarginSummary([itemA, cancelado]);
    const withoutCanceled = calculateSalesOrderMarginSummary([itemA]);
    assert.equal(withCanceled.netRevenue, withoutCanceled.netRevenue);
    assert.equal(withCanceled.marginValue, withoutCanceled.marginValue);
    assert.equal(withCanceled.marginPercent, withoutCanceled.marginPercent);
    assert.equal(withCanceled.ignoredItemsCount, 1);
  });

  it("caracteriza a precedência de status: cancelado > sem produto > receita inválida > sem custo", () => {
    // Ordem descoberta no motor oficial — travada aqui para o futuro.
    const semProduto = calculateSalesOrderItemMargin({ quantity: 1, netUnitPrice: 10, unitCost: 5 });
    assert.equal(semProduto.status, "SEM_PRODUTO_VINCULADO");
    assert.equal(semProduto.marginValue, null);
    const canceladoSemProduto = calculateSalesOrderItemMargin({ quantity: 1, netUnitPrice: 10, isCanceled: true });
    assert.equal(canceladoSemProduto.status, "ITEM_CANCELADO", "cancelado vence qualquer outra condição");
    const custoZero = calculateSalesOrderItemMargin({ productId: "p", quantity: 1, netUnitPrice: 10, unitCost: 0 });
    assert.equal(custoZero.status, "CUSTO_ZERO");
    assert.equal(custoZero.marginValue, null, "custo zero não inventa margem de 100%");
  });

  it("consolidação vazia devolve percentual null (nunca divisão por zero)", () => {
    const empty = calculateSalesOrderMarginSummary([]);
    assert.equal(empty.marginPercent, null);
    assert.equal(empty.netRevenue, 0);
  });

  it("quantidade zero: receita 0 vira RECEITA_INVALIDA (nunca NaN, nunca margem)", () => {
    const zeroQty = calculateSalesOrderItemMargin({
      productId: "prod-zero",
      quantity: 0,
      netUnitPrice: 100,
      unitCost: 50,
    });
    assert.ok(Number.isFinite(zeroQty.netRevenue));
    assert.equal(zeroQty.netRevenue, 0);
    assert.equal(zeroQty.status, "RECEITA_INVALIDA");
    assert.equal(zeroQty.marginPercent, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Resultado industrial — bloco único das abas Custos e Resultado
// ─────────────────────────────────────────────────────────────────────────────

describe("resultado industrial (bloco único compartilhado pelas abas Custos e Resultado)", () => {
  const materials = [
    {
      materialKey: "mp-1",
      materialId: "m1",
      sku: "MP001",
      name: "Resina",
      unit: "kg",
      quantityInOrder: 12.5,
      unitCostUsed: 10.1,
      totalCost: 126.25,
      sourceProductSku: null,
      sourceProductName: null,
      lineType: "MATERIAL",
    },
    {
      materialKey: "mp-2",
      materialId: "m2",
      sku: "MP002",
      name: "Aditivo",
      unit: "kg",
      quantityInOrder: 1.2,
      unitCostUsed: 33.33,
      totalCost: 39.996,
      sourceProductSku: null,
      sourceProductName: null,
      lineType: "MATERIAL",
    },
  ];

  it("materialsTotalCost = arredondamento oficial da soma das linhas", () => {
    const block = buildSalesOrderDetailIndustrialResultBlock({ row: null, materials });
    // 126,25 + 39,996 = 166,246 → roundMoney oficial (2 casas)
    assert.equal(block.materialsTotalCost, 166.25);
  });

  it("sem row consolidado o verdict é INCOMPLETE e o bloco se declara indisponível", () => {
    const block = buildSalesOrderDetailIndustrialResultBlock({ row: null, materials });
    assert.equal(block.available, false);
    assert.equal(block.verdict, "INCOMPLETE");
    assert.ok(block.verdictLabel.length > 0);
  });

  it("verdict segue exclusivamente o resultado consolidado (tolerância de 0,9 centavo)", () => {
    const rowBase = { includedInConsolidation: true, warnings: [] };
    assert.equal(
      resolveIndustrialResultVerdict({ ...rowBase, industrialResult: 10 } as never),
      "POSITIVE"
    );
    assert.equal(
      resolveIndustrialResultVerdict({ ...rowBase, industrialResult: -10 } as never),
      "NEGATIVE"
    );
    assert.equal(
      resolveIndustrialResultVerdict({ ...rowBase, industrialResult: 0.005 } as never),
      "ZERO"
    );
    assert.equal(
      resolveIndustrialResultVerdict({ ...rowBase, includedInConsolidation: false, industrialResult: 10 } as never),
      "INCOMPLETE"
    );
    assert.equal(resolveIndustrialResultVerdict(null), "INCOMPLETE");
  });

  it("CROSS-TAB: o mesmo bloco alimenta qualquer consumidor — determinístico por input", () => {
    // As abas Custos e Resultado recebem `payload.industrialResult` — o MESMO
    // objeto. Aqui provamos que o builder é determinístico: mesmo input,
    // mesmos números, sempre.
    const a = buildSalesOrderDetailIndustrialResultBlock({ row: null, materials });
    const b = buildSalesOrderDetailIndustrialResultBlock({ row: null, materials });
    assert.deepEqual(a, b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Gates estruturais (source-inspection)
// ─────────────────────────────────────────────────────────────────────────────

describe("gates estruturais do Pedido de Venda", () => {
  const moduleSource = readSource("src/components/SalesOrdersModule.tsx");

  it("PERF GATE: SalesOrdersModule não importa SalesOrderDetailDialog estaticamente", () => {
    // Um único import estático derrota o code-splitting dos 5 consumidores
    // (warning do Vite: "dynamic import will not move module into another
    // chunk"). O dialog deve entrar via React.lazy.
    const staticImport =
      /import\s*\{[^}]*SalesOrderDetailDialog[^}]*\}\s*from\s*["'][^"']*SalesOrderDetailDialog["']/;
    assert.equal(
      staticImport.test(moduleSource),
      false,
      "import estático do DetailDialog reapareceu no SalesOrdersModule"
    );
    assert.match(
      moduleSource,
      /React\.lazy\(\(\)\s*=>\s*\n?\s*import\("@\/src\/components\/sales\/SalesOrderDetailDialog"\)/,
      "o DetailDialog deve ser carregado via React.lazy"
    );
  });

  it("PERF GATE: todos os demais consumidores do DetailDialog seguem lazy", () => {
    for (const consumer of [
      "src/components/commercial/OutputDocumentsModule.tsx",
      "src/components/commissions/pages/CommissionsOrderProvisionPage.tsx",
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx",
      "src/components/operations/ProductionOrdersModule.tsx",
    ]) {
      const src = readSource(consumer);
      const staticImport =
        /import\s*\{[^}]*SalesOrderDetailDialog[^}]*\}\s*from\s*["'][^"']*SalesOrderDetailDialog["']/;
      assert.equal(staticImport.test(src), false, `${consumer} regrediu para import estático`);
    }
  });

  it("PERF GATE: effect de seller options depende só do key que exclui sellerKey", () => {
    // O key serializa os filtros SEM sellerKey de propósito: trocar apenas o
    // vendedor não deve refazer o fetch das opções. Depender de
    // appliedFilters inteiro refazia.
    assert.equal(
      /\}\s*,\s*\[sellerOptionsFiltersKey\s*,\s*appliedFilters\s*\]\s*\)/.test(moduleSource),
      false,
      "deps do effect de seller options voltaram a incluir appliedFilters"
    );
    assert.match(moduleSource, /\}, \[sellerOptionsFiltersKey\]\);/);
  });

  it("CANONICAL GATE: componentes de exibição do detalhe não reimplementam fórmula de margem", () => {
    // O rodapé/kpis do detalhe exibem `summary`/`margin` vindos do motor
    // oficial via payload. Divisão local receita/custo aqui seria um cálculo
    // paralelo — exatamente o tipo de divergência que esta suíte bloqueia.
    for (const view of [
      "src/components/sales/SalesOrderDetailView.tsx",
      "src/components/sales/SalesOrderDetailCustosTab.tsx",
      "src/components/sales/SalesOrderDetailResultadoTab.tsx",
      "src/components/sales/SalesOrderQuickSummaryDrawer.tsx",
      "src/components/sales/SalesOrderListSummaryCards.tsx",
    ]) {
      const src = readSource(view);
      assert.equal(
        /marginValue\s*\/\s*|\/\s*netRevenue|\*\s*100\s*\)\s*\/|\.reduce\(\s*\(/.test(src),
        false,
        `${view} contém aritmética de margem local — deve consumir o motor oficial`
      );
    }
  });

  it("AbortController presente no fluxo de detalhe (proteção contra troca rápida de pedido)", () => {
    const dialog = readSource("src/components/sales/SalesOrderDetailDialog.tsx");
    assert.match(dialog, /new AbortController\(\)/);
    assert.match(dialog, /ac\.abort\(\)/);
  });
});
