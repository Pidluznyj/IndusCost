# Validação — Gerar Relatório Analisável (ChatGPT)

> **Data da validação:** 2026-07-06  
> **Commit de referência:** `5221c82` (CLI) + validação deste documento  
> **Status geral:** **APROVADO COM RESSALVAS**

---

## 1. Scopes validados

| Scope | Geração CLI (ambiente local) | Bundle / estrutura | Sanitização | Conteúdo ChatGPT |
| --- | --- | --- | --- | --- |
| `SYSTEM` | ✅ Live (`--json-summary`) | ✅ 28 arquivos, ZIP ~17 KB | ✅ `15_REDACTION_REPORT.json` | ✅ Executive summary completo |
| `PRODUCT_ENGINEERING` | ⚠️ Requer `DATABASE_URL` | ✅ Testes unitários + mock 618.08AA | ✅ | ✅ Warning falso de custo (`TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT`) |
| `PUBLISHED_PRICE` | ⚠️ Requer `DATABASE_URL` | ✅ Testes 618.08AA + VAREJO_2 | ✅ | ✅ Fonte congelada + custo 0.912785 |
| `COMMISSION_RECEIPT_CLOSING` | ⚠️ Requer `DATABASE_URL` | ✅ Testes jun/2026 + preview Prisma | ✅ | ✅ NO_SCHEDULE / preview / erro Prisma |
| `COST_TO_CASH` | ⚠️ Requer `DATABASE_URL` | ✅ Testes timeline 12 passos + TRACE_PARTIAL | ✅ | ✅ Cadeia parcial documentada |

**Ressalva:** Neste ambiente de validação CI/agente não havia `.env` com `DATABASE_URL`. Escopos com banco foram validados via **suite de testes** (`npm run test:diagnostic-bundle`) e bundles mock. Em máquina de desenvolvimento com `.env`, executar os comandos abaixo para validação E2E completa.

---

## 2. Arquivos gerados (estrutura ZIP)

Todo pacote inclui (confirmado em `SYSTEM` live + testes):

| Arquivo | Obrigatório | Função |
| --- | --- | --- |
| `00_README_FOR_CHATGPT.md` | ✅ | Instruções de leitura |
| `CHATGPT_ANALYSIS_PROMPT.md` | ✅ | Prompt otimizado para análise |
| `01_EXECUTIVE_SUMMARY.md` | ✅ | Resumo executivo por escopo |
| `02_PROBLEM_CONTEXT.md` | ✅ | Filtros e contexto da tela |
| `03_DIAGNOSTIC_INDEX.json` | ✅ | Índice de findings |
| `04_DIAGNOSTICS.json` | ✅ | Findings com `sourceRefs` |
| `05_REPRODUCTION_STEPS.md` | ✅ | Comandos de reprodução |
| `06_SYSTEM_SNAPSHOT.json` | ✅ | Git, migrations, env flags |
| `07_SCREEN_CONTEXT.json` | ✅ | Contexto UI |
| `08_API_TRACE.json` | ✅ | Chamadas API (se houver) |
| `09_DATABASE_EVIDENCE.json` | ✅ | Evidências DB limitadas |
| `10_CALCULATION_TRACE.json` | ✅ | Rastreabilidade read-only |
| `11_BUSINESS_RULES_APPLIED.md` | ✅ | Regras de negócio |
| `12_LOGS_SANITIZED.log` | ✅ | Logs sanitizados |
| `13_CODE_REFERENCES.json` | ✅ | Referências de código |
| `14_WARNINGS_AND_ERRORS.json` | ✅ | Subconjunto warning/error |
| `15_REDACTION_REPORT.json` | ✅ | Relatório de redação |
| `manifest.json` | ✅ | SHA256 de cada arquivo |
| `evidence/*.json` | ✅ | Traces por domínio |
| `exports/*.csv` | ✅ | Resumo tabular |

Validador: `npx tsx scripts/validate-chatgpt-diagnostic-zip.ts <caminho.zip>`

---

## 3. Exemplos de comandos

