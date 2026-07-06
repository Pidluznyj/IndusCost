# ChatGPT Analyzable Diagnostic Bundle

> **Nome funcional:** Gerar Relatório Analisável  
> **Nome técnico:** ChatGPT Analyzable Diagnostic Bundle  
> **Versão:** 1.0.0  
> **Projeto:** IndusCost / My Industry

---

## Finalidade

Pacote ZIP read-only para anexar ao ChatGPT e obter diagnóstico técnico/negocial com máximo de contexto rastreável — sem expor segredos nem despejar o banco inteiro.

O ChatGPT deve conseguir responder:

> “Analise este relatório e diga a causa provável do erro.”

---

## Checklist YAGNI / reutilização

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Services audit/trace reaproveitáveis? | **Sim** — `buildProductCostTrace`, `buildPublishedPriceTrace`, `buildSalesOrderTrace`, `buildCommissionTrace`, `buildCostToCashTrace` alimentam `evidence/` |
| 2 | Scripts trace existentes? | **Sim** — `audit-*-trace.ts` |
| 3 | Service de export/diagnóstico? | **Sim** — `costToCashTraceDossier` (JSON/CSV browser); bundle estende com ZIP multi-arquivo |
| 4 | Padrão de download? | **Sim** — Blob browser (dossiê) + ZIP em `tmp/` (CLI) |
| 5 | Pasta segura fora do repo? | **Sim** — `tmp/diagnostic-bundles/` (`.gitignore`) |
| 6 | Evitar sujar git? | Gravação **somente** em `tmp/`; builder valida prefixo |
| 7 | Sanitizar segredos? | `sanitizeDiagnosticPayload` + `15_REDACTION_REPORT.json` |
| 8 | Limitar tamanho? | `DIAGNOSTIC_BUNDLE_MAX_FILE_BYTES` (2MB), `MAX_TOTAL_BYTES` (25MB), truncamento JSON |
| 9 | Evidências sem dump do banco? | Apenas registros referenciados + placeholders; trace services por filtro |
| 10 | Número com fonte? | Padrão `DiagnosticSourcedValue` + `sourceRefs` em cada finding |

---

## Regras

- Read-only — não altera dados, não aplica fechamento, não publica custo/preço.
- Não recalcula preço publicado no frontend.
- Não expõe `DATABASE_URL`, tokens, cookies, senhas.

---

## Estrutura obrigatória do ZIP

```
diagnostic-bundle.zip
├── 00_README_FOR_CHATGPT.md
├── 01_EXECUTIVE_SUMMARY.md
├── 02_PROBLEM_CONTEXT.md
├── 03_DIAGNOSTIC_INDEX.json
├── 04_DIAGNOSTICS.json
├── 04_DIAGNOSTICS.jsonl
├── 05_REPRODUCTION_STEPS.md
├── 06_SYSTEM_SNAPSHOT.json
├── 07_SCREEN_CONTEXT.json
├── 08_API_TRACE.json
├── 09_DATABASE_EVIDENCE.json
├── 10_CALCULATION_TRACE.json
├── 11_BUSINESS_RULES_APPLIED.md
├── 12_LOGS_SANITIZED.log
├── 13_CODE_REFERENCES.json
├── 14_WARNINGS_AND_ERRORS.json
├── 15_REDACTION_REPORT.json
├── evidence/
│   ├── product-cost-trace.json
│   ├── published-price-trace.json
│   ├── sales-order-trace.json
│   ├── commission-trace.json
│   ├── system/bundle-meta.json
│   └── raw-limited/
├── exports/
│   ├── summary.csv
│   └── diagnostics.csv
└── manifest.json
```

---

## Escopos (`DiagnosticScope`)

| Escopo | Uso |
|--------|-----|
| `PRODUCT_ENGINEERING` | Engenharia / custo / BOM |
| `PUBLISHED_PRICE` | Preço publicado / Fonte do Preço |
| `SALES_ORDER` | Pedido Nomus / margem |
| `COMMISSION_RECEIPT_CLOSING` | Fechamento por recebimento |
| `COST_TO_CASH` | Tela rastreabilidade end-to-end |
| `SYSTEM` | Smoke / validação de formato |

