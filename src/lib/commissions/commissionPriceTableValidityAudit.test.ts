/**
 * Auditoria de vigência das tabelas comerciais (defeito D3).
 *
 * Em produção existem versões com `effectiveTo` igual ao `effectiveFrom` e
 * outras com fim ANTERIOR ao início. Contra `effectiveFrom <= data <
 * effectiveTo`, nenhuma casa em data alguma.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditPriceTableValidity,
  summarizePriceTableValidity,
  type PriceTableVersionAuditRow,
} from "./commissionPriceTableValidityAudit.js";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function v(
  over: Partial<PriceTableVersionAuditRow> = {}
): PriceTableVersionAuditRow {
  return {
    tableId: "t1",
    tableCode: "ATACADO",
    versionId: "v1",
    versionNumber: 1,
    status: "ARCHIVED",
    effectiveFrom: D("2026-01-01"),
    effectiveTo: D("2026-06-01"),
    publishedAt: D("2026-01-01"),
    itemCount: 700,
    ...over,
  };
}

describe("vigência — linha do tempo sadia", () => {
  it("versões encadeadas sem buraco não geram achado", () => {
    const issues = auditPriceTableValidity([
      v({ versionId: "a", versionNumber: 1, effectiveFrom: D("2026-01-01"), effectiveTo: D("2026-06-01") }),
      v({ versionId: "b", versionNumber: 2, effectiveFrom: D("2026-06-01"), effectiveTo: null, status: "PUBLISHED", publishedAt: D("2026-06-01") }),
    ]);
    assert.deepEqual(issues, []);
  });

  it("DRAFT com vigência incoerente é ignorada — é rascunho, não defeito", () => {
    const issues = auditPriceTableValidity([
      v({ status: "DRAFT", effectiveFrom: null, effectiveTo: null }),
    ]);
    assert.deepEqual(issues, []);
  });
});

describe("vigência — os defeitos reais de produção", () => {
  it("largura zero (fim = início) é detectada", () => {
    const issues = auditPriceTableValidity([
      v({ versionId: "a", versionNumber: 24, effectiveFrom: D("2026-06-30"), effectiveTo: D("2026-06-30") }),
      v({ versionId: "b", versionNumber: 25, effectiveFrom: D("2026-08-03"), effectiveTo: null, status: "PUBLISHED", publishedAt: D("2026-08-03") }),
    ]);
    const zero = issues.find((i) => i.kind === "ZERO_WIDTH_VALIDITY");
    assert.ok(zero);
    assert.equal(zero!.risk, "HIGH");
  });

  it("fim ANTERIOR ao início é detectado", () => {
    const issues = auditPriceTableValidity([
      v({ versionId: "a", versionNumber: 13, effectiveFrom: D("2026-06-30"), effectiveTo: D("2025-12-31") }),
      v({ versionId: "b", versionNumber: 14, effectiveFrom: D("2026-08-03"), effectiveTo: null }),
    ]);
    assert.equal(issues.some((i) => i.kind === "INVERTED_VALIDITY"), true);
  });

  it("com sucessora inequívoca, o reparo é AUTO_REPAIRABLE e propõe o fim certo", () => {
    const issues = auditPriceTableValidity([
      v({ versionId: "a", versionNumber: 24, effectiveFrom: D("2026-06-30"), effectiveTo: D("2026-06-30") }),
      v({ versionId: "b", versionNumber: 25, effectiveFrom: D("2026-08-03"), effectiveTo: null }),
    ]);
    const zero = issues.find((i) => i.kind === "ZERO_WIDTH_VALIDITY")!;
    assert.equal(zero.evidenceClass, "AUTO_REPAIRABLE");
    assert.equal(zero.proposedEffectiveTo?.toISOString().slice(0, 10), "2026-08-03");
    assert.match(zero.evidenceSource!, /sucessora/i);
    assert.match(zero.rule, /effectiveTo\(N\) = effectiveFrom\(N\+1\)/);
  });

  it("sem sucessora, NÃO é reparável automaticamente", () => {
    const issues = auditPriceTableValidity([
      v({ effectiveFrom: D("2026-06-30"), effectiveTo: D("2026-06-30") }),
    ]);
    const zero = issues.find((i) => i.kind === "ZERO_WIDTH_VALIDITY")!;
    assert.equal(zero.evidenceClass, "MANUAL_REVIEW_REQUIRED");
    assert.equal(zero.proposedEffectiveTo, null);
  });

  it("sucessora ambígua (duas com mesmo início) impede reparo automático", () => {
    const issues = auditPriceTableValidity([
      v({ versionId: "a", versionNumber: 1, effectiveFrom: D("2026-06-30"), effectiveTo: D("2026-06-30") }),
      v({ versionId: "b", versionNumber: 2, effectiveFrom: D("2026-08-03"), effectiveTo: null }),
      v({ versionId: "c", versionNumber: 3, effectiveFrom: D("2026-08-03"), effectiveTo: null }),
    ]);
    const zero = issues.find((i) => i.kind === "ZERO_WIDTH_VALIDITY")!;
    assert.equal(zero.evidenceClass, "MANUAL_REVIEW_REQUIRED");
  });
});

describe("vigência — sobreposição, lacuna e duplicidade", () => {
  it("duas versões com o mesmo início são ambíguas", () => {
    const issues = auditPriceTableValidity([
      v({ versionId: "a", versionNumber: 1, effectiveFrom: D("2026-01-01"), effectiveTo: D("2026-06-01") }),
      v({ versionId: "b", versionNumber: 2, effectiveFrom: D("2026-01-01"), effectiveTo: D("2026-06-01") }),
    ]);
    assert.equal(issues.some((i) => i.kind === "DUPLICATE_EFFECTIVE_FROM"), true);
  });

  it("sobreposição é detectada", () => {
    const issues = auditPriceTableValidity([
      v({ versionId: "a", versionNumber: 1, effectiveFrom: D("2026-01-01"), effectiveTo: D("2026-07-01") }),
      v({ versionId: "b", versionNumber: 2, effectiveFrom: D("2026-06-01"), effectiveTo: null }),
    ]);
    assert.equal(issues.some((i) => i.kind === "OVERLAPPING_VERSIONS"), true);
  });

  it("lacuna é detectada e é reparável pela sucessão", () => {
    const issues = auditPriceTableValidity([
      v({ versionId: "a", versionNumber: 1, effectiveFrom: D("2026-01-01"), effectiveTo: D("2026-05-01") }),
      v({ versionId: "b", versionNumber: 2, effectiveFrom: D("2026-06-01"), effectiveTo: null }),
    ]);
    const gap = issues.find((i) => i.kind === "VALIDITY_GAP")!;
    assert.equal(gap.evidenceClass, "AUTO_REPAIRABLE");
    assert.equal(gap.proposedEffectiveTo?.toISOString().slice(0, 10), "2026-06-01");
  });

  it("a lacuna é atribuída à versão ANTERIOR — é o fim dela que será alterado", () => {
    const issues = auditPriceTableValidity([
      v({ versionId: "a", versionNumber: 1, effectiveFrom: D("2026-01-01"), effectiveTo: D("2026-05-01") }),
      v({ versionId: "b", versionNumber: 2, effectiveFrom: D("2026-06-01"), effectiveTo: null }),
    ]);
    const gap = issues.find((i) => i.kind === "VALIDITY_GAP")!;
    // Apontar a versão seguinte mandaria quem repara ao registro errado.
    assert.equal(gap.versionId, "a");
    assert.equal(gap.versionNumber, 1);
    assert.equal(gap.currentEffectiveTo?.toISOString().slice(0, 10), "2026-05-01");
  });

  it("largura zero NÃO gera também um achado de lacuna — é a mesma causa", () => {
    const issues = auditPriceTableValidity([
      v({ versionId: "a", versionNumber: 24, effectiveFrom: D("2026-06-30"), effectiveTo: D("2026-06-30") }),
      v({ versionId: "b", versionNumber: 25, effectiveFrom: D("2026-08-03"), effectiveTo: null }),
    ]);
    assert.equal(issues.filter((i) => i.kind === "ZERO_WIDTH_VALIDITY").length, 1);
    assert.equal(
      issues.filter((i) => i.kind === "VALIDITY_GAP").length,
      0,
      "dois achados para a mesma causa dariam propostas concorrentes"
    );
  });
});

describe("vigência — publicação e estado", () => {
  it("PUBLISHED sem sucessora e com fim definido deixa vendas descobertas", () => {
    const issues = auditPriceTableValidity([
      v({ status: "PUBLISHED", effectiveFrom: D("2026-01-01"), effectiveTo: D("2026-06-01") }),
    ]);
    assert.equal(issues.some((i) => i.kind === "PUBLISHED_WITHOUT_VALIDITY"), true);
  });

  it("publicação retroativa é sinalizada — snapshots do intervalo podem estar defasados", () => {
    const issues = auditPriceTableValidity([
      v({
        effectiveFrom: D("2026-01-01"),
        effectiveTo: null,
        publishedAt: D("2026-08-03"),
        status: "PUBLISHED",
      }),
    ]);
    const retro = issues.find((i) => i.kind === "RETROACTIVE_PUBLICATION")!;
    assert.ok(retro);
    assert.equal(retro.evidenceClass, "MANUAL_REVIEW_REQUIRED");
  });

  it("versão não-DRAFT sem início é UNRESOLVED", () => {
    const issues = auditPriceTableValidity([
      v({ status: "ARCHIVED", effectiveFrom: null }),
    ]);
    const missing = issues.find((i) => i.kind === "MISSING_EFFECTIVE_FROM")!;
    assert.equal(missing.evidenceClass, "UNRESOLVED");
  });

  it("tabelas diferentes não interferem entre si", () => {
    const issues = auditPriceTableValidity([
      v({ tableId: "t1", tableCode: "ATACADO", effectiveFrom: D("2026-01-01"), effectiveTo: null }),
      v({ tableId: "t2", tableCode: "VAREJO_1", versionId: "x", effectiveFrom: D("2026-01-01"), effectiveTo: null }),
    ]);
    assert.deepEqual(issues, []);
  });
});

describe("vigência — resumo e pureza", () => {
  it("resumo agrupa por classe de evidência e por tabela", () => {
    const rows = [
      v({ versionId: "a", versionNumber: 1, effectiveFrom: D("2026-06-30"), effectiveTo: D("2026-06-30") }),
      v({ versionId: "b", versionNumber: 2, effectiveFrom: D("2026-08-03"), effectiveTo: null }),
    ];
    const issues = auditPriceTableValidity(rows);
    const s = summarizePriceTableValidity(rows, issues);
    assert.equal(s.versionsAnalyzed, 2);
    assert.equal(s.countsByClass.AUTO_REPAIRABLE, 1);
    assert.deepEqual(s.affectedTableCodes, ["ATACADO"]);
  });

  it("é pura: não muta a entrada", () => {
    const rows = [v({ effectiveFrom: D("2026-06-30"), effectiveTo: D("2026-06-30") })];
    const antes = JSON.stringify(rows);
    auditPriceTableValidity(rows);
    assert.equal(JSON.stringify(rows), antes);
  });

  it("é determinística", () => {
    const rows = [v({ effectiveFrom: D("2026-06-30"), effectiveTo: D("2026-06-30") })];
    assert.deepEqual(auditPriceTableValidity(rows), auditPriceTableValidity(rows));
  });

  it("entrada vazia não quebra", () => {
    assert.deepEqual(auditPriceTableValidity([]), []);
  });
});
