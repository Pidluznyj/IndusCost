import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeMoldLineTotal,
  parseMoldNotes,
  serializeMoldNotes,
  sumMoldCostLines,
} from "./projectsMoldCostLines.js";

describe("projectsMoldCostLines", () => {
  it("calcula custo total por linha", () => {
    assert.equal(computeMoldLineTotal(3, 100), 300);
    assert.equal(computeMoldLineTotal(2.5, 40), 100);
  });

  it("soma linhas do molde corretamente", () => {
    const lines = [
      {
        id: "1",
        description: "Aço",
        lineType: "MATERIAL" as const,
        supplierName: null,
        quantity: 1,
        unit: "UN",
        unitCost: 1000,
        totalCost: 1000,
        notes: null,
      },
      {
        id: "2",
        description: "Usinagem",
        lineType: "MACHINING" as const,
        supplierName: null,
        quantity: 2,
        unit: "H",
        unitCost: 150,
        totalCost: 300,
        notes: null,
      },
    ];
    assert.equal(sumMoldCostLines(lines), 1300);
  });

  it("serializa e restaura linhas nas notas do molde", () => {
    const lines = [
      {
        id: "a",
        description: "Try-out",
        lineType: "SERVICE" as const,
        supplierName: "Fornecedor",
        quantity: 1,
        unit: "UN",
        unitCost: 5000,
        totalCost: 5000,
        notes: null,
      },
    ];
    const notes = serializeMoldNotes(lines, "Obs geral");
    const parsed = parseMoldNotes(notes);
    assert.equal(parsed.lines.length, 1);
    assert.equal(parsed.lines[0]?.totalCost, 5000);
    assert.equal(parsed.userNotes, "Obs geral");
  });

  it("modal de molde permite adicionar e remover linhas", () => {
    const modal = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectGuidedMoldModal.tsx"),
      "utf8"
    );
    assert.match(modal, /Adicionar linha/);
    assert.match(modal, /Salvar molde/);
    assert.match(modal, /Criar molde do projeto/);
  });
});
