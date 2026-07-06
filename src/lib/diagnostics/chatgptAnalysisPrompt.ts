/**
 * Prompt pronto para colar no ChatGPT junto com o ZIP diagnóstico.
 * Read-only; sem segredos; válido para qualquer escopo do bundle.
 */
import type { DiagnosticScope } from "./chatgptDiagnosticTypes.js";

export const CHATGPT_ANALYSIS_PROMPT_FILENAME = "CHATGPT_ANALYSIS_PROMPT.md";

/** Texto fixo do prompt — exportado para testes. */
export function buildChatGptAnalysisPromptMarkdown(scope?: DiagnosticScope | null): string {
  const scopeLine = scope?.trim()
    ? `\n> Escopo deste pacote: **${scope.trim()}**\n`
    : "";

  return `Você está recebendo um pacote diagnóstico gerado pelo IndusCost/My Industry.
${scopeLine}
## Objetivo

Analise o pacote e identifique a causa provável do problema, separando:

1. erro de cálculo;
2. erro de dados;
3. erro visual/frontend;
4. erro de API/backend;
5. erro de banco/schema;
6. erro de regra de negócio;
7. problema de configuração;
8. falta de materialização/snapshot;
9. divergência entre versão publicada e dado atual.

## Ordem de leitura

1. \`01_EXECUTIVE_SUMMARY.md\`
2. \`03_DIAGNOSTIC_INDEX.json\`
3. \`04_DIAGNOSTICS.json\`
4. \`05_REPRODUCTION_STEPS.md\`
5. Arquivos citados em \`sourceRefs\` e em \`evidence/\`

## Regras

- Não assuma dados fora do pacote.
- Quando um dado estiver ausente, diga que está ausente.
- Cite o arquivo/caminho que sustenta cada conclusão.
- Diferencie **fato**, **hipótese** e **recomendação**.
- Priorize correções de menor risco.
- Não recomende alteração manual no banco sem backup e validação.
- Não recomende remover histórico publicado.
- Para custo/preço/comissão, respeite a regra-mãe:
  - Custo nasce na engenharia.
  - Preço nasce do custo publicado.
  - Venda vem do Nomus.
  - Comissão nasce da venda.
  - Pagamento da comissão nasce do recebimento.
  - Fechamento congela o resultado.

## Resposta esperada

1. Diagnóstico resumido.
2. Causa provável.
3. Evidências (com caminhos de arquivo).
4. Impacto negocial.
5. Impacto técnico.
6. Correção recomendada.
7. Validações necessárias.
8. Prompt sugerido para o Cursor corrigir, se aplicável.
`;
}

export function buildReadmeForChatGptBundle(scope?: DiagnosticScope | null): string {
  const scopeNote = scope?.trim() ? `\n- **Escopo:** ${scope.trim()}` : "";
  return `# README for ChatGPT — IndusCost Diagnostic Bundle

Você está recebendo um pacote diagnóstico do sistema **IndusCost / My Industry**.${scopeNote}

## Como usar (usuário humano)

1. Anexe este ZIP ao ChatGPT.
2. Copie e cole o conteúido de \`CHATGPT_ANALYSIS_PROMPT.md\` como primeira mensagem.
3. Aguarde a análise estruturada conforme a seção "Resposta esperada" do prompt.

## Ordem de leitura (analista)

1. \`CHATGPT_ANALYSIS_PROMPT.md\` — instruções de análise
2. \`01_EXECUTIVE_SUMMARY.md\`
3. \`03_DIAGNOSTIC_INDEX.json\`
4. \`04_DIAGNOSTICS.json\`
5. \`05_REPRODUCTION_STEPS.md\`
6. Arquivos de evidência em \`evidence/\` conforme \`sourceRefs\`

## Regras

- **Não assuma dados fora deste pacote.**
- Aponte incertezas explicitamente.
- Classifique o tipo de erro (cálculo, dados, visual, API, banco, regra, configuração, snapshot, divergência publicada).
- Todo número relevante deve ter \`sourceRefs\` ou \`source\` em evidências do pacote.
- O pacote é **read-only** — não altera custo, preço, comissão nem fechamento.

## Regra-mãe do domínio

Custo nasce na engenharia → preço do custo publicado → venda Nomus → comissão da venda → pagamento no recebimento → fechamento congela.
`;
}
