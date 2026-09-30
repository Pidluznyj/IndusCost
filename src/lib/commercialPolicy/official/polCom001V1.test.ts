import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMemoryCommercialPolicyStore } from "../commercialPolicyStore.js";
import {
  publishOfficialCommercialPolicy,
  readPendingForSeller,
  sellerHasPendingPolicy,
} from "../commercialPolicyService.js";
import { createPolicyDraft } from "../commercialPolicyService.js";
import { buildControlledCopyPdf } from "../commercialPolicyControlledCopyPdf.js";
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
    // Anexo III corrigido para 1.0 na representação estruturada (DOCUMENT_INTERNAL_VERSION_MISMATCH registrado na auditoria).
    assert.doesNotMatch(text, /versão 2\.0/);
    assert.match(text, /código POL-COM-001, versão 1\.0/);
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

  it("a publicação oficial fica bloqueada enquanto documento e sistema divergem", async () => {
    const store = createMemoryCommercialPolicyStore();
    const first = await publishOfficialCommercialPolicy(store, "super-1", NOW);
    const second = await publishOfficialCommercialPolicy(store, "super-1", NOW);
    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    if (first.ok || second.ok) return;
    assert.equal(first.code, "NOT_READY_FOR_PUBLICATION");
    assert.equal(second.code, "NOT_READY_FOR_PUBLICATION");
    assert.equal(first.findings?.some((item) => item.code === "DECLARED_VERSION_MISMATCH"), false);
    const internal = first.findings?.find((item) => item.code === "DOCUMENT_INTERNAL_VERSION_MISMATCH");
    assert.equal(internal?.severity, "INFORMATIONAL");
    assert.equal(internal?.blocking, false);
    assert.ok(first.findings?.some((item) => item.code === "COMMISSION_MATRIX_NOT_PARAMETERIZED" && item.blocking));
    assert.ok(first.findings?.some((item) => item.code === "SUPERVISOR_SHARE_NOT_PARAMETERIZED" && item.blocking));
    assert.equal(await store.countEffectivePublished(NOW), 0);
    assert.equal(await sellerHasPendingPolicy(store, SELLER, NOW), false);
  });

  it("duas versões vigentes ao mesmo tempo bloqueiam o aceite", async () => {
    const store = createMemoryCommercialPolicyStore();
    const first = await createPolicyDraft(store, officialCommercialPolicyBody(), NOW);
    const extra = await createPolicyDraft(store, { ...officialCommercialPolicyBody(), title: "Cópia de conflito" }, NOW);
    assert.equal(first.ok, true);
    assert.equal(extra.ok, true);
    if (!first.ok || !extra.ok) return;
    await store.markPublished(first.version.id, {
      contentHash: officialCommercialPolicyHash(),
      publishedAt: NOW,
      publishedByUserId: "super-1",
    });
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
    const pdf = buildControlledCopyPdf({
      content: "# 1. OBJETIVO\nTexto da política.",
      title: "POLÍTICA COMERCIAL E DE COMISSIONAMENTO",
      versionLabel: "1.0",
      code: "POL-COM-001",
      company: "Koppetel Comercio de Plásticos LTDA",
      cnpj: "14.055.501/0001-80",
      classification: "POLÍTICA OFICIAL — USO INTERNO E RESTRITO",
      contentHash: "abc",
      effectiveFrom: null,
      publishedAt: null,
      summaryRules: [],
      notice: ["CONFIDENCIALIDADE E RESTRIÇÃO DE USO", "A posse desta cópia não implica autorização para divulgação."],
      copyId: "copy-1",
      recipientName: "Ana Vendedora",
      recipientEmail: "ana@koppetel.com",
      generatedAt: "2026-09-28T15:00:00.000Z",
    });
    const latin = pdf.toString("latin1");
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.match(latin, /POL-COM-001/);
    assert.match(latin, /USO INTERNO/);
    assert.ok(latin.includes("C\\323PIA CONTROLADA"));
    assert.ok(latin.includes("N\\303O DISTRIBUIR"));
    assert.ok(latin.includes("Koppetel Comercio de Pl\\341sticos LTDA"));
    // Quem gerou aparece no quadro da capa, no rodapé e na marca d'água (atrás do texto).
    const footer = "C\\363pia emitida para Ana Vendedora \\(ana@koppetel.com\\) em 28/09/2026 12:00";
    assert.ok(latin.includes(footer));
    assert.ok(latin.includes("C\\363digo da c\\363pia: copy-1"));
    const watermarkAt = latin.indexOf("Ana Vendedora  \\267  ana@koppetel.com");
    assert.ok(watermarkAt >= 0);
    assert.ok(watermarkAt < latin.indexOf(footer), "a marca d'água é pintada antes do texto");
  });
});