---

## Tipos base

Definidos em `src/lib/diagnostics/chatgptDiagnosticTypes.ts`:

- `DiagnosticBundle`
- `DiagnosticManifest`
- `DiagnosticScope`
- `DiagnosticEvidence`
- `DiagnosticFinding`
- `DiagnosticSourceRef`
- `DiagnosticRedactionReport`
- `DiagnosticReproductionCommand`
- `DiagnosticCodeReference`

---

## Padrão de Finding

```json
{
  "id": "finding_001",
  "severity": "info | warning | error | critical",
  "code": "COST_DIFF_PENDING_PUBLICATION",
  "title": "Custo calculado diverge do custo oficial",
  "message": "Texto claro para humano",
  "businessImpact": "Impacto negocial",
  "technicalImpact": "Impacto técnico",
  "evidenceRefs": ["evidence.productCost.officialCost"],
  "sourceRefs": [
    {
      "type": "database",
      "name": "ProductionCostTableItem",
      "path": "09_DATABASE_EVIDENCE.json#/productionCost/items/0"
    }
  ],
  "suggestedNextSteps": ["Verificar publicação de custo"]
}
```

---

## Padrão de Source Ref (valor com origem)

```json
{
  "value": 0.912785,
  "source": {
    "type": "database",
    "table": "ProductionCostTableItem",
    "recordId": "...",
    "field": "industrialCost",
    "versionId": "...",
    "path": "09_DATABASE_EVIDENCE.json#/productionCost/currentOfficialCost"
  }
}
```

---

## Como o ChatGPT deve ler o pacote

1. Ler `00_README_FOR_CHATGPT.md`
2. Ler `01_EXECUTIVE_SUMMARY.md` e `02_PROBLEM_CONTEXT.md`
3. Indexar `03_DIAGNOSTIC_INDEX.json` e findings em `04_DIAGNOSTICS.json`
4. Seguir `sourceRefs` para `09_DATABASE_EVIDENCE.json` e `evidence/*.json`
5. Usar `05_REPRODUCTION_STEPS.md` para reproduzir
6. Consultar `13_CODE_REFERENCES.json` para arquivos de código prováveis
7. Não assumir dados fora do pacote; declarar incertezas

---

## Implementação

| Artefato | Caminho |
|----------|---------|
| Tipos | `src/lib/diagnostics/chatgptDiagnosticTypes.ts` |
| Source refs / sanitização | `src/lib/diagnostics/diagnosticSourceRefs.server.ts` |
| Builder ZIP | `src/lib/diagnostics/diagnosticBundleBuilder.server.ts` |
| CLI | `scripts/generate-diagnostic-bundle.ts` |
| Testes | `src/lib/diagnostics/chatgptDiagnosticBundle.test.ts` |

### Gerar bundle SYSTEM (smoke)

```bash
npx tsx scripts/generate-diagnostic-bundle.ts --scope=SYSTEM
npm run test:diagnostic-bundle
```

Saída: `tmp/diagnostic-bundles/system-<timestamp>/` e `tmp/diagnostic-bundles/system-<timestamp>.zip`

---

## Integração futura (UI)

Botão **“Gerar Relatório Analisável”** em telas de erro/diagnóstico:

1. Capturar `07_SCREEN_CONTEXT.json` + `08_API_TRACE.json` do estado atual
2. Chamar trace services conforme escopo/filtros
3. Montar bundle server-side
4. Download ZIP via HTTP (stream) — **sem gravar no repo**

---

## Regra-mãe do domínio (incluída em `11_BUSINESS_RULES_APPLIED.md`)

Custo → engenharia → publicação → preço congelado → venda Nomus → comissão materializada → recebimento → fechamento congela.
