import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("proposalWriteSanitization — higienização de payload de gravação de proposta", () => {
  it("server.ts limpa strings vazias de UUID em priceTableId e priceTableVersionId", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf-8");
    assert.match(server, /sanitizeProposalUuid/);
    assert.match(server, /sanitizeProposalInt/);
    assert.match(server, /sanitizeProposalDecimal/);
    assert.match(server, /sanitizeProposalDate/);
  });

  it("ProposalModule.tsx converte strings vazias de tabela de preço para null no payload", () => {
    const module = readFileSync(
      join(process.cwd(), "src/components/ProposalModule.tsx"),
      "utf-8"
    );
    assert.match(module, /priceTableId.*trim\(\) \|\| null/);
  });
});
