import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS,
  AUDIT_OUTPUT_DOCUMENTS_DB_FORBIDDEN_WRITE_PATTERNS,
  buildAuditResult,
  buildEmptyAuditSections,
  buildEmptyStageInventory,
  buildFieldCoverageStat,
  computeCoveragePercent,
  disconnectPrismaSafe,
  formatAuditOutputDocumentsDbMarkdown,
  formatCoveragePercent,
  formatDatabaseUnavailableMessage,
  isDatabaseUnavailableError,
  parseAuditOutputDocumentsDbArgs,
  readDatabaseUrlSafe,
  resolveDefaultOutputPaths,
  sanitizeDatabaseUrl,
} from "./auditOutputDocumentsDb.js";
import {
  buildDocumentFieldCoverage,
  buildItemFieldCoverage,
} from "./auditOutputDocumentsDbInventory.server.js";
import {
  accumulateRawJsonKeysFromPayload,
  buildPaymentTermsEvidence,
  buildRawJsonKeysSection,
  createRawJsonKeyAccumulatorMap,
  finalizeRawJsonKeyMatrix,
} from "./auditOutputDocumentsRawJson.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(
  HERE,
  "..",
  "..",
  "..",
  "scripts",
  "auditOutputDocumentsDb.ts"
);
const INVENTORY_SERVER_PATH = join(
  HERE,
  "auditOutputDocumentsDbInventory.server.ts"
);
const RAWJSON_SERVER_PATH = join(
  HERE,
  "auditOutputDocumentsRawJson.server.ts"
);

describe("parseAuditOutputDocumentsDbArgs", () => {
  it("aplica valores padrão quando argv está vazio", () => {
    const options = parseAuditOutputDocumentsDbArgs([]);
    assert.equal(options.document, AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.document);
    assert.equal(options.order, AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.order);
    assert.equal(options.nfe, AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.nfe);
    assert.equal(
      options.sampleLimit,
      AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.sampleLimit
    );
    assert.equal(
      options.jsonOutput,
      AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.jsonOutput
    );
    assert.equal(
      options.markdownOutput,
      AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.markdownOutput
    );
  });

  it("parseia argumentos nomeados", () => {
    const options = parseAuditOutputDocumentsDbArgs([
      "--document=9001",
      "--order=PD02139",
      "--nfe=6937",
      "--sample-limit=5",
      "--json-output=tmp/out.json",
      "--markdown-output=tmp/out.md",
    ]);
    assert.deepEqual(options, {
      document: 9001,
      order: "PD02139",
      nfe: 6937,
      sampleLimit: 5,
      jsonOutput: "tmp/out.json",
      markdownOutput: "tmp/out.md",
    });
  });

  it("rejeita inteiros inválidos", () => {
    assert.throws(
      () => parseAuditOutputDocumentsDbArgs(["--document=0"]),
      /--document inválido/
    );
    assert.throws(
      () => parseAuditOutputDocumentsDbArgs(["--nfe=abc"]),
      /--nfe inválido/
    );
    assert.throws(
      () => parseAuditOutputDocumentsDbArgs(["--sample-limit=-1"]),
      /--sample-limit inválido/
    );
  });
});

