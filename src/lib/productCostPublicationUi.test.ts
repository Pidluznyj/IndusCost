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
  it("diferença zero dentro da tolerância retorna amount 0", () => {
    const diff = computeProductionCostPublicationDifference(0.912785, 0.912785);
    assert.equal(diff.amount, 0);
    assert.equal(diff.percent, 0);
  });

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

  it("card só aparece com pendência de custo ou snapshot técnico", () => {
    const src = card();
    assert.match(src, /if \(!pendingDraft\) return null/);
    assert.match(src, /COST_DIFF_PENDING_PUBLICATION/);
    assert.match(src, /TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT/);
    const mod = productModule();
    assert.match(mod, /costPublicationStatus/);
    assert.match(mod, /ProductCostPublicationPendingCard/);
    assert.match(mod, /COST_DIFF_PENDING_PUBLICATION/);
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

  it("lista de engenharia oferece atualização de snapshot em lote dos selecionados", () => {
    const mod = productModule();
    assert.match(mod, /handleBulkRefreshFrozenCostSnapshot/);
    assert.match(mod, /data-testid="bulk-refresh-cost-snapshot"/);
    assert.match(mod, /Atualizar snapshots \(\$\{selectedIds\.length\}\)/);
    assert.match(mod, /\/api\/products\/\$\{productId\}\/production-cost-snapshot/);
  });

  it("alerta de pendência usa componente ExecutiveAlert com paleta executiva", () => {
    const src = card();
    const styles = read("src/lib/executiveAlertStyles.ts");
    assert.match(src, /engineering-pending-cost-alert/);
    assert.match(src, /engineering-technical-snapshot-alert/);
    assert.match(src, /ExecutiveAlert/);
    assert.match(src, /variant=\{isTechnicalOnly \? "info" : "attention"\}/);
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
