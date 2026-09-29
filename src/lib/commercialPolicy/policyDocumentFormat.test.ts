import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import {
  isPolicyMarkup,
  parsePolicyChapters,
  policyChaptersPlainText,
  policyContentToPlainLines,
  serializePolicyChapters,
  slugifyPolicyTitle,
} from "./policyDocumentFormat.js";
import { POL_COM_001_CHAPTERS, officialPolicyPlainText } from "./official/polCom001V1Document.js";
import { POL_COM_001_QUESTIONS, officialCommercialPolicyBody, officialCommercialPolicyContent, officialCommercialPolicyHash } from "./official/polCom001V1.js";
import { isOfficialCommercialPolicyContent } from "./official/polCom001V1View.js";
import { createMemoryCommercialPolicyStore } from "./commercialPolicyStore.js";
import { createPolicyDraft, publishPolicyVersion, updatePolicyDraft, type PolicyActor } from "./commercialPolicyService.js";
import { registerCommercialPolicyRoutes } from "./commercialPolicyRoutes.js";
import { policyDocumentLines } from "./commercialPolicyPdf.js";
import { buildCurrentCommercialPolicyNormativeSnapshot } from "./commercialPolicyNormative.js";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const SNAPSHOT = buildCurrentCommercialPolicyNormativeSnapshot({ releaseDefaultRule: "EACH_RECEIVABLE_PAID", partialPaymentEnabled: true });

