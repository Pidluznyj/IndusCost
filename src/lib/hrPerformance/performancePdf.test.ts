import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPlainPdf } from "./performancePdf.js";
import { nextGraphRevision } from "./performancePrisma.js";

describe("pdf interno", () => {
  it("gera um PDF com o texto pedido", () => {
    const pdf = buildPlainPdf("Avaliacao individual", ["Ana Operadora", "Cultura: em desenvolvimento"]);
    const text = pdf.toString("latin1");
    assert.equal(text.startsWith("%PDF-1.4"), true);
    assert.match(text, /Avaliacao individual/);
    assert.match(text, /Ana Operadora/);
    assert.match(text, /%%EOF/);
  });
});

describe("concorrência do grafo", () => {
  it("só a revisão igual avança", () => {
    assert.equal(nextGraphRevision(3, 3), 4);
    assert.equal(nextGraphRevision(3, 2), null);
  });
});
