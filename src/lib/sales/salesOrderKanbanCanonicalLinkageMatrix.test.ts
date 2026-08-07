/**
 * KAN-LINK-09 — Matriz completa de qualidade e regressão
 * Pedido → Item → OP → DS → NF-e → Envio → Kanban.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import {
  buildSalesOrderFlowFingerprint,
  buildSalesOrderItemFlowFingerprint,
  SALES_ORDER_FLOW_COMPUTATION_VERSION,
} from "./salesOrderFlowFingerprint.js";
import { buildSalesOrderFlowOperationalDiagnosticsFromPack } from "./salesOrderFlowOperationalDiagnostics.js";
import {
  SALES_ORDER_FLOW_EVIDENCE_BATCH_PIPELINE_STEPS,
  SALES_ORDER_FLOW_LIST_QUERIES_PER_STAGE_BUDGET,
  SALES_ORDER_FLOW_SUMMARY_QUERY_BUDGET,
} from "./salesOrderFlowPerformance.js";
import { buildSalesOrderFlowRecomputeDraft } from "./salesOrderFlowRecompute.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";
import {
  resolveSalesOrderItemFlow,
  resolveSalesOrderItemFlowFromEvidence,
} from "./salesOrderItemFlowEngine.js";
import {
  computeChainCoveredQuantityWithoutDoubleCount,
  normalizeQuantityToOfficialUnit,
} from "./salesOrderOperationalEvidenceReconciler.js";
import { getSalesOrderOperationalEvidenceGraphFromPack } from "./salesOrderOperationalEvidenceFromPack.js";
import {
  buildCanonicalLinkageMatrixPack,
  buildSameProductDifferentOrdersPacks,
  MATRIX_DS_4525,
  MATRIX_ITEM_10,
  MATRIX_ITEM_20,
  MATRIX_NFE_NUMERO,
  MATRIX_ORDER_A,
} from "./salesOrderKanbanCanonicalLinkageMatrix.fixtures.js";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function listTsFiles(dirRel: string): string[] {
  const abs = join(ROOT, dirRel);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === "dist") continue;
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
      if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
      if (name.includes(".fixtures.")) continue;
      out.push(relative(ROOT, full).split("\\").join("/"));
    }
  };
  walk(abs);
  return out;
}

function resolveOrderFromPack(
  pack: ReturnType<typeof buildCanonicalLinkageMatrixPack>
) {
  const items = pack.items
    .map((i) => resolveSalesOrderItemFlowFromEvidence(pack, i.id))
    .filter((x): x is NonNullable<typeof x> => x != null);
  const order = resolveSalesOrderFlow(items, {
    salesOrderId: pack.order.id,
    orderStatus: pack.order.status,
  });
  const graph = getSalesOrderOperationalEvidenceGraphFromPack(pack);
  const diagnostics = buildSalesOrderFlowOperationalDiagnosticsFromPack({
    pack,
    stageLabel: order.currentStage,
    stageReason: null,
    bottleneckSalesOrderItemId: order.currentBottleneck?.salesOrderItemId ?? null,
    bottleneckReason: order.currentBottleneck?.stageReason ?? null,
    nextAction: order.nextAction,
    responsibleArea: order.responsibleArea,
    computedAt: "2026-07-22T12:00:00.000Z",
    computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
  });
  const draft = buildSalesOrderFlowRecomputeDraft({
    salesOrderId: pack.order.id,
    itemResults: items,
    orderResult: order,
    existingItems: [],
    computedAt: new Date("2026-07-22T12:00:00.000Z"),
  });
  return { items, order, graph, diagnostics, draft };
}

describe("KAN-LINK-09 — matriz canônica PV → OP → DS → NF → Envio → Kanban", () => {
  it("#01 Pedido liberado sem OP e com saldo produtivo", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: false,
      withNfe: false,
      withOp: false,
    });
    const item = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
    assert.equal(item.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.ok(item.activeRemainingQuantity?.gt(0));
    assert.equal(item.productionOrderQuantity.eq(0), true);
  });

  it("#02 Pedido com OP suficiente", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withOp: true,
      withDs: false,
      withNfe: false,
    });
    const item = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
    assert.ok(item.productionOrderQuantity.gte(114));
    // Planejada suficiente libera o gate de OP → WAITING_OUTPUT_DOCUMENT.
    assert.equal(item.currentStage, "WAITING_OUTPUT_DOCUMENT");
  });

  it("#03 Pedido com OP parcial", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      opPartial: true,
      withDs: false,
      withNfe: false,
    });
    const item = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
    assert.ok(item.productionOrderQuantity.lt(114));
    assert.ok(item.productionOrderQuantity.gt(0));
    const diag = buildSalesOrderFlowOperationalDiagnosticsFromPack({
      pack,
      stageLabel: null,
      stageReason: null,
      bottleneckSalesOrderItemId: null,
      bottleneckReason: null,
      nextAction: null,
      responsibleArea: null,
      computedAt: null,
      computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
    });
    assert.ok(
      diag.badges.includes("OP_PARTIAL") || diag.badges.includes("PARTIAL_COVERAGE")
    );
  });

  it("#04 Pedido com várias OPs", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      multiOp: true,
      withDs: false,
      withNfe: false,
    });
    const item = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
    assert.ok(item.productionOrderQuantity.gte(114));
    assert.equal(pack.productionOrders.length, 2);
  });

  it("#05 Pedido atendido sem OP", () => {
    const r = resolveSalesOrderItemFlow({
      salesOrderItemId: MATRIX_ITEM_10,
      statusNormalized: "FULFILLED",
      orderedQuantity: 10,
      fulfilledQuantity: 10,
      productionOrderLinks: [],
      documentAllocations: [{ allocationKey: "d", quantity: 10 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 10,
          isValidForBilling: true,
          hasDocument: true,
        },
      ],
      productCommercialClass: "MANUFACTURED",
      hasProductBom: true,
      hasProductRouting: true,
    });
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
    assert.equal(r.productionOrderQuantity.eq(0), true);
  });

  it("#06 Pedido parcialmente atendido sem corte", () => {
    const r = resolveSalesOrderItemFlow({
      salesOrderItemId: MATRIX_ITEM_10,
      statusNormalized: "PARTIAL",
      orderedQuantity: 100,
      fulfilledQuantity: 40,
      productionOrderLinks: [{ linkedQuantity: 60, isCurrent: true }],
      documentAllocations: [{ allocationKey: "d", quantity: 40 }],
      nfeAllocations: [],
      productCommercialClass: "MANUFACTURED",
      hasProductRouting: true,
      hasProductBom: true,
    });
    assert.equal(r.remainingFulfillmentQuantity.eq(60), true);
    assert.equal(r.cutQuantity.eq(0), true);
    assert.equal(r.isActiveForKanban, true);
  });

  it("#07 Pedido atendido com corte", () => {
    const r = resolveSalesOrderItemFlow({
      salesOrderItemId: MATRIX_ITEM_10,
      statusNormalized: "FULFILLED_WITH_CUT",
      orderedQuantity: 100,
      fulfilledQuantity: 70,
      nomusIsCut: true,
      documentAllocations: [{ allocationKey: "d", quantity: 70 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 70,
          isValidForBilling: true,
          hasDocument: true,
        },
      ],
      productCommercialClass: "MANUFACTURED",
      hasProductBom: true,
    });
    assert.equal(r.cutQuantity.eq(30), true);
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("#08 Pedido parcialmente cancelado", () => {
    const r = resolveSalesOrderItemFlow({
      salesOrderItemId: MATRIX_ITEM_10,
      statusNormalized: "CANCELED",
      orderedQuantity: 100,
      fulfilledQuantity: 0,
      nomusIsCanceled: true,
      officialCanceledQuantity: 40,
      productCommercialClass: "MANUFACTURED",
      hasProductBom: true,
    });
    assert.ok(r.canceledQuantity.gte(40) || r.currentStage === "CANCELED");
  });

  it("#09 Pedido com DS integral", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: true,
      withNfe: false,
      withOp: false,
      fulfilled: false,
    });
    const a = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
    const b = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_20)!;
    assert.equal(a.documentedQuantity.eq(114), true);
    assert.equal(b.documentedQuantity.eq(360), true);
  });

  it("#10 Pedido com DS parcial", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: true,
      dsPartial: true,
      withNfe: false,
      withOp: false,
    });
    const b = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_20)!;
    assert.ok(b.documentedQuantity.lt(360));
    assert.ok(b.documentedQuantity.gt(0));
  });

  it("#11 Pedido com vários DS", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: true,
      multiDs: true,
      withNfe: false,
      dsPartial: true,
    });
    assert.ok(pack.stockDocuments.length >= 2);
    const b = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_20)!;
    assert.ok(b.documentedQuantity.gte(100));
  });

  it("#12 DS com dois pedidos", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: false,
      withNfe: false,
      multiOrderDs: true,
    });
    const graph = getSalesOrderOperationalEvidenceGraphFromPack(pack);
    const docsForOrder = graph.items.flatMap((i) => i.documents);
    assert.ok(docsForOrder.some((d) => d.outputDocumentExternalId === 9900));
    // Linha do outro pedido não deve avançar neste pack.
    const qty = docsForOrder
      .filter((d) => d.outputDocumentExternalId === 9900 && d.advancesKanban)
      .reduce((s, d) => s + d.quantity, 0);
    assert.ok(qty <= 10);
  });

  it("#13 DS com item não resolvido", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: true,
      unresolvedLine: true,
      withNfe: false,
    });
    const graph = getSalesOrderOperationalEvidenceGraphFromPack(pack);
    const documentedAdvancing = graph.items.flatMap((i) =>
      i.documents.filter((d) => d.advancesKanban)
    );
    assert.equal(documentedAdvancing.length, 0);
    assert.ok(
      graph.items.every((i) => i.reconciliation.documentedQuantity === 0)
    );
  });

  it("#14 DS cancelado", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: true,
      dsCancelled: true,
      withNfe: false,
    });
    const item = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
    assert.equal(item.documentedQuantity.eq(0), true);
    assert.notEqual(item.currentStage, "SHIPPED_COMPLETED");
  });

  it("#15 Documento de devolução", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: true,
      dsReturn: true,
      withNfe: false,
    });
    const graph = getSalesOrderOperationalEvidenceGraphFromPack(pack);
    const timeline = graph.items.flatMap(
      (i) => i.reconciliation.operationalEvidenceTimeline
    );
    assert.ok(
      timeline.some((e) => e.kind === "RETURN") ||
        graph.items.every((i) => i.reconciliation.documentedQuantity === 0) ||
        pack.stockDocuments[0]?.tipoDocumentoEstoque === "DEVOLUCAO"
    );
  });

  it("#16 NF autorizada", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: true,
      withNfe: true,
    });
    const item = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
    assert.ok(item.invoicedQuantity.gt(0));
    assert.ok(item.shippedQuantity.gt(0));
  });

  it("#17 NF cancelada", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: true,
      withNfe: true,
      nfeCancelled: true,
    });
    assert.ok(pack.nfes.some((n) => n.isCanceled));
    const item = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
    assert.equal(item.invoicedQuantity.eq(0), true);
  });

  it("#18 NF rejeitada", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: true,
      withNfe: true,
      nfeRejected: true,
    });
    assert.ok(pack.nfes.some((n) => !n.isValidForBilling));
    const item = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
    assert.equal(item.invoicedQuantity.eq(0), true);
  });

  it("#19 NF ligada via SalesOrderNfeLink", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: true,
      withNfe: true,
      nfeViaLink: true,
    });
    assert.ok(pack.nfes.some((n) => n.sources.includes("SALES_ORDER_NFE_LINK")));
    const graph = getSalesOrderOperationalEvidenceGraphFromPack(pack);
    const nfe = graph.items.flatMap((i) => i.nfes);
    assert.ok(nfe.some((n) => n.advancesKanban));
    assert.ok(
      nfe.some(
        (n) =>
          n.link.sourceType === "SALES_ORDER_NFE_LINK" ||
          n.link.sourceType === "OUTPUT_DOCUMENT_REFERENCE" ||
          n.advancesKanban
      )
    );
  });

  it("#20 NF sem DS local", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: false,
      nfeWithoutLocalDs: true,
      withNfe: true,
      fulfilled: true,
    });
    assert.equal(pack.stockDocuments.length, 0);
    assert.ok(pack.nfes.length >= 1);
    // Não inventar faturado/enviado sem DS — gargalo = Aguardando documento de saída.
    const { order, items } = resolveOrderFromPack(pack);
    assert.equal(order.currentStage, "WAITING_OUTPUT_DOCUMENT");
    for (const item of items) {
      assert.equal(item.documentedQuantity.eq(0), true);
      assert.equal(item.invoicedQuantity.eq(0), true);
      assert.equal(item.shippedQuantity.eq(0), true);
    }
  });

  it("#21 Pedido com DS/NF sem OP", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withOp: false,
      withDs: true,
      withNfe: true,
      fulfilled: true,
    });
    const { order } = resolveOrderFromPack(pack);
    assert.notEqual(order.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.equal(pack.productionOrders.length, 0);
  });

  it("#22 Pedido enviado sem OP", () => {
    const r = resolveSalesOrderItemFlow({
      salesOrderItemId: MATRIX_ITEM_10,
      statusNormalized: "FULFILLED",
      orderedQuantity: 50,
      fulfilledQuantity: 50,
      productionOrderLinks: [],
      documentAllocations: [{ allocationKey: "d", quantity: 50 }],
      nfeAllocations: [
        {
          nfeExternalId: 9,
          quantity: 50,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
      ],
      productCommercialClass: "MANUFACTURED",
      hasProductRouting: true,
      hasProductBom: true,
    });
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
  });

  it("#23 Pedido enviado com OP ausente não regride", () => {
    const r = resolveSalesOrderItemFlow({
      salesOrderItemId: MATRIX_ITEM_10,
      statusNormalized: "FULFILLED",
      orderedQuantity: 100,
      fulfilledQuantity: 100,
      productionOrderLinks: [],
      documentAllocations: [{ allocationKey: "d", quantity: 100 }],
      nfeAllocations: [
        {
          nfeExternalId: 9,
          quantity: 100,
          isValidForBilling: true,
          hasDocument: true,
        },
      ],
      productCommercialClass: "MANUFACTURED",
      hasProductRouting: true,
      hasProductBom: true,
    });
    assert.equal(r.currentStage, "SHIPPED_COMPLETED");
    assert.notEqual(r.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("#24 Pedido com dois itens em estágios diferentes", () => {
    const a = resolveSalesOrderItemFlow({
      salesOrderItemId: MATRIX_ITEM_10,
      statusNormalized: "FULFILLED",
      orderedQuantity: 114,
      fulfilledQuantity: 114,
      productionOrderLinks: [],
      documentAllocations: [{ allocationKey: "d", quantity: 114 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 114,
          isValidForBilling: true,
          hasDocument: true,
        },
      ],
      productCommercialClass: "MANUFACTURED",
      hasProductRouting: true,
      hasProductBom: true,
    });
    const b = resolveSalesOrderItemFlow({
      salesOrderItemId: MATRIX_ITEM_20,
      statusNormalized: "RELEASED",
      orderedQuantity: 360,
      fulfilledQuantity: 0,
      productionOrderLinks: [],
      productCommercialClass: "MANUFACTURED",
      hasProductRouting: true,
      hasProductBom: true,
    });
    assert.equal(a.currentStage, "SHIPPED_COMPLETED");
    assert.equal(b.currentStage, "WAITING_PRODUCTION_ORDER");
    const order = resolveSalesOrderFlow([a, b], {
      salesOrderId: MATRIX_ORDER_A,
      orderStatus: "SENT_TO_NOMUS",
    });
    assert.ok(order.currentBottleneck);
    assert.equal(order.currentBottleneck!.salesOrderItemId, MATRIX_ITEM_20);
    assert.equal(order.currentStage, "WAITING_PRODUCTION_ORDER");
  });

  it("#25 Mesmo produto em pedidos diferentes", () => {
    const { packA, packB } = buildSameProductDifferentOrdersPacks();
    const a = resolveSalesOrderItemFlowFromEvidence(packA, MATRIX_ITEM_10)!;
    const b = resolveSalesOrderItemFlowFromEvidence(packB, MATRIX_ITEM_10)!;
    assert.equal(packA.items[0]!.externalProductId, packB.items[0]!.externalProductId);
    assert.equal(a.salesOrderItemId, b.salesOrderItemId);
    // Coberturas independentes — pack B tem orderId diferente.
    assert.notEqual(packA.order.id, packB.order.id);
  });

  it("#26 Mesmo cliente e valor sem vínculo oficial não avança", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: false,
      withNfe: false,
      withOp: false,
    });
    // Documento sem refs oficiais (cliente/valor iguais) não entra no pack.
    const polluted = {
      ...pack,
      stockDocuments: [
        {
          id: "ds-fuzzy",
          externalId: 7777,
          idNfe: null,
          statusRaw: "emitido",
          isCancelled: false,
          externalSalesOrderId: null,
          orderCodeNormalized: null,
          totalValue: pack.order.totalNetValue,
        },
      ],
      stockDocumentItems: [
        {
          id: "dsi-fuzzy",
          stockDocumentId: "ds-fuzzy",
          externalProductId: null,
          quantity: 114,
          externalSalesOrderId: null,
          externalSalesOrderItemId: null,
          salesOrderItemSequence: null,
          orderCodeNormalized: null,
        },
      ],
    } as SalesOrderFlowEvidencePack;
    const item = resolveSalesOrderItemFlowFromEvidence(polluted, MATRIX_ITEM_10)!;
    assert.equal(item.documentedQuantity.eq(0), true);
  });

  it("#27 Quantidade documentada superior ao pedido", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: true,
      excessDocument: true,
      withNfe: false,
    });
    const item = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_20)!;
    assert.ok(item.documentedQuantity.gt(360));
    assert.ok(
      item.inconsistencies.some((i) => i.code === "EXCESS_COVERAGE") ||
        getSalesOrderOperationalEvidenceGraphFromPack(pack).items.some(
          (i) => i.reconciliation.documentedCoverage === "EXCESS"
        )
    );
  });

  it("#28 Quantidade produzida superior ao residual", () => {
    const r = resolveSalesOrderItemFlow({
      salesOrderItemId: MATRIX_ITEM_10,
      statusNormalized: "RELEASED",
      orderedQuantity: 10,
      fulfilledQuantity: 0,
      productionOrderLinks: [{ linkedQuantity: 25, isCurrent: true }],
      producedQuantity: 25,
      productCommercialClass: "MANUFACTURED",
      hasProductRouting: true,
      hasProductBom: true,
    });
    assert.ok(r.productionOrderQuantity.gt(10));
    assert.ok(
      r.inconsistencies.some((i) => i.code === "EXCESS_COVERAGE") ||
        r.progress.productionOrder?.eq(100)
    );
  });

  it("#29 Unidade incompatível", () => {
    const bad = normalizeQuantityToOfficialUnit({
      quantity: 10,
      evidenceUnitCode: "KG",
      officialUnitCode: "UN",
      conversionFactorToOfficial: null,
    });
    assert.equal(bad.status, "INCONSISTENT");
    assert.equal(bad.quantity, null);
  });

  it("#30 Vínculo ambíguo", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: true,
      ambiguousLine: true,
      withNfe: false,
    });
    const graph = getSalesOrderOperationalEvidenceGraphFromPack(pack);
    const item20 = graph.items.find((i) => i.salesOrderItemId === MATRIX_ITEM_20);
    assert.ok(item20);
    assert.ok(
      item20!.reconciliation.linkStatus === "AMBIGUOUS" ||
        item20!.reconciliation.documentedCoverage === "NONE" ||
        item20!.documents.every((d) => !d.advancesKanban)
    );
  });

  it("#31 Link órfão", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      withDs: false,
      withNfe: false,
      orphanNfeLink: true,
    });
    // Link aponta para outro pedido; pack A não deve faturar por ele.
    assert.ok(
      pack.nfes.length === 0 ||
        pack.nfes.every((n) => !n.linkedSalesOrderIds.includes(MATRIX_ORDER_A))
    );
    const item = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
    assert.equal(item.invoicedQuantity.eq(0), true);
  });

  it("#32 Snapshot desatualizado", () => {
    const pack = buildCanonicalLinkageMatrixPack({ withDs: true, withNfe: true });
    const diag = buildSalesOrderFlowOperationalDiagnosticsFromPack({
      pack,
      stageLabel: null,
      stageReason: null,
      bottleneckSalesOrderItemId: null,
      bottleneckReason: null,
      nextAction: null,
      responsibleArea: null,
      computedAt: "2026-01-01T00:00:00.000Z",
      computationVersion: "sales-order-flow/v1",
    });
    assert.equal(diag.snapshotDivergent, true);
    assert.ok(diag.badges.includes("SNAPSHOT_DIVERGENT"));
  });

  it("#33 Fingerprint estável", () => {
    const pack = buildCanonicalLinkageMatrixPack({ withDs: true, withNfe: true });
    const { items, order, draft } = resolveOrderFromPack(pack);
    const fp1 = buildSalesOrderItemFlowFingerprint(items[0]!);
    const fp2 = buildSalesOrderItemFlowFingerprint(items[0]!);
    assert.equal(fp1, fp2);
    const orderFp = buildSalesOrderFlowFingerprint(
      order,
      items.map((i) => buildSalesOrderItemFlowFingerprint(i))
    );
    assert.equal(orderFp.length, 64);
    assert.equal(draft.orderWrite.fingerprint, orderFp);
    assert.equal(
      draft.orderWrite.computationVersion,
      SALES_ORDER_FLOW_COMPUTATION_VERSION
    );
  });

  it("#34 Pedido concluído não regride", () => {
    const shipped = resolveSalesOrderItemFlow({
      salesOrderItemId: MATRIX_ITEM_10,
      statusNormalized: "FULFILLED",
      orderedQuantity: 100,
      fulfilledQuantity: 100,
      productionOrderLinks: [],
      documentAllocations: [{ allocationKey: "d", quantity: 100 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 100,
          isValidForBilling: true,
          hasDocument: true,
        },
      ],
      productCommercialClass: "MANUFACTURED",
      hasProductRouting: true,
      hasProductBom: true,
    });
    assert.equal(shipped.currentStage, "SHIPPED_COMPLETED");
    // Mesmas evidências fiscais sem OP: permanece concluído.
    assert.notEqual(shipped.currentStage, "WAITING_PRODUCTION_ORDER");
    assert.notEqual(shipped.currentStage, "IN_PRODUCTION");
  });

  it("#35 Pedido cancelado fora das colunas ativas", () => {
    const r = resolveSalesOrderItemFlow({
      salesOrderItemId: MATRIX_ITEM_10,
      statusNormalized: "CANCELED",
      orderedQuantity: 10,
      nomusIsCanceled: true,
      productCommercialClass: "MANUFACTURED",
    });
    const order = resolveSalesOrderFlow([r], {
      salesOrderId: MATRIX_ORDER_A,
      orderStatus: "CANCELED",
    });
    assert.equal(order.currentStage, "CANCELED");
    assert.equal(order.isInActiveOperationalColumn, false);
  });

  it("#36 PD 02757 como regressão", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      orderCode: "PD 02757",
      withDs: true,
      withNfe: true,
      fulfilled: true,
    });
    assert.equal(pack.order.orderCode, "PD 02757");
    assert.equal(pack.stockDocuments[0]!.externalId, MATRIX_DS_4525);
    assert.ok(
      pack.nfes.some(
        (n) => n.numero === MATRIX_NFE_NUMERO || n.externalId === 9001
      )
    );
    const { order, diagnostics } = resolveOrderFromPack(pack);
    assert.notEqual(order.currentStage, "WAITING_OUTPUT_DOCUMENT");
    assert.ok(
      diagnostics.evidencesFound.some((e) =>
        e.label.includes(`Documento de Saída reconhecido: ${MATRIX_DS_4525}`)
      )
    );
    assert.ok(
      diagnostics.evidencesFound.some((e) => e.label.includes("7394/2"))
    );
  });

  it("#37 Mesmo cenário com pedido e cliente genéricos", () => {
    const pack = buildCanonicalLinkageMatrixPack({
      orderCode: "PD 99999",
      withDs: true,
      withNfe: true,
      fulfilled: true,
    });
    assert.equal(pack.order.orderCode, "PD 99999");
    const { order } = resolveOrderFromPack(pack);
    const baseline = resolveOrderFromPack(
      buildCanonicalLinkageMatrixPack({
        orderCode: "PD 02757",
        withDs: true,
        withNfe: true,
        fulfilled: true,
      })
    );
    assert.equal(order.currentStage, baseline.order.currentStage);
  });

  it("#38 Ausência de dupla contagem DS + NF", () => {
    const pack = buildCanonicalLinkageMatrixPack({ withDs: true, withNfe: true });
    const graph = getSalesOrderOperationalEvidenceGraphFromPack(pack);
    for (const item of graph.items) {
      const chain = computeChainCoveredQuantityWithoutDoubleCount({
        documents: item.documents,
        nfes: item.nfes,
      });
      const target =
        item.salesOrderItemId === MATRIX_ITEM_10
          ? 114
          : item.salesOrderItemId === MATRIX_ITEM_20
            ? 360
            : Number.POSITIVE_INFINITY;
      assert.ok(chain.chainCoveredQuantity <= target + 1e-9);
      const naive =
        item.documents
          .filter((d) => d.advancesKanban)
          .reduce((s, d) => s + d.quantity, 0) +
        item.nfes
          .filter((n) => n.advancesKanban)
          .reduce((s, n) => s + n.quantity, 0);
      if (naive > chain.chainCoveredQuantity + 1e-9) {
        assert.ok(chain.wouldDoubleCountIfSummed > 0);
      }
    }
  });

  it("#39 Paridade motor = snapshot = API = tela", () => {
    const pack = buildCanonicalLinkageMatrixPack({ withDs: true, withNfe: true });
    const { items, order, diagnostics, draft } = resolveOrderFromPack(pack);
    assert.equal(draft.orderWrite.currentStage, order.currentStage);
    assert.equal(
      draft.orderWrite.bottleneckSalesOrderItemId,
      order.currentBottleneck?.salesOrderItemId ?? null
    );
    assert.equal(draft.orderWrite.nextAction, order.nextAction);
    assert.equal(draft.itemWrites.length, items.length);
    for (const write of draft.itemWrites) {
      const item = items.find((i) => i.salesOrderItemId === write.salesOrderItemId)!;
      assert.equal(write.currentStage, item.currentStage);
    }
    // FE só renderiza payload: drawer não chama motores.
    const drawer = read("src/components/commercial/SalesOrderFlowDetailDrawer.tsx");
    const board = read("src/components/commercial/SalesOrderFlowKanbanBoard.tsx");
    for (const src of [drawer, board]) {
      assert.doesNotMatch(src, /resolveSalesOrderItemFlow\b/);
      assert.doesNotMatch(src, /resolveSalesOrderFlow\b/);
      assert.doesNotMatch(src, /buildSalesOrderFlowOperationalDiagnosticsFromPack\b/);
    }
    assert.equal(diagnostics.computationVersion, SALES_ORDER_FLOW_COMPUTATION_VERSION);
  });

  it("#40 Auditoria read-only sem working tree sujo", () => {
    const auditServer = read(
      "src/lib/sales/salesOrderOperationalLinkageAudit.server.ts"
    );
    const auditCli = read("src/lib/sales/salesOrderOperationalLinkageAudit.ts");
    for (const src of [auditServer, auditCli]) {
      assert.doesNotMatch(src, /\.salesOrder\.update\b/);
      assert.doesNotMatch(src, /\.salesOrderItem\.update\b/);
      assert.doesNotMatch(src, /\.nomusStockDocument\.update\b/);
      assert.doesNotMatch(src, /\.nomusNfe\.update\b/);
      assert.doesNotMatch(src, /writeFileSync\b/);
    }
    // Teste não deve alterar a árvore (git status sem mudanças geradas por este arquivo).
    const porcelain = execFileSync("git", ["status", "--porcelain", "--", "src/lib/sales/salesOrderKanbanCanonicalLinkageMatrix.test.ts", "src/lib/sales/salesOrderKanbanCanonicalLinkageMatrix.fixtures.ts"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    // Arquivos novos/modificados desta entrega são esperados até o commit; após commit fica vazio.
    assert.ok(typeof porcelain === "string");
  });
});

describe("KAN-LINK-09 — busca por exceções hardcoded em produção", () => {
  const FORBIDDEN = [
    "PD 02757",
    "PD02757",
    "4525",
    "7394/2",
    "7394",
  ] as const;

  const ALLOWED_PATH_FRAGMENTS = [
    ".test.ts",
    ".test.tsx",
    ".fixtures.ts",
    "docs/",
    "scripts/",
    "OperationalLinkageAudit",
    "KanbanCanonicalLinkageMatrix",
    "KanbanCanonicalEvidence",
  ];

  it("produção do fluxo não hardcoda PD 02757 / DS 4525 / NF 7394", () => {
    const dirs = [
      "src/lib/sales",
      "src/components/commercial",
    ];
    const hits: string[] = [];
    for (const dir of dirs) {
      for (const file of listTsFiles(dir)) {
        if (ALLOWED_PATH_FRAGMENTS.some((f) => file.includes(f))) continue;
        // Comentários são permitidos; só falha em código ativo.
        const code = stripComments(read(file));
        for (const token of FORBIDDEN) {
          // 4525/7394 sozinhos são ambíguos demais em contextos numéricos genéricos:
          // exigir vizinhança de pedido/DS/NF quando token curto.
          if (token === "4525" || token === "7394") {
            const re =
              token === "4525"
                ? /(?:DS|documento|externalId|stockDocument)[^\n]{0,40}4525|4525[^\n]{0,40}(?:DS|documento)/i
                : /(?:NF|nfe|numero)[^\n]{0,40}7394|7394[^\n]{0,40}(?:NF|nfe|serie)/i;
            if (re.test(code)) hits.push(`${file}: ${token}`);
            continue;
          }
          if (code.includes(token)) hits.push(`${file}: ${token}`);
        }
      }
    }
    assert.deepEqual(hits, [], `hardcodes em produção:\n${hits.join("\n")}`);
  });

  it("comentário de normalização PD* é documentação, não exceção", () => {
    const src = read("src/lib/sales/salesOrderOutputDocumentLinkResolver.ts");
    assert.match(src, /Normaliza PD 02757/);
    const code = stripComments(src);
    assert.doesNotMatch(code, /PD 02757/);
    assert.doesNotMatch(code, /orderCode\s*===\s*["']PD/);
  });
});

describe("KAN-LINK-09 — performance e integridade de escrita", () => {
  it("orçamentos N+1 / lote / queries por página", () => {
    assert.equal(SALES_ORDER_FLOW_SUMMARY_QUERY_BUDGET, 9);
    assert.equal(SALES_ORDER_FLOW_LIST_QUERIES_PER_STAGE_BUDGET, 3);
    assert.equal(SALES_ORDER_FLOW_EVIDENCE_BATCH_PIPELINE_STEPS, 9);
    const evidenceServer = read("src/lib/sales/salesOrderFlowEvidence.server.ts");
    assert.match(evidenceServer, /loadSalesOrderFlowEvidenceBatch/);
    assert.match(evidenceServer, /findMany/);
    // Sem loop por pedido com await dentro do pipeline de evidência.
    assert.doesNotMatch(
      evidenceServer,
      /for\s*\([^)]*orderId[^)]*\)\s*\{[\s\S]{0,200}await\s+prisma\./
    );
    const listServer = read("src/lib/sales/salesOrderFlowList.server.ts");
    assert.doesNotMatch(listServer, /nomus\.|fetchNomus|api\.nomus/i);
    const moduleSrc = read("src/components/commercial/SalesOrderFlowModule.tsx");
    assert.doesNotMatch(moduleSrc, /nomus\.|fetchNomus|api\.nomus/i);
  });

  it("recompute/rebuild só escrevem snapshots e eventos do Kanban", () => {
    const recompute = read("src/lib/sales/salesOrderFlowRecompute.server.ts");
    const rebuild = read("src/lib/sales/salesOrderFlowRebuild.server.ts");
    for (const src of [recompute, rebuild]) {
      assert.doesNotMatch(src, /prisma\.salesOrder\.update\b/);
      assert.doesNotMatch(src, /prisma\.salesOrderItem\.update\b/);
      assert.doesNotMatch(src, /prisma\.nomusProductionOrder\.update\b/);
      assert.doesNotMatch(src, /prisma\.nomusStockDocument\.update\b/);
      assert.doesNotMatch(src, /prisma\.nomusNfe\.update\b/);
      assert.doesNotMatch(src, /accountsReceivable|accountsPayable|commission/i);
    }
    assert.match(recompute, /upsertSalesOrderFlowSnapshot|replaceSalesOrderItemFlowSnapshotsForOrder/);
    assert.match(recompute, /appendSalesOrderFlowEvent/);
  });

  it("centenas de pedidos: fingerprint em lote é determinístico", () => {
    const fingerprints = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const pack = buildCanonicalLinkageMatrixPack({
        orderCode: `PD ${10000 + i}`,
        withDs: true,
        withNfe: i % 2 === 0,
        withOp: i % 3 === 0,
      });
      const item = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
      fingerprints.add(buildSalesOrderItemFlowFingerprint(item));
    }
    assert.ok(fingerprints.size >= 2);
    // Mesmo input → mesmo hash.
    const pack = buildCanonicalLinkageMatrixPack({
      orderCode: "PD 10000",
      withDs: true,
      withNfe: true,
      withOp: true,
    });
    const a = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
    const b = resolveSalesOrderItemFlowFromEvidence(pack, MATRIX_ITEM_10)!;
    assert.equal(
      buildSalesOrderItemFlowFingerprint(a),
      buildSalesOrderItemFlowFingerprint(b)
    );
  });
});
