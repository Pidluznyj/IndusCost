import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildSalesOrderTaxesAuditReport,
  maskFiscalIdentifier,
  normalizeSalesOrderAuditCode,
  parseSalesOrderTaxesAuditArgs,
  resolveSalesOrderTaxesAuditExitCode,
  salesOrderAuditCodeCandidates,
  sanitizeSalesOrderTaxesDatabaseUrl,
  scanSalesOrderTaxesAuditSource,
  type SalesOrderTaxesAuditInput,
} from "./salesOrderTaxesAudit.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

describe("TRIB-07 — argumentos", () => {
  it("aceita --order=PD02781 e normaliza espaço", () => {
    assert.deepEqual(parseSalesOrderTaxesAuditArgs(["--order=PD02781"]), {
      order: "PD02781",
    });
    assert.equal(normalizeSalesOrderAuditCode("pd 02781"), "PD02781");
    assert.deepEqual(salesOrderAuditCodeCandidates("PD02781"), [
      "PD02781",
      "PD 02781",
    ]);
  });

  it("rejeita order ausente, formato inválido e argumento desconhecido", () => {
    assert.throws(() => parseSalesOrderTaxesAuditArgs([]), /--order é obrigatório/);
    assert.throws(
      () => parseSalesOrderTaxesAuditArgs(["--order=02781"]),
      /--order inválido/
    );
    assert.throws(
      () => parseSalesOrderTaxesAuditArgs(["--order=PD02781", "--apply"]),
      /argumento desconhecido/
    );
  });
});

describe("TRIB-07 — sanitização e exit code", () => {
  it("não expõe usuário, senha nem query da DATABASE_URL", () => {
    const raw =
      "postgresql://audit_user:p%40ssword@db.example.com:5432/induscost?sslmode=require";
    const safe = sanitizeSalesOrderTaxesDatabaseUrl(raw);
    assert.ok(safe);
    assert.equal(safe!.display, "postgresql://db.example.com:5432/induscost");
    assert.doesNotMatch(safe!.display, /audit_user|p%40ssword|sslmode/i);
  });

  it("mascara chave fiscal e limita ausência", () => {
    assert.equal(
      maskFiscalIdentifier("35260712345678000199550010000027811000027810"),
      "3526…7810"
    );
    assert.equal(maskFiscalIdentifier(null), null);
  });

  it("exit code diferente de zero apenas em falha técnica", () => {
    assert.equal(resolveSalesOrderTaxesAuditExitCode("ok"), 0);
    assert.equal(resolveSalesOrderTaxesAuditExitCode("order_not_found"), 0);
    assert.notEqual(resolveSalesOrderTaxesAuditExitCode("technical_error"), 0);
  });
});

describe("TRIB-07 — ausência do pedido", () => {
  it("gera relatório unavailable, sem tratar ausência como falha técnica", () => {
    const report = buildSalesOrderTaxesAuditReport({
      requestedOrder: "PD02781",
      order: null,
      links: [],
      o2cFacts: [],
      stockDocuments: [],
      items: [],
      foreignLinks: [],
      nfes: [],
    });
    assert.equal(report.orderFound, false);
    assert.equal(report.status, "unavailable");
    assert.match(report.exactUnavailableReason ?? "", /não localizado/);
    assert.equal(report.counts.uniqueNfes, 0);
    assert.equal(report.guarantees.databaseWrites, false);
    assert.equal(report.guarantees.nomusCalls, false);
  });

  it("vínculo sem NomusNfe local permanece unavailable com motivo exato", () => {
    const report = buildSalesOrderTaxesAuditReport({
      requestedOrder: "PD02781",
      order: {
        id: "so-1",
        orderCode: "PD02781",
        externalSalesOrderId: 2781,
        externalSalesOrderCode: "PD02781",
      },
      links: [
        {
          id: "link-pending",
          salesOrderId: "so-1",
          orderCode: "PD02781",
          nfeExternalId: 999,
          nfeNumber: "999",
          nfeKey: null,
          nfeStatus: 100,
          presentInLastPayload: true,
        },
      ],
      o2cFacts: [],
      stockDocuments: [],
      items: [],
      foreignLinks: [],
      nfes: [],
    });
    assert.equal(report.status, "unavailable");
    assert.equal(report.counts.validNfes, 0);
    assert.match(report.exactUnavailableReason ?? "", /nenhuma é válida/i);
    assert.ok(report.pendingLinks.some((message) => /NomusNfe local/.test(message)));
  });
});

