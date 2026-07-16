import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { PD_02457_NFE_XML } from "./nfeFiscalFixtures.js";
import { NFE_FISCAL_PARSER_VERSION } from "./nfeFiscalXmlParser.js";
import {
  isNomusNfeCancelledStatus,
  persistNomusNfeFiscalFromXml,
} from "./nfeFiscalPersist.js";

describe("nfeFiscalPersist — helpers", () => {
  it("status 7 = cancelada", () => {
    assert.equal(isNomusNfeCancelledStatus(7), true);
    assert.equal(isNomusNfeCancelledStatus(1), false);
    assert.equal(isNomusNfeCancelledStatus(null), false);
  });
});

describe("nfeFiscalPersist — persistência com prisma mock", () => {
  it("upsert summary + createMany lines (PD 02457)", async () => {
    const calls: string[] = [];
    let summaryUpserted: Record<string, unknown> | null = null;
    let linesCreated: unknown[] = [];

    const prisma = {
      nomusNfeFiscalSummary: {
        findUnique: async () => null,
        upsert: async (args: { create: Record<string, unknown> }) => {
          calls.push("upsert");
          summaryUpserted = args.create;
          return { id: "summary-1" };
        },
        update: async () => ({ id: "summary-1" }),
      },
      nomusNfeTaxLine: {
        deleteMany: async () => {
          calls.push("deleteMany");
          return { count: 0 };
        },
        createMany: async (args: { data: unknown[] }) => {
          calls.push("createMany");
          linesCreated = args.data;
          return { count: args.data.length };
        },
        count: async () => linesCreated.length,
      },
    };

    const result = await persistNomusNfeFiscalFromXml(prisma as never, {
      nomusNfeId: "nfe-1",
      xmlRaw: PD_02457_NFE_XML,
      status: 1,
    });

    assert.equal(result.skipped, false);
    assert.equal(result.summaryId, "summary-1");
    assert.ok(result.lineCount > 0);
    assert.deepEqual(calls, ["upsert", "deleteMany", "createMany"]);
    assert.equal(summaryUpserted?.parserVersion, NFE_FISCAL_PARSER_VERSION);
    assert.equal(String(summaryUpserted?.vIPI), "129.19");
    assert.equal(String(summaryUpserted?.vNF), "4104.19");
    assert.equal(String(summaryUpserted?.vProd), "3975");
    assert.equal(summaryUpserted?.isCancelled, false);
    assert.ok(
      linesCreated.some(
        (l) =>
          typeof l === "object" &&
          l != null &&
          (l as { lineKey?: string }).lineKey === "H:IPI"
      )
    );
    assert.ok(summaryUpserted?.vIPI instanceof Prisma.Decimal);
  });

  it("skip idempotente quando xmlHash+parserVersion iguais", async () => {
    const parseOnce = await persistNomusNfeFiscalFromXml(
      {
        nomusNfeFiscalSummary: {
          findUnique: async () => null,
          upsert: async () => ({ id: "s1" }),
          update: async () => ({ id: "s1" }),
        },
        nomusNfeTaxLine: {
          deleteMany: async () => ({ count: 0 }),
          createMany: async () => ({ count: 1 }),
          count: async () => 1,
        },
      } as never,
      { nomusNfeId: "n1", xmlRaw: PD_02457_NFE_XML }
    );

    const xmlHash = parseOnce.parse.xmlHash;
    let updateCalled = false;
    const second = await persistNomusNfeFiscalFromXml(
      {
        nomusNfeFiscalSummary: {
          findUnique: async () => ({
            id: "s1",
            xmlHash,
            parserVersion: NFE_FISCAL_PARSER_VERSION,
          }),
          upsert: async () => {
            throw new Error("should not upsert");
          },
          update: async () => {
            updateCalled = true;
            return { id: "s1" };
          },
        },
        nomusNfeTaxLine: {
          deleteMany: async () => {
            throw new Error("should not delete");
          },
          createMany: async () => {
            throw new Error("should not create");
          },
          count: async () => 5,
        },
      } as never,
      { nomusNfeId: "n1", xmlRaw: PD_02457_NFE_XML, status: 7 }
    );

    assert.equal(second.skipped, true);
    assert.equal(updateCalled, true);
    assert.equal(second.lineCount, 5);
  });
});
