/**
 * KAN-LINK-03 — Testes do auditor read-only de vínculos operacionais.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { execSync } from "node:child_process";
import {
  buildOrderOperationalLinkageReport,
  classifyMassLinkageFindings,
  formatOperationalLinkageAuditMarkdown,
  parseSalesOrderOperationalLinkageAuditArgs,
  resolveOperationalLinkageAuditOutputFiles,
  resolveSalesOrderOperationalLinkageAuditExitCode,
  scanSalesOrderOperationalLinkageAuditSource,
  stringifyOperationalLinkageAuditReport,
  type SalesOrderOperationalLinkageAuditReport,
} from "./salesOrderOperationalLinkageAudit.js";
import { loadSalesOrderOperationalLinkageOrderAudit } from "./salesOrderOperationalLinkageAudit.server.js";

const ORDER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ITEM_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const ITEM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";

describe("salesOrderOperationalLinkageAudit — CLI", () => {
  it("parseia --order e rejeita --apply", () => {
    const args = parseSalesOrderOperationalLinkageAuditArgs([
      '--order=PD 02757',
      "--json",
    ]);
    assert.equal(args.mode, "ORDER");
    assert.equal(args.order, "PD02757");
    assert.equal(args.emitJson, true);
    assert.equal(args.outputDir, null);
    assert.throws(
      () =>
        parseSalesOrderOperationalLinkageAuditArgs([
          "--order=PD02757",
          "--apply",
        ]),
      /somente leitura|--apply/
    );
  });

  it("parseia --active/--all/--limit/--output e bloqueia docs/generated", () => {
    const active = parseSalesOrderOperationalLinkageAuditArgs([
      "--active",
      "--limit=25",
      "--markdown",
      "--output=tmp-audits/operational-links",
    ]);
    assert.equal(active.mode, "ACTIVE");
    assert.equal(active.limit, 25);
    assert.equal(active.emitMarkdown, true);
    assert.throws(
      () =>
        parseSalesOrderOperationalLinkageAuditArgs([
          "--all",
          "--output=docs/generated/x",
        ]),
      /docs\/generated/
    );
    assert.throws(
      () => parseSalesOrderOperationalLinkageAuditArgs(["--order=PD1", "--active"]),
      /apenas um/
    );
  });

  it("exit codes: 0 sem crítico, 1 com crítico, 2 técnico", () => {
    assert.equal(
      resolveSalesOrderOperationalLinkageAuditExitCode({
        criticalDivergenceCount: 0,
      }),
      0
    );
    assert.equal(
      resolveSalesOrderOperationalLinkageAuditExitCode({
        criticalDivergenceCount: 2,
      }),
      1
    );
    assert.equal(
      resolveSalesOrderOperationalLinkageAuditExitCode({
        technicalError: true,
        criticalDivergenceCount: 0,
      }),
      2
    );
  });
});

describe("salesOrderOperationalLinkageAudit — relatório de pedido", () => {
  it("pedido inexistente", () => {
    const report = buildOrderOperationalLinkageReport({
      requestedOrder: "PD09999",
      order: null,
      items: [],
      candidateProductionOrders: [],
      candidateDocuments: [],
      salesOrderNfeLinks: [],
      nfes: [],
      calculatedStage: null,
      persistedStage: null,
      calculatedFingerprint: null,
      persistedFingerprint: null,
    });
    assert.equal(report.orderFound, false);
    assert.ok(report.observations.some((o) => o.code === "ORDER_NOT_FOUND"));
    assert.equal(report.criticalDivergenceCount, 0);
  });

  it("pedido encontrado com DS direto e NF via SalesOrderNfeLink", () => {
    const report = buildOrderOperationalLinkageReport({
      requestedOrder: "PD02757",
      order: {
        salesOrderId: ORDER_ID,
        orderCode: "PD 02757",
        externalSalesOrderId: 2757,
        status: "SENT_TO_NOMUS",
        totalNetValue: 12650.4,
      },
      items: [
        {
          salesOrderItemId: ITEM_A,
          sequence: "00010",
          sku: "A",
          productName: "Item A",
          externalProductId: 100,
          orderedQuantity: 114,
          cutQuantity: 0,
          canceledQuantity: 0,
          fulfilledQuantity: 114,
          activeObligationQuantity: 114,
          documentedQuantity: 114,
          invoicedQuantity: 114,
          shippedQuantity: 114,
          productionCoveredQuantity: 0,
          calculatedStage: "SHIPPED_COMPLETED",
          persistedStage: "WAITING_OUTPUT_DOCUMENT",
          productionLinks: [],
          documents: [
            {
              stockDocumentExternalId: 4525,
              quantity: "114.00",
              sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
              usedByKanban: true,
              nfeExternalId: 9001,
            },
          ],
          nfes: [
            {
              nfeExternalId: 9001,
              quantity: "114.00",
              status: "AUTHORIZED",
              sourceType: "SALES_ORDER_NFE_LINK",
              usedByKanban: true,
            },
          ],
        },
        {
          salesOrderItemId: ITEM_B,
          sequence: "00020",
          sku: "B",
          productName: "Item B",
          externalProductId: 200,
          orderedQuantity: 360,
          cutQuantity: 0,
          canceledQuantity: 0,
          fulfilledQuantity: 360,
          activeObligationQuantity: 360,
          documentedQuantity: 360,
          invoicedQuantity: 360,
          shippedQuantity: 360,
          productionCoveredQuantity: 0,
          calculatedStage: "SHIPPED_COMPLETED",
          persistedStage: "WAITING_OUTPUT_DOCUMENT",
          productionLinks: [],
          documents: [
            {
              stockDocumentExternalId: 4525,
              quantity: "360.00",
              sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
              usedByKanban: true,
              nfeExternalId: 9001,
            },
          ],
          nfes: [
            {
              nfeExternalId: 9001,
              quantity: "360.00",
              status: "AUTHORIZED",
              sourceType: "SALES_ORDER_NFE_LINK",
              usedByKanban: true,
            },
          ],
        },
      ],
      candidateProductionOrders: [
        {
          productionOrderExternalId: 777,
          linkedQuantity: "114.00",
          isCurrent: true,
          salesOrderItemId: ITEM_A,
          sourceType: "PRODUCTION_ORDER_REFERENCE",
          usedByKanban: true,
        },
      ],
      candidateDocuments: [
        {
          stockDocumentExternalId: 4525,
          documentNumber: "4525",
          idNfe: 9001,
          isCancelled: false,
          totalValue: "12650.40",
          statusRaw: "emitido",
          discoveryPath: "DS_ID_NFE_VIA_SALES_ORDER_NFE_LINK",
          usedByKanban: true,
          sourceType: "SALES_ORDER_NFE_LINK",
          lines: [
            {
              stockDocumentItemId: "line-a",
              externalProductId: 100,
              quantity: "114.00",
              matchedSalesOrderItemId: ITEM_A,
              matchReason: "EXTERNAL_PRODUCT_ID",
            },
            {
              stockDocumentItemId: "line-b",
              externalProductId: 200,
              quantity: "360.00",
              matchedSalesOrderItemId: ITEM_B,
              matchReason: "EXTERNAL_PRODUCT_ID",
            },
          ],
        },
      ],
      salesOrderNfeLinks: [
        {
          id: "link-1",
          nfeExternalId: 9001,
          nfeNumber: "7394",
          nfeSerie: "2",
          nfeStatus: 100,
          nomusNfeId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        },
      ],
      nfes: [
        {
          nfeExternalId: 9001,
          numero: "7394",
          serie: "2",
          statusNormalized: "AUTHORIZED",
          isCanceled: false,
          isValidForBilling: true,
          usedByKanban: true,
          hasSalesOrderNfeLink: true,
        },
      ],
      calculatedStage: "SHIPPED_COMPLETED",
      persistedStage: "WAITING_OUTPUT_DOCUMENT",
      calculatedFingerprint: "aaa",
      persistedFingerprint: "bbb",
    });

    assert.equal(report.orderFound, true);
    assert.equal(report.orderCodeNormalized, "PD02757");
    assert.equal(report.totalNetValue, "12650.40");
    assert.equal(report.items.length, 2);
    assert.equal(report.items[0]!.orderedQuantity, "114.00");
    assert.equal(report.items[1]!.orderedQuantity, "360.00");
    assert.equal(report.linkedDocuments.length, 1);
    assert.equal(report.salesOrderNfeLinks[0]!.nfeNumber, "7394");
    assert.equal(report.linkedProductionOrders.length, 1);
    assert.ok(
      report.observations.some((o) => o.code === "SNAPSHOT_WAITING_DS_DESPITE_DOCS")
    );
    assert.ok(report.criticalDivergenceCount > 0);
  });

  it("OP direta e vínculo ambíguo", () => {
    const report = buildOrderOperationalLinkageReport({
      requestedOrder: "PD02757",
      order: {
        salesOrderId: ORDER_ID,
        orderCode: "PD02757",
        externalSalesOrderId: 1,
        status: "OPEN",
        totalNetValue: 10,
      },
      items: [
        {
          salesOrderItemId: ITEM_A,
          sequence: "00010",
          sku: null,
          productName: null,
          externalProductId: 1,
          orderedQuantity: 10,
          cutQuantity: 0,
          canceledQuantity: 0,
          fulfilledQuantity: 0,
          activeObligationQuantity: 10,
          documentedQuantity: 0,
          invoicedQuantity: 0,
          shippedQuantity: 0,
          productionCoveredQuantity: 10,
          calculatedStage: "WAITING_OUTPUT_DOCUMENT",
          persistedStage: "WAITING_OUTPUT_DOCUMENT",
          productionLinks: [
            {
              productionOrderExternalId: 55,
              linkedQuantity: "10.00",
              isCurrent: true,
              sourceType: "PRODUCTION_ORDER_REFERENCE",
              usedByKanban: true,
            },
          ],
          documents: [],
          nfes: [],
        },
      ],
      candidateProductionOrders: [
        {
          productionOrderExternalId: 55,
          linkedQuantity: "10.00",
          isCurrent: true,
          salesOrderItemId: ITEM_A,
          sourceType: "PRODUCTION_ORDER_REFERENCE",
          usedByKanban: true,
        },
      ],
      candidateDocuments: [],
      salesOrderNfeLinks: [],
      nfes: [],
      calculatedStage: "WAITING_OUTPUT_DOCUMENT",
      persistedStage: "WAITING_OUTPUT_DOCUMENT",
      calculatedFingerprint: "x",
      persistedFingerprint: "x",
      extraObservations: [
        {
          kind: "AMBIGUOUS_LINK",
          code: "AMBIGUOUS_NFE_NUMBER",
          detail: "ambíguo",
          salesOrderItemId: null,
          entityType: "NFE",
          entityId: null,
          sourceType: "AMBIGUOUS",
        },
      ],
    });
    assert.equal(report.linkedProductionOrders[0]!.productionOrderExternalId, 55);
    assert.ok(report.observations.some((o) => o.kind === "AMBIGUOUS_LINK"));
  });

  it("DS candidato não utilizado gera observação crítica", () => {
    const report = buildOrderOperationalLinkageReport({
      requestedOrder: "PD02757",
      order: {
        salesOrderId: ORDER_ID,
        orderCode: "PD02757",
        externalSalesOrderId: 1,
        status: "OPEN",
        totalNetValue: 1,
      },
      items: [
        {
          salesOrderItemId: ITEM_A,
          sequence: "00010",
          sku: null,
          productName: null,
          externalProductId: 1,
          orderedQuantity: 10,
          cutQuantity: 0,
          canceledQuantity: 0,
          fulfilledQuantity: 0,
          activeObligationQuantity: 10,
          documentedQuantity: 0,
          invoicedQuantity: 0,
          shippedQuantity: 0,
          productionCoveredQuantity: 0,
          calculatedStage: "WAITING_OUTPUT_DOCUMENT",
          persistedStage: "WAITING_OUTPUT_DOCUMENT",
          productionLinks: [],
          documents: [],
          nfes: [],
        },
      ],
      candidateProductionOrders: [],
      candidateDocuments: [
        {
          stockDocumentExternalId: 4525,
          documentNumber: "4525",
          idNfe: 9001,
          isCancelled: false,
          totalValue: null,
          statusRaw: null,
          discoveryPath: "DS_ID_NFE_VIA_NFE_NUMBER_FROM_LINK",
          usedByKanban: false,
          sourceType: "NFE_REFERENCE",
          lines: [],
        },
      ],
      salesOrderNfeLinks: [
        {
          id: "l1",
          nfeExternalId: 9001,
          nfeNumber: "7394",
          nfeSerie: "2",
          nfeStatus: 100,
          nomusNfeId: null,
        },
      ],
      nfes: [],
      calculatedStage: "WAITING_OUTPUT_DOCUMENT",
      persistedStage: "WAITING_OUTPUT_DOCUMENT",
      calculatedFingerprint: null,
      persistedFingerprint: null,
    });
    assert.ok(report.observations.some((o) => o.code === "DS_VALID_NOT_RECOGNIZED"));
    assert.ok(report.observations.some((o) => o.kind === "CANDIDATE_UNUSED"));
    assert.ok(report.criticalDivergenceCount >= 1);
  });
});

describe("salesOrderOperationalLinkageAudit — massa e output", () => {
  it("classifica achados em massa", () => {
    const findings = classifyMassLinkageFindings({
      salesOrderId: ORDER_ID,
      orderCode: "PD02757",
      calculatedStage: "SHIPPED_COMPLETED",
      persistedStage: "WAITING_PRODUCTION_ORDER",
      hasValidDocumentInPack: true,
      hasValidNfeInPack: true,
      hasSalesOrderNfeLink: false,
      hasValidNfeCandidateWithoutLink: true,
      hasUnusedValidDocumentCandidate: true,
      hasCurrentProductionLink: false,
      hasProductionCandidateWithoutLink: true,
      documentedExceedsObligation: true,
      documentOrderLevelOnly: true,
      ambiguousLinkCount: 1,
      orphanLinkCount: 1,
      duplicateExternalIdCount: 0,
      invalidUuidCount: 0,
    });
    const kinds = new Set(findings.map((f) => f.kind));
    assert.ok(kinds.has("DS_VALID_NOT_RECOGNIZED"));
    assert.ok(kinds.has("NFE_VALID_WITHOUT_LINK"));
    assert.ok(kinds.has("SNAPSHOT_WAITING_OP_DESPITE_LATER"));
    assert.ok(kinds.has("OP_WITHOUT_LINK"));
  });

  it("modo sem output não escreve arquivos; com output grava só formatos pedidos", () => {
    const none = resolveOperationalLinkageAuditOutputFiles({
      outputDir: null,
      emitJson: true,
      emitMarkdown: true,
      stamp: "t",
    });
    assert.equal(none.writeFiles, false);

    const dir = mkdtempSync(join(tmpdir(), "op-link-audit-"));
    try {
      const paths = resolveOperationalLinkageAuditOutputFiles({
        outputDir: dir,
        emitJson: true,
        emitMarkdown: false,
        stamp: "t1",
      });
      assert.equal(paths.writeFiles, true);
      assert.ok(paths.jsonPath);
      assert.equal(paths.markdownPath, null);
      writeFileSync(paths.jsonPath!, '{"ok":true}\n', "utf8");
      assert.equal(readFileSync(paths.jsonPath!, "utf8").includes('"ok"'), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("working tree permanece limpo ao gravar em pasta temporária", () => {
    const dir = mkdtempSync(join(tmpdir(), "op-link-wt-"));
    try {
      const report: SalesOrderOperationalLinkageAuditReport = {
        ok: true,
        mode: "READ_ONLY",
        auditMode: "ORDER",
        generatedAt: new Date().toISOString(),
        guarantees: {
          databaseWrites: false,
          nomusCalls: false,
          passwordExposed: false,
          writesOnlyAuditOutputFiles: true,
        },
        filters: {
          order: "PD02757",
          limit: null,
          outputDir: dir,
          emitJson: true,
          emitMarkdown: true,
        },
        orderReport: buildOrderOperationalLinkageReport({
          requestedOrder: "PD02757",
          order: null,
          items: [],
          candidateProductionOrders: [],
          candidateDocuments: [],
          salesOrderNfeLinks: [],
          nfes: [],
          calculatedStage: null,
          persistedStage: null,
          calculatedFingerprint: null,
          persistedFingerprint: null,
        }),
        mass: null,
        summary: "test",
      };
      const paths = resolveOperationalLinkageAuditOutputFiles({
        outputDir: dir,
        emitJson: true,
        emitMarkdown: true,
        stamp: "wt",
      });
      writeFileSync(paths.jsonPath!, stringifyOperationalLinkageAuditReport(report));
      writeFileSync(paths.markdownPath!, formatOperationalLinkageAuditMarkdown(report));
      const status = execSync("git status --porcelain", {
        encoding: "utf8",
        cwd: process.cwd(),
      });
      assert.equal(
        status.includes("operational-linkage-audit-wt"),
        false,
        "arquivos de auditoria fora do repo não devem sujar git status"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("salesOrderOperationalLinkageAudit — loader e read-only", () => {
  it("loader: pedido inexistente sem throw", async () => {
    const prisma = {
      salesOrder: {
        findFirst: async () => null,
      },
    };
    const report = await loadSalesOrderOperationalLinkageOrderAudit(
      prisma as never,
      "PD09999"
    );
    assert.equal(report.orderFound, false);
  });

  it("fontes do auditor não usam writes/Nomus/recompute", () => {
    const roots = [
      "src/lib/sales/salesOrderOperationalLinkageAudit.ts",
      "src/lib/sales/salesOrderOperationalLinkageAudit.server.ts",
      "scripts/auditSalesOrderOperationalLinks.ts",
    ];
    for (const rel of roots) {
      const source = readFileSync(join(process.cwd(), rel), "utf8");
      const violations = scanSalesOrderOperationalLinkageAuditSource(source);
      assert.deepEqual(
        violations,
        [],
        `${rel} violou read-only: ${JSON.stringify(violations)}`
      );
    }
    assert.ok(
      scanSalesOrderOperationalLinkageAuditSource(
        "await prisma.salesOrder.update({ where: { id: 'x' }, data: {} });"
      ).length > 0
    );
    assert.ok(
      scanSalesOrderOperationalLinkageAuditSource(
        "await fetchNomus('/x')"
      ).length > 0
    );
  });
});