```bash
# SYSTEM (não exige DB; conecta se DATABASE_URL existir)
npx tsx scripts/generate-chatgpt-diagnostic-report.ts \
  --scope=SYSTEM --include-logs --json-summary

# Engenharia 618.08AA
npx tsx scripts/generate-chatgpt-diagnostic-report.ts \
  --scope=PRODUCT_ENGINEERING --sku=618.08AA --include-logs --json-summary

# Preço publicado
npx tsx scripts/generate-chatgpt-diagnostic-report.ts \
  --scope=PUBLISHED_PRICE --sku=618.08AA --table-code=VAREJO_2 --json-summary

# Fechamento por recebimento
npx tsx scripts/generate-chatgpt-diagnostic-report.ts \
  --scope=COMMISSION_RECEIPT_CLOSING --year=2026 --month=6 --seller=GISLENE \
  --include-logs --json-summary

# Cost-to-Cash
npx tsx scripts/generate-chatgpt-diagnostic-report.ts \
  --scope=COST_TO_CASH --sku=618.08AA --year=2026 --month=6 --json-summary

# Validar ZIP gerado
npx tsx scripts/validate-chatgpt-diagnostic-zip.ts tmp/diagnostic-bundles/system-....zip
```

Atalho npm: `npm run generate:chatgpt-diagnostic-report`

---

## 4. Resultado dos testes

### CLI / ZIP (live)

| Comando | Resultado | ZIP |
| --- | --- | --- |
| `SYSTEM --json-summary` | ✅ `status: ERROR`* (findings reais: MIGRATION_PENDING) | `tmp/diagnostic-bundles/system-2026-07-06T22-26-06-480Z.zip` (~17 KB) |
| `PRODUCT_ENGINEERING 618.08AA` | ⚠️ Bloqueado sem `DATABASE_URL` | — |
| `PUBLISHED_PRICE 618.08AA VAREJO_2` | ⚠️ Bloqueado sem `DATABASE_URL` | — |
| `COMMISSION_RECEIPT_CLOSING 2026/6 GISLENE` | ⚠️ Bloqueado sem `DATABASE_URL` | — |
| `COST_TO_CASH 618.08AA 2026/6` | ⚠️ Bloqueado sem `DATABASE_URL` | — |

\* `status: ERROR` no JSON summary reflete **findings de severidade error** no pacote (ex.: migrations pendentes), não falha na geração. `ok: true` confirma ZIP válido.

### Suite automatizada

```bash
npm run test:diagnostic-bundle   # 101 testes — inclui validateChatGptDiagnosticZip
npm run test:commissions         # 368 testes
npm run build                    # ✅
npm run check:frontend-server-imports  # ✅
npm run check:browser-bundle     # ✅
```

---

## 5. Garantias de sanitização

- `sanitizeDiagnosticPayload` + `15_REDACTION_REPORT.json` em todo bundle.
- Flags de ambiente (`DATABASE_URL_CONFIGURED`) aparecem como `[REDACTED:...]`, nunca connection string.
- Validador rejeita: `postgresql://`, Bearer tokens, JWT, cookies literais, senhas em texto claro.
- Menções documentais à palavra “DATABASE_URL” (ex.: “Sem tokens ou DATABASE_URL completo”) **não** são tratadas como vazamento.
- Artefatos gravados **somente** em `tmp/diagnostic-bundles/` (`.gitignore`).

---

## 6. Limitações conhecidas

1. **DATABASE_URL obrigatória** para escopos de domínio (produto, preço, comissão, cost-to-cash).
2. **SYSTEM sem DB** reporta `databaseConfigured: false` e migrations pendentes no filesystem — esperado em ambiente sem `.env`.
3. **COST_TO_CASH por SKU + período** pode retornar `TRACE_PARTIAL` se não houver venda Nomus vinculada — comportamento correto.
4. **SALES_ORDER** tem bundle mínimo via CLI (escopo secundário).
5. **Tamanho:** limite soft 25 MB por ZIP; bundles típicos &lt; 500 KB.
6. **Frontend:** download depende de sessão autenticada + permissões; CLI funciona com tela quebrada.

---

## 7. Como enviar ao ChatGPT

1. Gere o ZIP pelo botão **Gerar Relatório Analisável** ou pelo CLI.
2. Anexe o ZIP na conversa do ChatGPT.
3. Cole também o conteúdo de `CHATGPT_ANALYSIS_PROMPT.md` (já incluso no ZIP) ou use o botão **Copiar resumo** do modal.
4. Peça: *“Analise este pacote diagnóstico IndusCost e diga a causa provável do problema, citando arquivos de evidência.”*
5. Ordem sugerida de leitura (para o modelo): `CHATGPT_ANALYSIS_PROMPT.md` → `01_EXECUTIVE_SUMMARY.md` → `04_DIAGNOSTICS.json` → `evidence/*` → `10_CALCULATION_TRACE.json`.

---

## 8. Critérios de aceite (checklist)

