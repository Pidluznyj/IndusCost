import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS,
  buildAuditResult,
  buildEmptyAuditSections,
  buildEmptyStageInventory,
  parseAuditOutputDocumentsDbArgs,
  sanitizeDatabaseUrl,
} from "./auditOutputDocumentsDb.js";
import {
  assertAuditReportMarkdownSections,
  buildAuditReportDocument,
  buildDataQualitySection,
  buildRecommendationSection,
  formatAuditReportCompactSummary,
  formatAuditReportJson,
  formatAuditReportMarkdown,
  sanitizeAuditReportValue,
} from "./auditOutputDocumentsReports.js";
import {
  writeAuditReports,
  writeFileAtomicSync,
} from "./auditOutputDocumentsReports.io.js";
import { buildEmptyExamplesSection } from "./auditOutputDocumentsExamples.js";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "induscost-audit-report-"));
  tempRoots.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function sampleResult() {
  const startedAt = new Date("2026-07-16T21:00:00.000Z");
  const finishedAt = new Date("2026-07-16T21:00:02.000Z");
  const sections = buildEmptyAuditSections();
  sections.inventory = buildEmptyStageInventory();
  sections.inventory.documents.total = 10;
  sections.examples = buildEmptyExamplesSection();
  sections.notes = ["nota de teste"];
  sections.counts = {
    documentsWithoutIdNfe: 1,
    nfeMissingLocally: 0,
    unallocatedDocuments: 2,
    exampleDocumentFound: false,
    exampleOrderFound: true,
    exampleNfeFound: false,
  };
  sections.fieldCoverage = [
    {
      field: "idNfe",
      model: "NomusStockDocument",
      presentInSchema: true,
      total: 10,
      filled: 5,
      nullCount: 5,
      coveragePercent: 50,
      notes: null,
    },
  ];
  return buildAuditResult({
    startedAt,
    finishedAt,
    options: parseAuditOutputDocumentsDbArgs([]),
    database: sanitizeDatabaseUrl("postgresql://u:p@localhost:5432/induscost"),
    status: "ok",
    mode: "examples-audit",
    sections,
  });
}

describe("sanitizeAuditReportValue", () => {
  it("mascara CPF/CNPJ em estruturas aninhadas", () => {
    const sanitized = sanitizeAuditReportValue({
      cliente: "123.456.789-09",
      empresa: { cnpj: "12.345.678/0001-90" },
      lista: ["12345678000190"],
    }) as {
      cliente: string;
      empresa: { cnpj: string };
      lista: string[];
    };
    assert.ok(!JSON.stringify(sanitized).includes("123.456.789-09"));
    assert.ok(!JSON.stringify(sanitized).includes("12345678000190"));
    assert.ok(sanitized.cliente.includes("*"));
  });
});

describe("dataQuality e recommendation", () => {
  it("deriva dataQuality e recommendation sem inventar DB", () => {
    const result = sampleResult();
    const dq = buildDataQualitySection(result);
    assert.equal(dq.status, "degraded");
    assert.ok(dq.coverage.lowCoverageDocumentFields.includes("idNfe"));
    assert.equal(dq.linkHealth.unallocatedDocuments, 2);
    const rec = buildRecommendationSection(dq);
    assert.equal(rec.priority, "medium");
    assert.ok(rec.actions.length > 0);
  });
});

describe("buildAuditReportDocument + markdown/json", () => {
  it("monta JSON valido com secoes obrigatorias e Markdown valido", () => {
    const report = buildAuditReportDocument(sampleResult());
    const jsonText = formatAuditReportJson(report);
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    for (const key of [
      "metadata",
      "inventory",
      "fieldCoverage",
      "itemCoverage",
      "rawJsonKeys",
      "nfeLinks",
      "salesOrderLinks",
      "allocations",
      "accountsReceivableLinks",
      "paymentTermsEvidence",
      "dataQuality",
      "examples",
      "recommendation",
    ]) {
      assert.ok(key in parsed, `missing ${key}`);
    }

    const md = formatAuditReportMarkdown(report);
    assert.equal(assertAuditReportMarkdownSections(md).length, 0);
    assert.match(md, /# Relatório sanitizado/);
  });
});

describe("writeFileAtomicSync e writeAuditReports", () => {
  it("cria arquivos em diretorio inexistente (caminho customizado)", () => {
    const root = makeTempDir();
    const nested = join(root, "a", "b", "c");
    const jsonPath = join(nested, "report.json");
    const mdPath = join(nested, "report.md");

    const written = writeAuditReports({
      result: sampleResult(),
      jsonOutput: jsonPath,
      markdownOutput: mdPath,
      generatedAt: new Date("2026-07-16T22:00:00.000Z"),
    });

    assert.equal(existsSync(written.jsonPath), true);
    assert.equal(existsSync(written.markdownPath), true);
    const json = JSON.parse(readFileSync(written.jsonPath, "utf8"));
    assert.equal(json.metadata.mode, "examples-audit");
    const md = readFileSync(written.markdownPath, "utf8");
    assert.equal(assertAuditReportMarkdownSections(md).length, 0);
    assert.match(written.compactSummary, /status=ok/);
    assert.match(written.compactSummary, /json=/);
  });

  it("escrita atomica sobrescreve arquivo existente", () => {
    const root = makeTempDir();
    const path = join(root, "out.txt");
    writeFileAtomicSync(path, "v1");
    writeFileAtomicSync(path, "v2");
    assert.equal(readFileSync(path, "utf8"), "v2");
  });

  it("falha de escrita com mensagem clara quando caminho e invalido", () => {
    const root = makeTempDir();
    const blocker = join(root, "not-a-dir");
    writeFileSync(blocker, "file", "utf8");
    const badPath = join(blocker, "report.json");
    assert.throws(
      () => writeFileAtomicSync(badPath, "{}"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Falha ao/);
        assert.match(err.message, /report\.json|not-a-dir/);
        return true;
      }
    );
  });
});

describe("defaults e resumo compacto", () => {
  it("defaults apontam para docs/output-documents/audits/", () => {
    assert.match(
      AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.jsonOutput,
      /docs\/output-documents\/audits\/output-documents-db-audit\.json/
    );
    assert.match(
      AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.markdownOutput,
      /docs\/output-documents\/audits\/output-documents-db-audit\.md/
    );
  });

  it("resumo compacto nao dumpa payload completo", () => {
    const report = buildAuditReportDocument(sampleResult());
    const summary = formatAuditReportCompactSummary({
      report,
      jsonPath: "/tmp/a.json",
      markdownPath: "/tmp/a.md",
    });
    assert.ok(!summary.includes("fieldCoverage"));
    assert.ok(summary.length < 800);
  });
});

describe("sanitizacao no relatorio escrito", () => {
  it("nao persiste CPF/CNPJ em claro", () => {
    const root = makeTempDir();
    const result = sampleResult();
    result.sections.notes.push("cliente 123.456.789-09 cnpj 12.345.678/0001-90");
    const written = writeAuditReports({
      result,
      jsonOutput: join(root, "s.json"),
      markdownOutput: join(root, "s.md"),
    });
    const jsonText = readFileSync(written.jsonPath, "utf8");
    const mdText = readFileSync(written.markdownPath, "utf8");
    assert.ok(!jsonText.includes("123.456.789-09"));
    assert.ok(!mdText.includes("12.345.678/0001-90"));
  });
});