describe("sanitizeDatabaseUrl / readDatabaseUrlSafe", () => {
  it("sanitiza host, porta e database sem usuário/senha", () => {
    const sanitized = sanitizeDatabaseUrl(
      "postgresql://auditor_user:s3cret@db.example.com:5432/induscost_prod?sslmode=require"
    );
    assert.ok(sanitized);
    assert.equal(sanitized!.host, "db.example.com");
    assert.equal(sanitized!.port, "5432");
    assert.equal(sanitized!.database, "induscost_prod");
    assert.equal(
      sanitized!.display,
      "postgresql://db.example.com:5432/induscost_prod"
    );
    assert.ok(!sanitized!.display.includes("auditor_user"));
    assert.ok(!sanitized!.display.includes("s3cret"));
  });

  it("não inclui credenciais mesmo quando a senha tem caracteres especiais", () => {
    const sanitized = sanitizeDatabaseUrl(
      "postgresql://u:p%40ss@localhost:5432/mydb"
    );
    assert.ok(sanitized);
    assert.equal(sanitized!.display, "postgresql://localhost:5432/mydb");
    assert.ok(!sanitized!.display.includes("p%40ss"));
    assert.ok(!sanitized!.display.includes("@ss"));
  });

  it("retorna erro claro quando DATABASE_URL está ausente", () => {
    const missing = readDatabaseUrlSafe({});
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.match(missing.error, /DATABASE_URL ausente/);

    const empty = readDatabaseUrlSafe({ DATABASE_URL: "   " });
    assert.equal(empty.ok, false);
  });

  it("aceita URL válida sem logar a URL completa", () => {
    const ok = readDatabaseUrlSafe({
      DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/induscost",
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    const sanitized = sanitizeDatabaseUrl(ok.url);
    assert.equal(sanitized?.display, "postgresql://127.0.0.1:5432/induscost");
  });
});

describe("resolveDefaultOutputPaths", () => {
  it("expõe caminhos padrão documentados", () => {
    assert.deepEqual(resolveDefaultOutputPaths(), {
      jsonOutput: "docs/output-documents/audit-output-documents-db.json",
      markdownOutput: "docs/output-documents/audit-output-documents-db.md",
    });
  });
});

describe("cobertura e percentuais", () => {
  it("calcula percentual com 2 casas e formata n/a", () => {
    assert.equal(computeCoveragePercent(0, 0), 0);
    assert.equal(computeCoveragePercent(1, 4), 25);
    assert.equal(computeCoveragePercent(2, 3), 66.67);
    assert.equal(computeCoveragePercent(3, 3), 100);
    assert.equal(formatCoveragePercent(66.67), "66.67%");
    assert.equal(formatCoveragePercent(null), "n/a");
  });

  it("monta FieldCoverageStat para campo presente e ausente no schema", () => {
    const present = buildFieldCoverageStat({
      field: "idNfe",
      model: "NomusStockDocument",
      presentInSchema: true,
      total: 100,
      filled: 80,
    });
    assert.equal(present.nullCount, 20);
    assert.equal(present.coveragePercent, 80);
    assert.equal(present.presentInSchema, true);

    const absent = buildFieldCoverageStat({
      field: "productCode",
      model: "NomusStockDocumentItem",
      presentInSchema: false,
      total: 0,
      filled: 0,
    });
    assert.equal(absent.coveragePercent, null);
    assert.equal(absent.presentInSchema, false);
    assert.match(String(absent.notes), /não existe/i);
  });

  it("monta fieldCoverage e itemCoverage a partir de agregados", () => {
    const fieldCoverage = buildDocumentFieldCoverage(10, {
      externalId: 10,
      idNfe: 7,
      tipoDocumentoEstoque: 10,
      dataDocumento: 9,
      rawJson: 10,
      syncedAt: 10,
      createdAt: 10,
      updatedAt: 10,
    });
    const idNfe = fieldCoverage.find((row) => row.field === "idNfe");
    assert.ok(idNfe);
    assert.equal(idNfe!.filled, 7);
    assert.equal(idNfe!.nullCount, 3);
    assert.equal(idNfe!.coveragePercent, 70);

    const itemCoverage = buildItemFieldCoverage(20, {
      stockDocumentId: 20,
      externalItemId: 18,
      externalProductId: 15,
      quantity: 20,
      unitValue: 20,
      estimatedTotalValue: 20,
      rawJson: 20,
      createdAt: 20,
      updatedAt: 20,
    });
    const product = itemCoverage.find((row) => row.field === "externalProductId");
    assert.ok(product);
    assert.equal(product!.nullCount, 5);
    assert.equal(product!.coveragePercent, 75);

    const code = itemCoverage.find((row) => row.field === "productCode");
    const description = itemCoverage.find(
      (row) => row.field === "productDescription"
    );
    assert.equal(code?.presentInSchema, false);
    assert.equal(description?.presentInSchema, false);
  });
});

describe("estrutura básica do resultado", () => {
  it("monta contrato com inventory, fieldCoverage, itemCoverage, rawJsonKeys e paymentTermsEvidence", () => {
    const startedAt = new Date("2026-07-16T12:00:00.000Z");
    const finishedAt = new Date("2026-07-16T12:00:01.250Z");
    const options = parseAuditOutputDocumentsDbArgs([]);
    const inventory = buildEmptyStageInventory();
    inventory.documents.total = 3;
    inventory.documents.documentoSaida = 2;
    inventory.documents.otherTypes = 1;
    inventory.items.total = 5;
    inventory.items.withoutProduct = 1;

    const acc = createRawJsonKeyAccumulatorMap();
    accumulateRawJsonKeysFromPayload(acc, {
      idNfe: 7208,
      condicaoPagamento: { parcelas: [{ valor: "1,00" }] },
    });
    const rawRows = finalizeRawJsonKeyMatrix(acc, 1);

    const sections = buildEmptyAuditSections();
    sections.inventory = inventory;
    sections.fieldCoverage = buildDocumentFieldCoverage(3, {
      externalId: 3,
      idNfe: 2,
      tipoDocumentoEstoque: 3,
      dataDocumento: 3,
      rawJson: 3,
      syncedAt: 3,
      createdAt: 3,
      updatedAt: 3,
    });
    sections.itemCoverage = buildItemFieldCoverage(5, {
      stockDocumentId: 5,
      externalItemId: 5,
      externalProductId: 4,
      quantity: 5,
      unitValue: 5,
      estimatedTotalValue: 5,
      rawJson: 5,
      createdAt: 5,
      updatedAt: 5,
    });
    sections.rawJsonKeys = buildRawJsonKeysSection({
      sampleSize: 1,
      documentsScanned: 1,
      itemsScanned: 0,
      maxDepth: 8,
      rows: rawRows,
    });
    sections.paymentTermsEvidence = buildPaymentTermsEvidence(rawRows, 1);

    const result = buildAuditResult({
      startedAt,
      finishedAt,
      options,
      database: sanitizeDatabaseUrl(
        "postgresql://u:p@localhost:5432/induscost"
      ),
      status: "ok",
      mode: "rawjson-sample",
      sections,
    });

    assert.equal(result.meta.mode, "rawjson-sample");
    assert.equal(result.meta.readOnly, true);
    assert.equal(result.meta.durationMs, 1250);
    assert.ok(result.sections.inventory);
    assert.equal(result.sections.inventory!.documents.total, 3);
    assert.ok(result.sections.fieldCoverage.length > 0);
    assert.ok(result.sections.itemCoverage.length > 0);
    assert.ok(result.sections.rawJsonKeys);
    assert.ok(result.sections.paymentTermsEvidence);
    assert.equal(result.sections.paymentTermsEvidence!.hypothesisOnly, true);

    const markdown = formatAuditOutputDocumentsDbMarkdown(result);
    assert.match(markdown, /Inventory/);
    assert.match(markdown, /Field coverage/);
    assert.match(markdown, /Item coverage/);
    assert.match(markdown, /rawJsonKeys/);
    assert.match(markdown, /paymentTermsEvidence/);
    assert.match(markdown, /DocumentoSaida/);
    assert.match(markdown, /idNfe/);
    assert.match(markdown, /productCode/);
    assert.match(markdown, /rawjson-sample/);
    assert.ok(!markdown.includes("12345678000190"));
  });
});

describe("banco indisponível e desconexão", () => {
  it("classifica erros de indisponibilidade e formata mensagem clara", () => {
    assert.equal(
      isDatabaseUnavailableError(
        Object.assign(new Error("Can't reach database server at `localhost:5432`"), {
          name: "PrismaClientInitializationError",
        })
      ),
      true
    );
    assert.equal(
      isDatabaseUnavailableError(new Error("P1001: Can't reach database server")),
      true
    );
    assert.equal(
      isDatabaseUnavailableError(new Error("validation failed")),
      false
    );

    const message = formatDatabaseUnavailableMessage(
      sanitizeDatabaseUrl("postgresql://u:p@db.host:5432/app")
    );
    assert.match(message, /indisponível/);
    assert.match(message, /db\.host:5432\/app/);
    assert.ok(!message.includes("postgresql://u:p@"));
  });

  it("desconecta o Prisma mesmo em erro", async () => {
    let disconnectCalls = 0;
    const prisma = {
      $disconnect: async () => {
        disconnectCalls += 1;
      },
    };

    await disconnectPrismaSafe(prisma);
    assert.equal(disconnectCalls, 1);

    await disconnectPrismaSafe({
      $disconnect: async () => {
        disconnectCalls += 1;
        throw new Error("disconnect failed");
      },
    });
    assert.equal(disconnectCalls, 2);

    await disconnectPrismaSafe(null);
    await disconnectPrismaSafe(undefined);
    assert.equal(disconnectCalls, 2);
  });
});

describe("garantia read-only", () => {
  it("não contém operações de escrita Prisma no runner nem nos loaders", () => {
    for (const path of [SCRIPT_PATH, INVENTORY_SERVER_PATH, RAWJSON_SERVER_PATH]) {
      const source = readFileSync(path, "utf8");
      for (const pattern of AUDIT_OUTPUT_DOCUMENTS_DB_FORBIDDEN_WRITE_PATTERNS) {
        assert.equal(
          pattern.test(source),
          false,
          `padrão de escrita proibido em ${path}: ${pattern}`
        );
      }
    }
    const script = readFileSync(SCRIPT_PATH, "utf8");
    assert.match(script, /disconnectPrismaSafe/);
    assert.match(script, /loadStageInventoryAndCoverage/);
    assert.match(script, /loadRawJsonSampleAnalysis/);
  });
});