| # | Critério | Resultado |
| --- | --- | --- |
| 1 | Explicar warning falso de custo | ✅ `TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT` em PE |
| 2 | Explicar preço publicado e fonte | ✅ `OK_PRICE_USES_PUBLISHED_COST`, snapshots congelados |
| 3 | Explicar erro comissão/preview | ✅ `UNKNOWN_FIELD_IN_SELECT`, capture API em CRC |
| 4 | Apontar falta de schedule | ✅ `NO_SCHEDULE` / `RECEIVABLE_SCHEDULE_MISSING` |
| 5 | Cadeia Cost-to-Cash parcial/completa | ✅ Timeline 12 passos + `TRACE_PARTIAL` / `TRACE_COMPLETE` |
| 6 | Seguro para ChatGPT | ✅ Sanitização + validador |
| 7 | Sem segredos | ✅ Validador live SYSTEM: 0 forbidden hits |
| 8 | Git limpo | ✅ `tmp/` gitignored; `gitWorkingTreeClean: true` no summary |
| 9 | Build passa | ✅ |
| 10 | Checks passam | ✅ |

---

## 9. Frontend validado (código + testes)

| Tela | Arquivo | Scope |
| --- | --- | --- |
| Produto → Engenharia | `ProductModule.tsx` | `PRODUCT_ENGINEERING` |
| Modal preço publicado | `PricingModule.tsx` | `PUBLISHED_PRICE` |
| Comissões → Fechamento por Recebimento | `CommissionsReceiptClosingPage.tsx` | `COMMISSION_RECEIPT_CLOSING` |
| Admin / Sistema | `SettingsModule.tsx` | `SYSTEM` |
| Rastreabilidade Cost-to-Cash | `CostToCashTracePage.tsx` | `COST_TO_CASH` |

Comportamento modal (`DiagnosticReportButton.tsx`):

- Abre modal com opções de inclusão.
- Download ZIP via `zipBase64`.
- Erro amigável: *“Não foi possível gerar o relatório analisável.”* ou mensagem da API.
- Copiar resumo executivo para ChatGPT.

Testes: `diagnosticReportClient.test.ts` (integração estática).

---

## 10. Resultados por cenário (testes / mocks)

### 618.08AA — PRODUCT_ENGINEERING

- Custo oficial = engenharia (0.912785) → **sem** `DIVERGENT_COST`.
- Warning: `TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT` (snapshot técnico pendente **sem impacto de custo**).
- Evidência: `evidence/product-cost-trace.json`, `10_CALCULATION_TRACE.json`.

### 618.08AA — PUBLISHED_PRICE VAREJO_2

- Custo congelado: **0.912785**; diagnóstico: `OK_PRICE_USES_PUBLISHED_COST`.
- Modo **read-only** — preço não recalculado.
- Evidência: `evidence/published-price-trace.json`.

### Comissão jun/2026 — seller GISLENE

- Preview via `getReceiptClosingPreviewPage` (mesmo service da tela).
- `NO_SCHEDULE` tratado como status auditável, não erro 500.
- Erro Prisma (`UNKNOWN_FIELD_IN_SELECT`) capturado e sanitizado no bundle.
- Evidência: `evidence/commission-trace.json`, `08_API_TRACE.json`.

### COST_TO_CASH — 618.08AA — 2026/6

- Timeline 12 passos; produto + preço **FOUND**; pedido Nomus **MISSING** → `TRACE_PARTIAL`.
- Mensagem: *“produto e preço encontrados, mas nenhuma venda Nomus vinculada…”*
- `SalesOrderItem.unitCost` Nomus **não** usado como custo industrial.
- Evidência: `evidence/cost-to-cash-timeline.json`.

---

## 11. Próximas melhorias

1. Job CI opcional com `DATABASE_URL` de staging para gerar os 5 ZIPs E2E em pipeline.
2. Botão de validação pós-download no modal (checksum + contagem de redactions).
3. Escopo `SALES_ORDER` completo (paridade com cost-to-cash sales trace).
4. Executive summary SYSTEM: linha explícita “Evidências: ver `06_SYSTEM_SNAPSHOT.json`”.
5. Integrar `validate-chatgpt-diagnostic-zip.ts` ao fluxo pós-geração automático no CLI.

---

## Referências

- Formato do pacote: [chatgpt-diagnostic-bundle-format.md](./chatgpt-diagnostic-bundle-format.md)
- CLI: `scripts/generate-chatgpt-diagnostic-report.ts`
- Validador: `scripts/validate-chatgpt-diagnostic-zip.ts`
- API: `POST /api/diagnostics/report`
