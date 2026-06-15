import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeMoldLineTotal,
  formatMoldDescriptionForDisplay,
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

  it("parseMoldNotes ignora JSON inválido sem lançar erro", () => {
    const parsed = parseMoldNotes("__MOLD_LINES__={invalid json");
    assert.deepEqual(parsed.lines, []);
  });

  it("formatMoldDescriptionForDisplay oculta payload __MOLD_LINES__", () => {
    const notes = serializeMoldNotes(
      [
        {
          id: "1",
          description: "Projeto",
          lineType: "SERVICE",
          supplierName: null,
          quantity: 1,
          unit: "UN",
          unitCost: 3500,
          totalCost: 3500,
          notes: null,
        },
      ],
      "Es Rodrigo"
    );
    assert.equal(formatMoldDescriptionForDisplay(notes, "Novo"), "Es Rodrigo");
    assert.equal(formatMoldDescriptionForDisplay(notes, null), "Es Rodrigo");
    assert.equal(formatMoldDescriptionForDisplay(notes?.replace(/\n__USER_NOTES__=.*/, ""), "Novo"), "Novo");
  });

  it("modal de molde permite adicionar e remover linhas", () => {
    const modal = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectGuidedMoldModal.tsx"),
      "utf8"
    );
    const shell = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectModalShell.tsx"),
      "utf8"
    );
    assert.match(modal, /Adicionar linha/);
    assert.match(modal, /Salvar molde/);
    assert.match(modal, /Criar molde do projeto/);
    assert.match(modal, /size="xl"/);
    assert.match(modal, /projects-mold-modal/);
    assert.match(modal, /projects-mold-cost-grid/);
    assert.match(modal, /projects-mold-total-footer/);
    assert.match(modal, /min-w-\[1100px\]/);
    assert.match(modal, /overflow-x-auto/);
    assert.match(shell, /max-w-\[1280px\]/);
    assert.match(shell, /overflow-y-auto/);
    assert.match(shell, /project-modal-footer/);
    assert.equal(modal.includes("alert("), false);
    assert.equal(modal.includes("confirm("), false);
    assert.equal(modal.includes("prompt("), false);
  });
});
