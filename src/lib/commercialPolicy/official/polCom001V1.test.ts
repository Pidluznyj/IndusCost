import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMemoryCommercialPolicyStore } from "../commercialPolicyStore.js";
import {
  publishOfficialCommercialPolicy,
  readPendingForSeller,
  sellerHasPendingPolicy,
} from "../commercialPolicyService.js";
import { createPolicyDraft } from "../commercialPolicyService.js";
import { buildControlledPolicyPdf } from "../commercialPolicyPdf.js";
import { scoreQuestionnaire, toPublicQuestions } from "../commercialPolicyRules.js";
import {
  POL_COM_001_QUESTIONS,
  POL_COM_001_SUMMARY_RULES,
  officialCommercialPolicyBody,
  officialCommercialPolicyHash,
} from "./polCom001V1.js";
import { officialPolicyPlainText } from "./polCom001V1Document.js";

const NOW = new Date("2026-09-28T15:00:00.000Z");
const SELLER = {
  id: "seller-1",
  name: "Vendedor",
  email: "vendedor@koppetel.com",
  role: "SELLER",
  isActive: true,
  mustChangePassword: false,
  externalSellerId: 7,
  sessionId: "sess",
};

describe("POL-COM-001 conteúdo oficial", () => {
  it("preserva o texto integral, a matriz e o anexo como estão no documento", () => {
    const text = officialPolicyPlainText();
    assert.match(text, /POLÍTICA COMERCIAL E DE/);
    assert.match(text, /^COMISSIONAMENTO$/m);
    assert.match(text, /14\.055\.501\/0001-80/);
    assert.match(text, /Koppetel Comercio de Plásticos LTDA/);
    assert.match(text, /35,00%/);
    assert.match(text, /1,00%/);
    assert.match(text, /2,00%/);
    assert.match(text, /3,00%/);
    assert.match(text, /4,00%/);
    assert.match(text, /33%/);
    assert.match(text, /90 dias corridos/);
    assert.match(text, /versão 2\.0/);
    for (const rule of POL_COM_001_SUMMARY_RULES) {
      assert.equal(text.includes(rule), true, rule);
    }
    assert.equal(officialCommercialPolicyHash(), officialCommercialPolicyHash());
  });

  it("o questionário público não revela a alternativa correta", () => {
    const publicQuestions = toPublicQuestions(POL_COM_001_QUESTIONS);
    assert.equal(JSON.stringify(publicQuestions).includes("correctOptionId"), false);
    const wrong = scoreQuestionnaire(
      POL_COM_001_QUESTIONS,
      POL_COM_001_QUESTIONS.map((question) => ({ questionId: question.id, optionId: "a" }))
    );
    assert.equal(wrong.passed, false);
    const right = scoreQuestionnaire(
      POL_COM_001_QUESTIONS,
      POL_COM_001_QUESTIONS.map((question) => ({ questionId: question.id, optionId: question.correctOptionId }))
    );
    assert.equal(right.passed, true);
  });

  it("publicar a oficial duas vezes não cria outra versão vigente", async () => {
    const store = createMemoryCommercialPolicyStore();
    const first = await publishOfficialCommercialPolicy(store, "super-1", NOW);
    const second = await publishOfficialCommercialPolicy(store, "super-1", NOW);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(second.alreadyPublished, true);
    assert.equal(first.version.id, second.version.id);
    assert.equal(await store.countEffectivePublished(NOW), 1);
    assert.equal(await sellerHasPendingPolicy(store, SELLER, NOW), true);
  });

  it("duas versões vigentes ao mesmo tempo bloqueiam o aceite", async () => {
    const store = createMemoryCommercialPolicyStore();
    await publishOfficialCommercialPolicy(store, "super-1", NOW);
    const extra = await createPolicyDraft(store, officialCommercialPolicyBody(), NOW);
    assert.equal(extra.ok, true);
    if (!extra.ok) return;
    await store.markPublished(extra.version.id, {
      contentHash: "outro",
      publishedAt: NOW,
      publishedByUserId: "super-1",
    });
    assert.equal(await store.countEffectivePublished(NOW), 2);
    assert.equal(await sellerHasPendingPolicy(store, SELLER, NOW), true);
    const pending = await readPendingForSeller(store, SELLER, NOW);
    assert.equal(pending.ok, false);
    if (pending.ok) return;
    assert.equal(pending.code, "CONFLICTING_PUBLISHED_VERSIONS");
  });

  it("a cópia controlada identifica o destinatário e a restrição", () => {
    const pdf = buildControlledPolicyPdf({
      lines: ["POL-COM-001", "USO INTERNO E RESTRITO"],
      copyId: "copy-1",
      recipientName: "Ana Vendedora",
      recipientEmail: "ana@koppetel.com",
      generatedAt: "2026-09-28T15:00:00.000Z",
    });
    const latin = pdf.toString("latin1");
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.match(latin, /POL-COM-001/);
    assert.match(latin, /USO INTERNO/);
    assert.match(latin, /COPIA CONTROLADA/);
    assert.match(latin, /NAO DISTRIBUIR/);
    assert.match(latin, /ana@koppetel.com/);
    assert.match(latin, /copy-1/);
    assert.match(latin, /KOPPETEL \/ LAZARIOS/);
  });
});
