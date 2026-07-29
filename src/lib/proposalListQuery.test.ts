import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildProposalListNetValueWhere,
  parseProposalListNetValueParam,
} from "./proposalListQuery.js";

describe("proposalListQuery — valor líquido De/Até", () => {
  it("parse aceita número, milhar BR e decimal BR", () => {
    assert.equal(parseProposalListNetValueParam("1500.5"), 1500.5);
    assert.equal(parseProposalListNetValueParam("1500,5"), 1500.5);
    assert.equal(parseProposalListNetValueParam("1.500,50"), 1500.5);
    assert.equal(parseProposalListNetValueParam("10.000"), 10000);
    assert.equal(parseProposalListNetValueParam(" 2000 "), 2000);
    assert.equal(parseProposalListNetValueParam(""), null);
    assert.equal(parseProposalListNetValueParam("-10"), null);
    assert.equal(parseProposalListNetValueParam("abc"), null);
  });

  it("não interpreta 10.000 como 10 (bug do Number nativo)", () => {
    assert.equal(Number("10.000"), 10);
    assert.equal(parseProposalListNetValueParam("10.000"), 10000);
    assert.equal(parseProposalListNetValueParam("1.500"), 1500);
  });

  it("buildProposalListNetValueWhere monta gte/lte sem falsy em zero", () => {
    assert.deepEqual(buildProposalListNetValueWhere(null, null), {});
    assert.deepEqual(buildProposalListNetValueWhere(0, null), {
      totalNetValue: { gte: 0 },
    });
    assert.deepEqual(buildProposalListNetValueWhere(1000, 5000), {
      totalNetValue: { gte: 1000, lte: 5000 },
    });
    assert.deepEqual(buildProposalListNetValueWhere(null, 50000), {
      totalNetValue: { lte: 50000 },
    });
  });

  it("listagem de propostas normaliza De/Até com parse monetário BR", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/ProposalModule.tsx"),
      "utf8"
    );
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(page, /moneyAmountToFilterParam/);
    assert.match(page, /proposals-filter-net-value/);
    assert.match(server, /parseProposalListNetValueParam/);
    assert.match(server, /buildProposalListNetValueWhere/);
    assert.doesNotMatch(server, /function parseDecimalQuery/);
  });
});
