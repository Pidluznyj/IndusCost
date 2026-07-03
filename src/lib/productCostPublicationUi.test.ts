import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeProductionCostPublicationDifference,
  formatProductionCostPublicationDelta,
} from "./productProductionCostPublicationStatus.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("productProductionCostPublicationStatus", () => {
  it("calcula diferença em R$ e % entre oficial e DRAFT", () => {
    const diff = computeProductionCostPublicationDifference(2.828818, 5.478818);
    assert.ok(Math.abs(diff.amount - 2.65) < 0.000001);
    assert.ok(Math.abs(diff.percent - 93.677) < 0.1);
  });

  it("sem custo oficial trata percentual como 100% quando há DRAFT", () => {
    const diff = computeProductionCostPublicationDifference(null, 5.478818);
    assert.equal(diff.amount, 5.478818);
    assert.equal(diff.percent, 100);
  });

  it("formata delta para exibição", () => {
    const formatted = formatProductionCostPublicationDelta({ amount: 2.65, percent: 93.68 });
    assert.match(formatted.amountLabel, /^\+/);
    assert.match(formatted.percentLabel, /%/);
  });
});

describe("productCostPublicationUi", () => {
  const server = () => read("server.ts");
  const productModule = () => read("src/components/ProductModule.tsx");
  const card = () => read("src/components/product/ProductCostPublicationPendingCard.tsx");

  it("GET publication-status reutiliza service oficial", () => {
    const src = server();
    assert.match(src, /\/api\/products\/:id\/production-cost-publication-status/);
    assert.match(src, /getProductProductionCostPublicationStatus/);
  });

  it("publicação na UI chama endpoint oficial POST publish", () => {
    const src = card();
    assert.match(src, /\/api\/production-cost-table-versions\/\$\{pendingDraft\.versionId\}\/publish/);
    assert.doesNotMatch(src, /prisma/);
    assert.doesNotMatch(src, /SQL/i);
  });

  it("card só aparece com DRAFT pendente", () => {
    const src = card();
    assert.match(src, /if \(!pendingDraft\) return null/);
    const mod = productModule();
    assert.match(mod, /costPublicationStatus\?\.pendingDraft/);
    assert.match(mod, /ProductCostPublicationPendingCard/);
  });

  it("botão respeita permissões de publicação", () => {
    const mod = productModule();
    assert.match(mod, /PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS/);
    assert.match(mod, /canPublishProductionCost/);
    const src = card();
    assert.match(src, /Você não tem permissão para publicar custos oficiais/);
    assert.match(src, /disabled=\{!canPublish/);
  });

  it("após snapshot refetch atualiza status de publicação", () => {
    const mod = productModule();
    assert.match(mod, /setCostPublicationRefreshToken/);
    assert.match(mod, /production-cost-snapshot/);
  });

  it("alerta de pendência usa componente ExecutiveAlert com paleta âmbar", () => {
    const src = card();
    const styles = read("src/lib/executiveAlertStyles.ts");
    assert.match(src, /engineering-pending-cost-alert/);
    assert.match(src, /ExecutiveAlert/);
    assert.match(src, /variant="attention"/);
    assert.match(styles, /bg-\[#FFFBEB\]/);
    assert.match(styles, /border-\[#F59E0B\]/);
    assert.match(styles, /text-\[#92400E\]/);
    assert.match(styles, /text-\[#78350F\]/);
    assert.match(styles, /bg-\[#FDE68A\]/);
    assert.match(styles, /border-\[#FCD34D\]/);
    assert.doesNotMatch(styles, /dark:bg-amber-950/);
    assert.doesNotMatch(styles, /dark:bg-slate-950/);
  });
});