describe("formato do conteúdo da política", () => {
  it("serializa e reparseia os 33 capítulos oficiais sem perda", () => {
    const markup = serializePolicyChapters(POL_COM_001_CHAPTERS);
    assert.equal(isPolicyMarkup(markup), true);
    const parsed = parsePolicyChapters(markup);
    assert.deepEqual(parsed, POL_COM_001_CHAPTERS);
    assert.equal(policyChaptersPlainText(parsed), officialPolicyPlainText());
    assert.equal(serializePolicyChapters(parsed), markup);
  });

  it("os ids dos capítulos são o slug do título (perguntas continuam endereçáveis)", () => {
    for (const chapter of POL_COM_001_CHAPTERS) assert.equal(slugifyPolicyTitle(chapter.title), chapter.id);
    const ids = new Set(parsePolicyChapters(officialCommercialPolicyContent()).map((chapter) => chapter.id));
    for (const question of POL_COM_001_QUESTIONS) assert.ok(question.reviewChapterId && ids.has(question.reviewChapterId), question.id);
  });

  it("o conteúdo oficial gravado é a marcação e o hash é estável", () => {
    assert.equal(officialCommercialPolicyBody().content, officialCommercialPolicyContent());
    assert.equal(isOfficialCommercialPolicyContent(officialCommercialPolicyContent()), true);
    assert.equal(isOfficialCommercialPolicyContent(officialPolicyPlainText()), false);
    assert.equal(officialCommercialPolicyHash(), officialCommercialPolicyHash());
  });

  it("texto plano antigo vira um capítulo de parágrafos e o PDF não mostra marcação", () => {
    const legacy = "Primeira linha.\nSegunda linha.";
    const parsed = parsePolicyChapters(legacy);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].blocks.length, 2);
    assert.deepEqual(policyContentToPlainLines(legacy), ["Primeira linha.", "Segunda linha."]);
    const lines = policyDocumentLines({
      title: "T", versionLabel: "1.0", contentHash: "h", effectiveFrom: null, publishedAt: null,
      content: officialCommercialPolicyContent(), summaryRules: ["r"],
    });
    assert.equal(lines.some((line) => /^(# |## |- |> |\| )/.test(line)), false);
    assert.ok(lines.includes("Abaixo de 30,00%"));
  });

  it("tabelas consecutivas e termos são preservados", () => {
    const markup = serializePolicyChapters([
      { id: "x", title: "X", blocks: [
        { type: "table", rows: [["a", "b"], ["1", "2"]] },
        { type: "table", rows: [["c"], ["3"]] },
        { type: "term", term: "Termo", definition: "Definição :: com dois-pontos" },
        { type: "heading", text: "H" },
        { type: "bullet", text: "B" },
      ] },
    ]);
    const parsed = parsePolicyChapters(markup);
    assert.equal(parsed[0].blocks.filter((block) => block.type === "table").length, 2);
    assert.deepEqual(parsed[0].blocks[2], { type: "term", term: "Termo", definition: "Definição :: com dois-pontos" });
  });
});

describe("CRUD do conteúdo (rascunho editável, publicada imutável)", () => {
  const SHORT = {
    title: "Política de teste",
    content: "# Capa\nTexto de teste da política comercial vigente.\n\n# 1. Objetivo\n- tópico",
    summaryRules: ["Regra"],
    declarations: ["Declaro ciência."],
    questions: [{ id: "q1", prompt: "Pergunta", explanation: "Porque", correctOptionId: "a", options: [{ id: "a", text: "Sim" }, { id: "b", text: "Não" }] }],
  };

  it("edita rascunho, recusa edição de publicada e duplica/descarta pelas rotas", async () => {
    const store = createMemoryCommercialPolicyStore();
    const draft = await createPolicyDraft(store, SHORT, NOW);
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    const edited = await updatePolicyDraft(store, draft.version.id, { ...SHORT, title: "Editada", effectiveFrom: new Date("2026-10-01T03:00:00.000Z") });
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    assert.equal(edited.version.title, "Editada");
    assert.equal(edited.version.effectiveFrom.toISOString(), "2026-10-01T03:00:00.000Z");
    const invalid = await updatePolicyDraft(store, draft.version.id, { ...SHORT, title: "" });
    assert.equal(invalid.ok, false);
    await publishPolicyVersion(store, draft.version.id, "super-1", NOW, { currentSnapshot: SNAPSHOT });
    const locked = await updatePolicyDraft(store, draft.version.id, { ...SHORT, title: "Outra" });
    assert.equal(locked.ok, false);
    if (!locked.ok) assert.equal(locked.code, "VERSION_IMMUTABLE");

    const admin: PolicyActor = { id: "super-1", name: "Super", email: "s@k.com", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false, externalSellerId: null, sessionId: "s" };
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    registerCommercialPolicyRoutes(app, {
      requireAppAuth: (_req, _res, next) => next(),
      getCurrentAppUser: async () => admin,
      store,
      now: () => NOW,
      verifyPassword: async () => true,
      saveFile: async () => ({ storageKey: "k" }),
      readFile: async () => Buffer.from(""),
      loadRelease: async () => ({ releaseDefaultRule: "EACH_RECEIVABLE_PAID", partialPaymentEnabled: true }),
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    try {
      const dup = await fetch(`${url}/api/admin/commercial-policy/versions/${draft.version.id}/duplicate`, { method: "POST" });
      assert.equal(dup.status, 201);
      const dupBody = (await dup.json()) as { version: { id: string; status: string; title: string } };
      assert.equal(dupBody.version.status, "DRAFT");
      assert.equal(dupBody.version.title, "Editada");
      const put = await fetch(`${url}/api/admin/commercial-policy/versions/${dupBody.version.id}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...SHORT, title: "Editada 2" }),
      });
      assert.equal(put.status, 200);
      const putLocked = await fetch(`${url}/api/admin/commercial-policy/versions/${draft.version.id}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(SHORT),
      });
      assert.equal(putLocked.status, 409);
      const official = await fetch(`${url}/api/admin/commercial-policy/versions/from-official`, { method: "POST" });
      assert.equal(official.status, 201);
      const officialBody = (await official.json()) as { version: { id: string; official: boolean; label: string } };
      assert.equal(officialBody.version.official, true);
      assert.equal(officialBody.version.label, "1.0");
      const del = await fetch(`${url}/api/admin/commercial-policy/versions/${dupBody.version.id}`, { method: "DELETE" });
      assert.equal(del.status, 200);
      assert.equal((await store.getVersion(dupBody.version.id))?.status, "RETIRED");
      const delLocked = await fetch(`${url}/api/admin/commercial-policy/versions/${draft.version.id}`, { method: "DELETE" });
      assert.equal(delLocked.status, 409);
      const get = await fetch(`${url}/api/admin/commercial-policy/versions/${officialBody.version.id}`);
      assert.equal(get.status, 200);
    } finally {
      server.close();
    }
  });

  it("um rascunho editado que ainda se apresenta como POL-COM-001 continua sujeito à auditoria", async () => {
    const store = createMemoryCommercialPolicyStore();
    const draft = await createPolicyDraft(store, { ...officialCommercialPolicyBody(), effectiveFrom: NOW }, NOW);
    if (!draft.ok) return;
    const edited = await updatePolicyDraft(store, draft.version.id, {
      ...officialCommercialPolicyBody(),
      content: officialCommercialPolicyContent().replace("# 1. OBJETIVO", "# 1. OBJETIVO (revisado)"),
    });
    assert.equal(edited.ok, true);
    const published = await publishPolicyVersion(store, draft.version.id, "super-1", NOW, { currentSnapshot: SNAPSHOT });
    assert.equal(published.ok, false);
    if (!published.ok) {
      assert.equal(published.code, "NOT_READY_FOR_PUBLICATION");
      assert.ok(published.findings?.every((item) => item.resolution && item.resolution.steps.length > 0));
    }
  });
});
