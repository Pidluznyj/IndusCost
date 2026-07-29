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
    assert.match(formSlice, /data-tour="proposals-form-header"/);
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

  it("cabeçalho compacto em grade e pesquisa de produto mais larga", () => {
    const mod = read("src/components/ProposalModule.tsx");
    const formStart = mod.indexOf('if (view === "form")');
    const formSlice = mod.slice(formStart, formStart + 120_000);

    assert.match(formSlice, /grid grid-cols-1 md:grid-cols-12 gap-3/);
    assert.match(formSlice, /data-testid="proposal-add-product-search"/);
    assert.match(formSlice, /min-w-\[20rem\] max-w-2xl/);
    assert.doesNotMatch(formSlice, /className="w-64"/);
  });

  it("tour preserva âncoras do formulário", () => {
    const tour = read("src/tours/proposalTourSteps.ts");
    assert.match(tour, /proposals-root/);
    assert.match(tour, /proposals-form-actions/);
    assert.match(tour, /proposals-form-items/);
  });

  it("formulário de edição não exibe aba Indicadores nem coluna de custo unitário", () => {
    const mod = read("src/components/ProposalModule.tsx");
    const formStart = mod.indexOf('if (view === "form")');
    assert.ok(formStart > 0);
    const formSlice = mod.slice(formStart, formStart + 120_000);

    assert.doesNotMatch(formSlice, /ProposalIndicatorsTab/);
    assert.doesNotMatch(formSlice, /ProposalIndicatorsDetailModal/);
    assert.doesNotMatch(formSlice, /setFormTab\("indicators"\)/);
    assert.doesNotMatch(formSlice, />\s*Indicadores\s*</);
    assert.doesNotMatch(formSlice, /Custo Unit\./);
    assert.doesNotMatch(formSlice, /Margem líq\. %/);
    assert.match(formSlice, />Sugerido</);
    assert.match(formSlice, />Negociado</);
    assert.match(formSlice, /Total Líq\./);
  });

  it("grid de itens exibe margem comercial e total da proposta", () => {
    const mod = read("src/components/ProposalModule.tsx");
    const formStart = mod.indexOf('if (view === "form")');
    assert.ok(formStart > 0);
    const formSlice = mod.slice(formStart, formStart + 120_000);

    assert.match(formSlice, /data-testid="proposal-total-commercial-margin-strip"/);
    assert.match(formSlice, /Margem comercial/);
    assert.match(formSlice, /data-testid="proposal-total-commercial-margin-perc"/);
    assert.match(formSlice, /Margem com\./);
    assert.match(formSlice, /data-testid=\{`proposal-item-commercial-margin-\$\{idx\}`\}/);
    assert.match(formSlice, /commercialPreview\.view\.commercialMarginTotalPercent/);
  });

  it("listagem de propostas exibe somente margem % (sem valor R$ de contribuição)", () => {
    const mod = read("src/components/ProposalModule.tsx");
    assert.match(mod, /data-testid=\{`proposal-list-margin-\$\{p\.id\}`\}/);
    assert.match(mod, /formatPercentDisplay\(p\.totalMarginPerc\)/);
    assert.doesNotMatch(mod, /formatMoneyDisplay\(p\.totalMarginValue\)/);
    assert.doesNotMatch(mod, /proposal-total-margin-value/);
    assert.doesNotMatch(mod, /totalMarginPerc\)\.toFixed\(3\)%/);
  });

  it("formulário não exibe valor R$ de contribuição da margem de produção", () => {
    const mod = read("src/components/ProposalModule.tsx");
    const formStart = mod.indexOf('if (view === "form")');
    assert.ok(formStart > 0);
    const formSlice = mod.slice(formStart, formStart + 120_000);
    assert.doesNotMatch(formSlice, /proposal-total-margin-value/);
    assert.doesNotMatch(formSlice, /formatMoneyDisplay\(totals\.totalMarginValue\)/);
    assert.doesNotMatch(formSlice, /Margem de Contribuição/);
  });
});
