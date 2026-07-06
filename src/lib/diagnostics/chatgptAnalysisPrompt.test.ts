import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildChatGptAnalysisPromptMarkdown,
  buildReadmeForChatGptBundle,
  CHATGPT_ANALYSIS_PROMPT_FILENAME,
} from "./chatgptAnalysisPrompt.js";
import {
  assertRequiredBundleStructure,
  buildChatGptDiagnosticBundle,
} from "./diagnosticBundleBuilder.server.js";
import { assertBundleContainsNoForbiddenSecrets } from "./sanitizeDiagnosticPayload.server.js";

describe("chatgptAnalysisPrompt", () => {
  it("gera CHATGPT_ANALYSIS_PROMPT.md em todo bundle", () => {
    for (const scope of [
      "SYSTEM",
      "PRODUCT_ENGINEERING",
      "PUBLISHED_PRICE",
      "COMMISSION_RECEIPT_CLOSING",
    ] as const) {
      const bundle = buildChatGptDiagnosticBundle({ scope });
      assert.ok(bundle.entries[CHATGPT_ANALYSIS_PROMPT_FILENAME], scope);
    }
  });

  it("inclui regra-mãe do sistema", () => {
    const prompt = buildChatGptAnalysisPromptMarkdown("SYSTEM");
    assert.match(prompt, /Custo nasce na engenharia/);
    assert.match(prompt, /Fechamento congela o resultado/);
  });

  it("inclui ordem de leitura", () => {
    const prompt = buildChatGptAnalysisPromptMarkdown();
    assert.match(prompt, /01_EXECUTIVE_SUMMARY\.md/);
    assert.match(prompt, /04_DIAGNOSTICS\.json/);
    assert.match(prompt, /sourceRefs/);
  });

  it("inclui formato de resposta esperado", () => {
    const prompt = buildChatGptAnalysisPromptMarkdown();
    assert.match(prompt, /Diagnóstico resumido/);
    assert.match(prompt, /Prompt sugerido para o Cursor/);
    assert.match(prompt, /Causa provável/);
  });

  it("pede classificação dos 9 tipos de erro", () => {
    const prompt = buildChatGptAnalysisPromptMarkdown();
    assert.match(prompt, /erro de cálculo/);
    assert.match(prompt, /erro de API\/backend/);
    assert.match(prompt, /divergência entre versão publicada/);
  });

  it("evita suposições e pede evidência por arquivo", () => {
    const prompt = buildChatGptAnalysisPromptMarkdown();
    assert.match(prompt, /Não assuma dados fora do pacote/);
    assert.match(prompt, /Cite o arquivo\/caminho/);
    assert.match(prompt, /Quando um dado estiver ausente/);
  });

  it("está em português e não contém segredos", () => {
    const prompt = buildChatGptAnalysisPromptMarkdown("COMMISSION_RECEIPT_CLOSING");
    assert.match(prompt, /IndusCost/);
    assert.doesNotMatch(prompt, /postgresql:\/\//);
    assert.doesNotMatch(prompt, /Bearer /);
    assert.doesNotMatch(prompt, /DATABASE_URL/);
    assertBundleContainsNoForbiddenSecrets(prompt);
  });

  it("README referencia CHATGPT_ANALYSIS_PROMPT.md", () => {
    const readme = buildReadmeForChatGptBundle("SYSTEM");
    assert.match(readme, /CHATGPT_ANALYSIS_PROMPT\.md/);
    assert.match(readme, /Regra-mãe/);
  });

  it("bundle SYSTEM inclui prompt no manifest", () => {
    const bundle = buildChatGptDiagnosticBundle({ scope: "SYSTEM" });
    assertRequiredBundleStructure(bundle);
    const manifest = JSON.parse(bundle.entries["manifest.json"]);
    assert.ok(
      manifest.files.some(
        (f: { path: string }) => f.path === CHATGPT_ANALYSIS_PROMPT_FILENAME
      )
    );
  });
});
