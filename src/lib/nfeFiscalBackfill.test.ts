import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PD_02457_NFE_XML } from "./nfeFiscalFixtures.js";
import { NFE_FISCAL_PARSER_VERSION } from "./nfeFiscalXmlParser.js";
import {
  buildFindingsFromRows,
  classifyNfeFiscalBackfillRow,
  emptyResumeState,
  mergeResumeProgress,
  parseNfeFiscalBackfillCli,
  rowsToCsv,
  summarizeBackfillRows,
  type NfeFiscalBackfillCandidateInput,
} from "./nfeFiscalBackfill.js";

function candidate(
  overrides: Partial<NfeFiscalBackfillCandidateInput> & { xmlRaw?: string | null }
): NfeFiscalBackfillCandidateInput {
  return {
    id: "nfe-1",
    externalId: 1001,
    numero: "2457",
    chave: "CHAVE-A",
    status: 1,
    xmlRaw: PD_02457_NFE_XML,
    xmlDhEmi: new Date("2025-03-10T14:00:00.000Z"),
    dataProcessamento: null,
    xmlDestCnpjCpf: "60878889000128",
    xmlVNF: 4104.19,
    valorLiquido: 3975,
    orderLinks: [
      { salesOrderId: "so-1", orderCode: "PD 02457", orderNetValue: 4104.19 },
    ],
    crCount: 0,
    existingSummary: null,
    ...overrides,
  };
}

describe("nfeFiscalBackfill CLI", () => {
  it("dry-run é default e apply exige confirm-apply", () => {
    const dry = parseNfeFiscalBackfillCli([]);
    assert.equal(dry.mode, "dry-run");
    assert.throws(() => parseNfeFiscalBackfillCli(["--apply"]), /confirm-apply/);
    const apply = parseNfeFiscalBackfillCli(["--apply", "--confirm-apply", "--limit=10"]);
    assert.equal(apply.mode, "apply");
    assert.equal(apply.limit, 10);
    assert.equal(apply.confirmApply, true);
  });

  it("audit e filtros de período/pedido", () => {
    const audit = parseNfeFiscalBackfillCli([
      "--audit",
      "--order=PD 02457",
      "--from=2025-01-01",
      "--to=2025-12-31",
      "--batch=25",
    ]);
    assert.equal(audit.mode, "audit");
    assert.equal(audit.orderCode, "PD 02457");
    assert.equal(audit.fromDate, "2025-01-01");
    assert.equal(audit.batchSize, 25);
  });

  it("rejeita dry-run + apply", () => {
    assert.throws(
      () => parseNfeFiscalBackfillCli(["--dry-run", "--apply", "--confirm-apply"]),
      /apenas/
    );
  });
});

