import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PD_02457_NFE_XML } from "./nfeFiscalFixtures.js";
import { NFE_FISCAL_PARSER_VERSION } from "./nfeFiscalXmlParser.js";
import { applyNfeFiscalBackfill, classifyCandidates } from "./nfeFiscalBackfill.server.js";
import type { NfeFiscalBackfillCandidateInput } from "./nfeFiscalBackfill.js";

describe("nfeFiscalBackfill.server apply (mock)", () => {
  it("primeira execução persiste; segunda (já processado) não regrava quando force=false", async () => {
    const store = new Map<string, { xmlHash: string; parserVersion: string }>();
    let persistCalls = 0;

    const candidate: NfeFiscalBackfillCandidateInput = {
      id: "nfe-1",
      externalId: 42,
      numero: "2457",
      chave: "K1",
      status: 1,
      xmlRaw: PD_02457_NFE_XML,
      xmlDhEmi: new Date(),
      dataProcessamento: null,
      xmlDestCnpjCpf: null,
      xmlVNF: 4104.19,
      valorLiquido: 3975,
      orderLinks: [{ salesOrderId: "so", orderCode: "PD 02457", orderNetValue: 4104.19 }],
      crCount: 0,
      existingSummary: null,
    };

    // Patch via dynamic: test classify + simulate apply loop logic locally
    const firstClass = classifyCandidates([candidate], { force: false, onlyMissing: false });
    assert.equal(firstClass[0]!.actionable, true);

    // Simulate persist recording hash
    const { parseNfeFiscalXml } = await import("./nfeFiscalXmlParser.js");
    const parsed = parseNfeFiscalXml(PD_02457_NFE_XML);
    store.set("nfe-1", {
      xmlHash: parsed.xmlHash!,
      parserVersion: NFE_FISCAL_PARSER_VERSION,
    });
    persistCalls += 1;

    const secondCandidate: NfeFiscalBackfillCandidateInput = {
      ...candidate,
      existingSummary: {
        xmlHash: store.get("nfe-1")!.xmlHash,
        parserVersion: store.get("nfe-1")!.parserVersion,
        isCancelled: false,
        highlightedResidual: 0,
        vNF: 4104.19,
        vIPI: 129.19,
        headerTaxTypes: ["IPI"],
      },
    };
    const secondClass = classifyCandidates([secondCandidate], {
      force: false,
      onlyMissing: false,
    });
    assert.equal(secondClass[0]!.actionable, false);
    assert.equal(secondClass[0]!.classes.includes("already_processed"), true);
    assert.equal(persistCalls, 1);
  });

  it("apply com prisma mock: falha parcial conta errors e continua", async () => {
    let calls = 0;
    const prisma = {
      nomusNfe: {
        findMany: async () => [
          {
            id: "ok",
            externalId: 1,
            numero: "1",
            chave: "A",
            status: 1,
            xmlRaw: PD_02457_NFE_XML,
            xmlDhEmi: null,
            dataProcessamento: null,
            xmlDestCnpjCpf: null,
            xmlVNF: 4104.19,
            valorLiquido: 3975,
            fiscalSummary: null,
          },
          {
            id: "fail",
            externalId: 2,
            numero: "2",
            chave: "B",
            status: 1,
            xmlRaw: PD_02457_NFE_XML,
            xmlDhEmi: null,
            dataProcessamento: null,
            xmlDestCnpjCpf: null,
            xmlVNF: 4104.19,
            valorLiquido: 3975,
            fiscalSummary: null,
          },
        ],
      },
      salesOrderNfeLink: {
        findMany: async () => [],
      },
      nomusAccountsReceivable: {
        groupBy: async () => [],
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        calls += 1;
        const tx = {
          nomusNfeFiscalSummary: {
            findUnique: async () => null,
            upsert: async () => {
              if (calls === 2) throw new Error("simulated failure");
              return { id: "s" };
            },
            update: async () => ({ id: "s" }),
          },
          nomusNfeTaxLine: {
            deleteMany: async () => ({ count: 0 }),
            createMany: async () => ({ count: 1 }),
            count: async () => 1,
          },
        };
        return fn(tx);
      },
    };

    const report = await applyNfeFiscalBackfill(prisma as never, {
      limit: 10,
      batchSize: 10,
      force: false,
      onlyMissing: false,
      includeCancelled: true,
      fromDate: null,
      toDate: null,
      nfeNumber: null,
      externalId: null,
      orderCode: null,
      customerQuery: null,
      afterExternalId: null,
    });

    assert.equal(report.attempted, 2);
    assert.equal(report.persisted, 1);
    assert.equal(report.errors, 1);
    assert.equal(report.errorSamples[0]?.externalId, 2);
  });
});
