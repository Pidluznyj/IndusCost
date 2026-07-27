import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("proposal form layout", () => {
  it("formulário usa pilha vertical: cabeçalho, itens full-width, depois observações/notas", () => {
    const mod = read("src/components/ProposalModule.tsx");
    const formStart = mod.indexOf('if (view === "form")');
    assert.ok(formStart > 0, "bloco view===form deve existir");
    const formSlice = mod.slice(formStart, formStart + 120_000);

    assert.doesNotMatch(formSlice, /lg:grid-cols-3/);
    assert.doesNotMatch(formSlice, /lg:col-span-2/);
    assert.match(formSlice, /data-tour="proposals-form-actions"/);
    assert.match(formSlice, /data-tour="proposals-form-items"/);
    assert.match(formSlice, /data-tour="proposals-root"/);
    assert.match(formSlice, /min-h-\[70vh\]/);

    const itemsIdx = formSlice.indexOf('data-tour="proposals-form-items"');
    const notesIdx = formSlice.indexOf("Observações da Proposta (PDF)");
    const internalIdx = formSlice.indexOf("Notas Internas");
    assert.ok(itemsIdx > 0);
    assert.ok(notesIdx > itemsIdx, "observações devem ficar após itens");
    assert.ok(internalIdx > itemsIdx, "notas internas devem ficar após itens");
    assert.match(formSlice, /grid grid-cols-1 md:grid-cols-2 gap-6/);
  });

  it("tour preserva âncoras do formulário", () => {
    const tour = read("src/tours/proposalTourSteps.ts");
    assert.match(tour, /proposals-root/);
    assert.match(tour, /proposals-form-actions/);
    assert.match(tour, /proposals-form-items/);
  });
});
