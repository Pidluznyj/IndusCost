import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ORDER_FULL_AUDIT_TABS } from "./orderFullAuditClient.js";
import {
  buildOutputDocumentAuditHref,
  formatOutputDocumentCoverageStatus,
} from "../outputDocumentsUi.js";
import {
  buildOrderFullAuditDocumentHeaderAlertDrafts,
  emptyOrderFullAuditStockDocument,
} from "./orderFullAuditDocuments.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("buildOutputDocumentAuditHref", () => {
  it("prefere documentId UUID no deep link", () => {
    const href = buildOutputDocumentAuditHref({
      stockDocumentId: "uuid-ds-1",
      documentNumber: "DS-99",
      stockDocumentExternalId: 8457,
    });
    assert.equal(href, "/output-documents?documentId=uuid-ds-1");
  });

  it("usa documentNumber ou externalId quando não há UUID", () => {
    assert.equal(
      buildOutputDocumentAuditHref({
        stockDocumentExternalId: 8457,
        documentNumber: "DS-99",
      }),
      "/output-documents?search=DS-99"
    );
    assert.equal(
      buildOutputDocumentAuditHref({ stockDocumentExternalId: 8457 }),
      "/output-documents?search=8457"
    );
  });
});

describe("formatOutputDocumentCoverageStatus", () => {
  it("traduz status de cobertura", () => {
    assert.equal(formatOutputDocumentCoverageStatus("completo"), "Completo");
    assert.equal(formatOutputDocumentCoverageStatus("parcial"), "Parcial");
    assert.equal(
      formatOutputDocumentCoverageStatus("nao_alocado"),
      "Não alocado"
    );
    assert.equal(
      formatOutputDocumentCoverageStatus("superalocado"),
      "Superalocado"
    );
  });
});

describe("emptyOrderFullAuditStockDocument", () => {
  it("preenche todos os campos obrigatórios do contrato DS", () => {
    const doc = emptyOrderFullAuditStockDocument(8457);
    assert.equal(doc.stockDocumentExternalId, 8457);
    assert.equal(doc.stockDocumentId, null);
    assert.equal(doc.documentNumber, null);
    assert.equal(doc.isCancelled, false);
    assert.equal(doc.coverageStatus, null);
    assert.equal(doc.href, "/output-documents?search=8457");
    assert.deepEqual(doc.alerts, []);
    assert.deepEqual(doc.linkedOrders, []);
  });

  it("recalcula href quando recebe stockDocumentId / documentNumber", () => {
    const withId = emptyOrderFullAuditStockDocument(8457, {
      stockDocumentId: "uuid-ds-1",
      documentNumber: "DS-99",
      isCancelled: true,
      alerts: ["DOCUMENT_CANCELLED"],
    });
    assert.equal(withId.href, "/output-documents?documentId=uuid-ds-1");
    assert.equal(withId.isCancelled, true);
    assert.deepEqual(withId.alerts, ["DOCUMENT_CANCELLED"]);
  });

  it("preserva externalId mesmo se partial tentar sobrescrever", () => {
    const doc = emptyOrderFullAuditStockDocument(10, {
      stockDocumentExternalId: 99 as unknown as number,
    });
    assert.equal(doc.stockDocumentExternalId, 10);
  });
});

describe("buildOrderFullAuditDocumentHeaderAlertDrafts", () => {
  it("emite cancelamento e superalocação", () => {
    const drafts = buildOrderFullAuditDocumentHeaderAlertDrafts([
      emptyOrderFullAuditStockDocument(100, {
        documentNumber: "DS-100",
        isCancelled: true,
        idNfe: 50,
        linkOrigin: "ITEM_EVIDENCE",
        coverageStatus: "superalocado",
        overAllocation: 120.5,
        alerts: ["DOCUMENT_CANCELLED", "DOCUMENT_OVER_ALLOCATED"],
      }),
    ]);
    const codes = drafts.map((d) => d.code);
    assert.ok(codes.includes("DOCUMENT_CANCELLED"));
    assert.ok(codes.includes("DOCUMENT_OVER_ALLOCATED"));
    assert.ok(!codes.includes("DOCUMENT_WITHOUT_NFE"));
    const cancelled = drafts.find((d) => d.code === "DOCUMENT_CANCELLED");
    assert.match(cancelled!.description, /DS-100/);
    const over = drafts.find((d) => d.code === "DOCUMENT_OVER_ALLOCATED");
    assert.equal(over!.financialImpact, 120.5);
  });

  it("marca vínculo só por NF (SALES_ORDER_NFE_LINK) e sem NF", () => {
    const drafts = buildOrderFullAuditDocumentHeaderAlertDrafts([
      emptyOrderFullAuditStockDocument(200, {
        linkOrigin: "SALES_ORDER_NFE_LINK",
        idNfe: null,
      }),
    ]);
    const codes = drafts.map((d) => d.code);
    assert.ok(codes.includes("DOCUMENT_ALLOCATED_BY_HEADER_ONLY"));
    assert.ok(codes.includes("DOCUMENT_WITHOUT_NFE"));
  });

  it("não inventa alerta em documento limpo e completo", () => {
    const drafts = buildOrderFullAuditDocumentHeaderAlertDrafts([
      emptyOrderFullAuditStockDocument(300, {
        idNfe: 77,
        linkOrigin: "ITEM_EVIDENCE",
        coverageStatus: "completo",
        coveragePercent: 100,
      }),
    ]);
    assert.deepEqual(drafts, []);
  });
});

describe("order full audit — contrato DS na 360º", () => {
  it("mantém aba Documentos após Ordens de Produção", () => {
    const ids = ORDER_FULL_AUDIT_TABS.map((tab) => tab.id);
    const productionIdx = ids.indexOf("productionOrders");
    const documentsIdx = ids.indexOf("documents");
    assert.ok(documentsIdx > productionIdx);
  });

  it("dialog e service expõem deep link, cobertura, cancelamento e overlay NF", () => {
    const dialog = read(
      "src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx"
    );
    const service = read("src/lib/finance/orderFullAuditService.ts");
    const client = read("src/lib/finance/orderFullAuditClient.ts");
    const docsHelper = read("src/lib/finance/orderFullAuditDocuments.ts");

    assert.match(dialog, /order-full-audit-documents-tab/);
    assert.match(dialog, /order-full-audit-documents-link-/);
    assert.match(dialog, /order-full-audit-delivery-documents-mini/);
    assert.match(dialog, /formatOutputDocumentCoverageStatus/);
    assert.match(dialog, /DOCUMENT_CANCELLED/);

    assert.match(client, /stockDocumentId: string \| null/);
    assert.match(client, /documentNumber: string \| null/);
    assert.match(client, /isCancelled: boolean/);
    assert.match(client, /href: string/);

    assert.match(service, /buildOutputDocumentAuditHref/);
    assert.match(service, /extractOutputDocumentItemProductIdentity/);
    assert.match(service, /buildOrderFullAuditDocumentHeaderAlertDrafts/);
    assert.match(service, /SALES_ORDER_NFE_LINK/);
    assert.match(service, /emptyStockDocumentEntry|emptyOrderFullAuditStockDocument/);

    assert.match(docsHelper, /DOCUMENT_CANCELLED/);
    assert.match(docsHelper, /DOCUMENT_OVER_ALLOCATED/);
  });
});