describe("nfeFiscalBackfill classify", () => {
  it("PD 02457 analyzable + watch order + composição IPI", () => {
    const row = classifyNfeFiscalBackfillRow(candidate({}), { force: false, onlyMissing: false });
    assert.ok(row.classes.includes("analyzable"));
    assert.ok(row.classes.includes("needs_persist"));
    assert.equal(row.actionable, true);
    assert.equal(row.watchOrderHit, true);
    assert.equal(row.headerTaxTotals.IPI, 129.19);
    assert.equal(row.taxesWithoutComposition, false);
    assert.equal(row.highlightedResidual, 0);
  });

  it("missing xml", () => {
    const row = classifyNfeFiscalBackfillRow(candidate({ xmlRaw: null }), {
      force: false,
      onlyMissing: false,
    });
    assert.ok(row.classes.includes("missing_xml"));
    assert.equal(row.actionable, false);
  });

  it("already processed mesma versão/hash", () => {
    const first = classifyNfeFiscalBackfillRow(candidate({}), { force: false, onlyMissing: false });
    const row = classifyNfeFiscalBackfillRow(
      candidate({
        existingSummary: {
          xmlHash: first.xmlHash,
          parserVersion: NFE_FISCAL_PARSER_VERSION,
          isCancelled: false,
          highlightedResidual: 0,
          vNF: 4104.19,
          vIPI: 129.19,
          headerTaxTypes: ["IPI"],
        },
      }),
      { force: false, onlyMissing: false }
    );
    assert.ok(row.classes.includes("already_processed"));
    assert.equal(row.actionable, false);
  });

  it("stale parser força reprocessamento", () => {
    const first = classifyNfeFiscalBackfillRow(candidate({}), { force: false, onlyMissing: false });
    const row = classifyNfeFiscalBackfillRow(
      candidate({
        existingSummary: {
          xmlHash: first.xmlHash,
          parserVersion: "nfe-xml-fiscal-v0",
          isCancelled: false,
          highlightedResidual: null,
          vNF: 4104.19,
          vIPI: null,
          headerTaxTypes: [],
        },
      }),
      { force: false, onlyMissing: false }
    );
    assert.ok(row.classes.includes("stale_parser"));
    assert.equal(row.actionable, true);
  });

  it("segunda execução (force=false) após processado = skip", () => {
    const processed = classifyNfeFiscalBackfillRow(candidate({}), {
      force: false,
      onlyMissing: false,
    });
    const again = classifyNfeFiscalBackfillRow(
      candidate({
        existingSummary: {
          xmlHash: processed.xmlHash,
          parserVersion: NFE_FISCAL_PARSER_VERSION,
          isCancelled: false,
          highlightedResidual: 0,
          vNF: 4104.19,
          vIPI: 129.19,
          headerTaxTypes: ["IPI"],
        },
      }),
      { force: false, onlyMissing: false }
    );
    assert.equal(again.action, "skip");
  });

  it("XML inválido", () => {
    const row = classifyNfeFiscalBackfillRow(candidate({ xmlRaw: "<not-nfe>" }), {
      force: false,
      onlyMissing: false,
    });
    assert.ok(row.classes.includes("invalid_xml") || row.action === "inspect" || !row.actionable);
  });

  it("NF > pedido e multi-order e cancelled+CR", () => {
    const row = classifyNfeFiscalBackfillRow(
      candidate({
        status: 7,
        crCount: 2,
        xmlVNF: 5000,
        orderLinks: [
          { salesOrderId: "a", orderCode: "PD 02139", orderNetValue: 1000 },
          { salesOrderId: "b", orderCode: "PD 02072", orderNetValue: 2000 },
        ],
      }),
      { force: false, onlyMissing: false }
    );
    assert.equal(row.multiOrder, true);
    assert.equal(row.nfGreaterThanOrder, true);
    assert.equal(row.cancelledWithCr, true);
    assert.ok(row.watchOrderHit);
  });

  it("impostos sem composição quando residual sem tributos", () => {
    const xml = `<?xml version="1.0"?><NFe><infNFe>
      <total><ICMSTot><vProd>100</vProd><vDesc>0</vDesc><vNF>150</vNF></ICMSTot></total>
    </infNFe></NFe>`;
    const row = classifyNfeFiscalBackfillRow(
      candidate({ xmlRaw: xml, xmlVNF: 150, valorLiquido: 100 }),
      { force: false, onlyMissing: false }
    );
    assert.equal(row.taxesWithoutComposition, true);
    assert.ok((row.highlightedResidual ?? 0) > 0);
  });
});

describe("nfeFiscalBackfill findings + csv + resume", () => {
  it("buildFindings cobre casos de auditoria", () => {
    const rows = [
      classifyNfeFiscalBackfillRow(
        candidate({
          status: 7,
          crCount: 1,
          xmlVNF: 9999,
          orderLinks: [
            { salesOrderId: "a", orderCode: "PD 02457", orderNetValue: 100 },
            { salesOrderId: "b", orderCode: "PD 02139", orderNetValue: 100 },
          ],
        }),
        { force: false, onlyMissing: false }
      ),
    ];
    const findings = buildFindingsFromRows(rows, {
      duplicateChaves: [{ chave: "CHAVE-A", externalIds: [1, 2] }],
    });
    const codes = new Set(findings.map((f) => f.code));
    assert.ok(codes.has("WATCH_ORDER"));
    assert.ok(codes.has("NF_GT_ORDER"));
    assert.ok(codes.has("NF_MULTI_ORDER"));
    assert.ok(codes.has("CANCELLED_WITH_CR"));
    assert.ok(codes.has("DUPLICATE_CHAVE"));
  });

  it("csv e inventory", () => {
    const row = classifyNfeFiscalBackfillRow(candidate({}), { force: false, onlyMissing: false });
    const csv = rowsToCsv([row]);
    assert.match(csv, /externalId/);
    assert.match(csv, /02457|2457/);
    const inv = summarizeBackfillRows([row]);
    assert.equal(inv.scanned, 1);
    assert.ok(inv.analyzable >= 1);
  });

  it("resume merge", () => {
    const a = emptyResumeState();
    const b = mergeResumeProgress(a, {
      lastExternalId: 50,
      processed: 10,
      persisted: 8,
      skipped: 2,
      errors: 0,
    });
    assert.equal(b.lastExternalId, 50);
    assert.equal(b.persisted, 8);
    const c = mergeResumeProgress(b, {
      lastExternalId: 60,
      processed: 5,
      persisted: 5,
      skipped: 0,
      errors: 1,
    });
    assert.equal(c.lastExternalId, 60);
    assert.equal(c.persisted, 13);
    assert.equal(c.errors, 1);
  });
});