describe("TRIB-07 — relatório fiscal e deduplicação", () => {
  it("mostra fontes, documento, tributos, duplicidade, pendência e conflito", () => {
    const input: SalesOrderTaxesAuditInput = {
      requestedOrder: "PD02781",
      order: {
        id: "so-1",
        orderCode: "PD 02781",
        externalSalesOrderId: 2781,
        externalSalesOrderCode: "PD02781",
      },
      links: [
        {
          id: "link-1",
          salesOrderId: "so-1",
          orderCode: "PD 02781",
          nfeExternalId: 900,
          nfeNumber: "900",
          nfeKey: "35260712345678000199550010000009001000000900",
          nfeStatus: 100,
          presentInLastPayload: false,
        },
      ],
      o2cFacts: [
        {
          nfeExternalId: 900,
          nfeNumber: "900",
          nfeKey: "35260712345678000199550010000009001000000900",
          stockDocumentExternalId: 700,
          stockDocumentIdNfe: 900,
          stockDocumentType: "DOCUMENTO_SAIDA",
          stockDocumentDate: "2026-07-01T00:00:00.000Z",
          salesOrderItemId: "item-1",
          nfeItemMatchedOrderItem: true,
        },
      ],
      stockDocuments: [
        {
          id: "doc-1",
          externalId: 700,
          idNfe: 900,
          tipoDocumentoEstoque: "DOCUMENTO_SAIDA",
          dataDocumento: "2026-07-01T00:00:00.000Z",
        },
      ],
      items: [],
      foreignLinks: [
        { salesOrderId: "so-2", orderCode: "PD99999", nfeExternalId: 900 },
      ],
      nfes: [
        {
          id: "nfe-1",
          externalId: 900,
          numero: "900",
          serie: "1",
          chave: "35260712345678000199550010000009001000000900",
          status: 100,
          fiscalSummary: {
            source: "XML",
            parserVersion: "test",
            parsedAt: "2026-07-16T00:00:00.000Z",
            isCancelled: false,
            finalidade: 1,
            vProd: 100,
            vDesc: 0,
            vFrete: 10,
            vSeg: 0,
            vOutro: 0,
            vII: null,
            vIPI: 5,
            vIPIDevol: null,
            vBC: 100,
            vICMS: 18,
            vICMSDeson: null,
            vBCST: null,
            vST: null,
            vFCP: null,
            vFCPST: null,
            vFCPSTRet: null,
            vPIS: 1.65,
            vCOFINS: 7.6,
            vISS: null,
            vTotTrib: null,
            vNF: 115,
            highlightedResidual: 0,
            qualityAlert: null,
            taxLines: [
              {
                taxType: "IPI",
                scope: "HEADER",
                amount: 5,
                baseAmount: null,
                rate: null,
              },
            ],
          },
        },
      ],
    };

    const report = buildSalesOrderTaxesAuditReport(input);
    assert.equal(report.orderFound, true);
    assert.equal(report.counts.outputDocuments, 1);
    assert.equal(report.counts.uniqueNfes, 1);
    assert.ok(report.counts.duplicatesEliminated > 0);
    assert.ok(report.nfesBySource.SALES_ORDER_NFE_LINK!.includes(900));
    assert.ok(report.nfesBySource.STOCK_DOCUMENT!.includes(900));
    assert.ok(report.consolidatedTaxes.some((tax) => tax.taxType === "IPI"));
    assert.equal(report.counts.pendingLinks, 1);
    assert.equal(report.counts.conflicts, 1);
    assert.doesNotMatch(JSON.stringify(report), /3526071234567800019955/);
  });
});

describe("TRIB-07 — proteção read-only", () => {
  it("script e loader não contêm escrita Prisma nem chamadas Nomus", () => {
    const files = [
      "scripts/auditSalesOrderTaxes.ts",
      "src/lib/sales-orders/salesOrderTaxesAudit.server.ts",
    ];
    for (const relative of files) {
      const source = readFileSync(join(REPO_ROOT, relative), "utf8");
      assert.deepEqual(
        scanSalesOrderTaxesAuditSource(source),
        [],
        `${relative} deve permanecer read-only`
      );
    }
  });

  it("detector acusa operações de escrita, transação e cliente Nomus", () => {
    const unsafe = `
      prisma.salesOrder.update({ where: { id: "x" }, data: {} });
      prisma.$transaction([]);
      callNomus();
    `;
    assert.equal(scanSalesOrderTaxesAuditSource(unsafe).length, 3);
  });

  it("loader usa select limitado e não consulta payloads/XML sensíveis", () => {
    const source = readFileSync(
      join(
        REPO_ROOT,
        "src/lib/sales-orders/salesOrderTaxesAudit.server.ts"
      ),
      "utf8"
    );
    assert.match(source, /take:\s*SALES_ORDER_TAXES_AUDIT_MAX_ROWS/);
    assert.doesNotMatch(source, /rawPayload:\s*true/);
    assert.doesNotMatch(source, /rawJson:\s*true/);
    assert.doesNotMatch(source, /xmlRaw:\s*true/);
  });
});
