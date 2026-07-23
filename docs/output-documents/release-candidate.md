# DS-06.2 — Release candidate: Comercial → Documentos de Saída

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Escopo** | Revisão integral DS-03 (stage) + DS-04 (APIs/permissões) + DS-05 (UI) + DS-06.1 (resolver nas telas existentes) |
| **Data** | 2026-07-20 |
| **Status** | **RC aprovado em testes locais** (cron/DB de produção dependem do servidor) |
| **Commit esperado** | `chore(output-documents): finalize commercial document module` |

Documentos relacionados:

- [`stage-release-candidate.md`](./stage-release-candidate.md) — DS-03.10 (sync/cron/health)
- [`stage-remediation-plan.md`](./stage-remediation-plan.md) — plano do stage
- [`stage-repair-runbook.md`](./stage-repair-runbook.md) — repair fill-only
- [`db-audit-runbook.md`](./db-audit-runbook.md) — auditoria read-only
- [`code-inventory.md`](./code-inventory.md) — inventário técnico

---

## 1. Arquitetura final

```text
Nomus GET /rest/documentosEstoque
  → scripts/nomusStockDocumentsSync.ts (+ runner incremental)
  → NomusStockDocument (+ NomusStockDocumentItem)
       │ payloadHash · presentInLastPayload · firstSeenAt/lastSeenAt
       │
       ├─ repair fill-only (rawJson local, sem HTTP)
       │
       └─ Resolver canônico (read-only)
            ├─ NF  (idNfe → NomusNfe.externalId)
            ├─ Pedidos (SalesOrderNfeLink)
            ├─ CR (NomusAccountsReceivable.sourceInvoiceId)
            ├─ O2C overlay (OrderToCashAuditFact) — alocação; não bloqueia listagem
            └─ Status financeiro (CR > condição do doc > previsão do pedido)

APIs comerciais (granulares):
  GET /api/commercial/output-documents/summary
  GET /api/commercial/output-documents
  GET /api/commercial/output-documents/:id   (+ includeRaw gated)

UI:
  /output-documents → OutputDocumentsModule (filtros, cards, grid, paginação)
  Drawer OutputDocumentDetailOverlay (geral · itens · pedidos · nfes · financeiro · auditoria)

Telas existentes (consumidores read-only do resolver):
  Detalhe do Pedido · Auditoria 360°
```

**Não existe** model `OutputDocument` paralelo. A verdade de stage é `NomusStockDocument`.  
**Não há FK** Documento→Pedido/NF/CR — apenas igualdade de IDs externos + O2C derivado.

---

## 2. Checklist de aceite (DS-03 → DS-06.1)

| Área | Status | Evidência |
|---|---|---|
| Schema aditivo | OK | `NomusStockDocument` + itens; enrichment `20260731120000` |
| Migration | OK* | CREATE + ADD colunas; *deploy live = servidor |
| Mapper | OK | `normalizeStockDocumentHeader` / `nomusStockDocumentsMapper` |
| payloadHash | OK | SHA-256 canônico; unchanged se igual |
| Presence | OK | `firstSeenAt` / `lastSeenAt` / `presentInLastPayload` (janela; sem wipe global) |
| Proteção payload parcial | OK | `decideStockDocumentItemsAction` → preserve itens |
| Sync | OK | preview/apply + runner incremental |
| Lock | OK | `/tmp/induscost-nomus-stock-documents.lock`; soft-skip |
| Reparo preview/apply | OK | fill-only a partir de `rawJson` |
| Resolver | OK | `nomusOutputDocumentResolver` |
| Alocações | OK | total 1×; alocado por pedido; item unresolved/parcial |
| Itens | OK | stage + projeção + identidade SKU |
| NF-e | OK | `idNfe` lógico; status cancelamento |
| CR | OK | via NF / `sourceInvoiceId` |
| Financeiro | OK | `outputDocumentFinancialStatusResolver` |
| APIs | OK | list/summary/detail + Admin stock-documents status/run |
| Filtros / cards / grid | OK | `OutputDocumentsModule` |
| Drawer / abas | OK | 6 abas; empty dashed; `1400px` |
| Permissões | OK | `commercial.output_documents*` granulares |
| rawJson | OK | só com `commercial.output_documents.raw` + `includeRaw` |
| Escopo comercial | OK | portfolio/seller scope em listagem |
| Telas existentes | OK | resolver canônico no detalhe Pedido / Audit 360 |
| Auditoria read-only | OK | `audit:output-documents:db` + guard |

---

## 3. Migrations

| Migration | Papel |
|---|---|
| `20260710180000_nomus_stock_documents` | Cria `NomusStockDocument` / `NomusStockDocumentItem` |
| `20260731120000_nomus_stock_document_header_enrichment` | Cabeçalho enriquecido + `payloadHash` + presence |

Aditivas e retrocompatíveis. Não alteram Pedido / NF-e / AR / comissões.

---

## 4. Scripts para o servidor

### Sync

```bash
# --from/--to = dias-calendário inclusivos (DS-SYNC-03: Nomus recebe to+1 dia no dataEmissao<=)
npm run sync:nomus:stock-documents:preview -- --from=YYYY-MM-DD --to=YYYY-MM-DD
npm run sync:nomus:stock-documents:apply -- --from=YYYY-MM-DD --to=YYYY-MM-DD
./scripts/runNomusStockDocumentsSync.sh apply   # incremental (cron)
npm run sync:nomus:stock-documents:runner:apply
```

Cron sugerido (DS-03.10):

```cron
23 */2 * * * INDUSCOST_APP_DIR=/opt/induscost /opt/induscost/scripts/runNomusStockDocumentsSync.sh apply >> /var/log/induscost-nomus-stock-documents-cron.log 2>&1
```

### Repair (fill-only, sem Nomus HTTP)

```bash
npm run repair:nomus:stock-documents:preview
npm run repair:nomus:stock-documents:apply
```

### Auditoria DB (read-only)

```bash
npm run audit:output-documents:db
```

### Health / Admin

- `GET /api/settings/nomus-sync/stock-documents-status`
- `POST /api/settings/nomus-sync/stock-documents-run`

---

## 5. Permissões

| Recurso | Uso |
|---|---|
| `commercial.output_documents` | Lista / summary / menu |
| `commercial.output_documents.detail` | Drawer detalhe |
| `commercial.output_documents.financial` | Aba Financeiro |
| `commercial.output_documents.audit` | Aba Auditoria |
| `commercial.output_documents.raw` | Accordion `rawJson` (`includeRaw`) |

Alias de seed UI: `comercial.documentos_saida` ↔ contrato `commercial.output_documents`.  
Legacy bags (`output_documents.view`, …) aceitos em `legacyCompatMode`.

---

## 6. Fixtures RC (cenários obrigatórios)

Arquivo: `src/lib/output-documents/outputDocumentsReleaseCandidate.fixtures.ts`  
Teste: `src/lib/output-documents/outputDocumentsReleaseCandidate.test.ts`

| id | Label | Expectativa-chave |
|---|---|---|
| `simple` | documento simples | listagem stage; CR `cr_em_aberto`; cobertura completa |
| `cancelled` | documento cancelado | financeiro `cancelado`; wash rose na grid |
| `without_items` | documento sem itens | 0 itens; listável |
| `multi_order` | documento com vários pedidos | 2 pedidos; alocações separadas |
| `partially_allocated` | documento parcialmente alocado | cobertura `parcial`; O2C overlay |
| `nfe_without_cr` | documento com NF sem CR | `aguardando_cr` |
| `cr_open` | documento com CR aberto | `cr_em_aberto` |
| `received` | documento recebido | `recebido` |
| `without_o2c` | documento sem O2C | `dependsOnO2cForListing=false`; `sem_informacao_financeira` |
| `unresolved_item` | item não resolvido | `DOCUMENT_ITEM_UNRESOLVED`; cobertura `nao_alocado` |

---

## 7. Testes

```bash
npx prisma format
npx prisma validate
npm run test:nomus:stock-documents
npm run test:output-documents:sync-integration
npm run test:output-documents:resolver
npm run test:output-documents:allocation
npm run test:output-documents:financial-status
npm run test:output-documents:list-api
npm run test:output-documents:detail-api
npm run test:output-documents:permissions
npm run test:output-documents:page
npm run test:output-documents:rc
npm run test:output-documents:audit-db
npm test
npm run build
git diff --check
```

---

## 8. Desempenho (revisão estática)

| Ponto | Avaliação |
|---|---|
| Listagem | Paginação server-side (`pageSize` 50); filtros em WHERE Prisma |
| Summary | Agregações dedicadas (não N+1 por linha) |
| Detalhe | 1 documento + relações por id; financial/audit/raw gated |
| Grid UI | Dual scroll só no grid (`min-w-[1180px]`); página sem overflow horizontal |
| Sync | Paginação Nomus + lock exclusivo; soft-skip em overlap |
| O2C | Overlay; **não** obrigatório para listar documentos |

Riscos remanescentes no servidor: janela incremental na primeira execução; rebuild O2C fora deste sync.

---

## 9. Segurança (revisão)

| Controle | Status |
|---|---|
| Authorize por resourceKey + action `view` | OK |
| rawJson nunca por flag sozinha | OK (`decideOutputDocumentRawAccess`) |
| Escopo seller/portfolio na listagem | OK |
| Audit DB read-only (sem writes) | OK (guard + testes) |
| Repair não reescreve rawJson/itens/IDs | OK |
| Sync não chama orquestrador comercial hard-fail | OK |
| Mask de identificadores nos reports de audit | OK |

---

## 10. Validação visual (1366×768 · 1920×1080 · zoom 100%)

Alinhado a Ordens de Produção:

| Item | Resultado |
|---|---|
| Largura / espaçamento / tipografia | `space-y-4`, filtros `p-3`, thead uppercase muted |
| Cards KPI | SystemTotalizer tones soft (warning/danger claros) |
| Chips status | OverlayBadge soft: cancelado rose · aguardando CR amber · recebido emerald |
| Grid | Dual scroll; sem texto cortado (ellipsis + title); cancelado `bg-rose-50/50` |
| Paginação | Anterior/Próxima; só se `totalPages > 1` |
| Drawer | `size=full` `max-w-[1400px]`; abas pill; empty dashed |
| Scroll página | Sem horizontal desnecessário; horizontal só no grid |

Validação automatizada: `outputDocumentsPage.test.ts` + assertions visuais no RC test.  
Validação interativa no browser autenticado: **depende do servidor** (credenciais/dados).

---

## 11. Limitações dependentes do servidor

1. Cron `runNomusStockDocumentsSync.sh` instalado e com checkpoint real.
2. `npx prisma migrate deploy` no Postgres de produção/homologação.
3. Primeira janela incremental + volume real de documentos.
4. Rebuild O2C / conciliação — rotinas próprias, fora do sync de stock-documents.
5. Smoke autenticado da UI `/output-documents` com personas reais.
6. Admin card visual opcional (API já existe).

Fora de escopo consciente: comissões unificadas, `InventoryMovement`, segunda tabela master de Documento de Saída.

---

## 12. Commits da sequência (output-documents)

| Fase | Commits (amostra) | Tema |
|---|---|---|
| DS-02 audit | `26dad60`…`984d6ce` | Auditor DB read-only + docs |
| DS-03 stage | `c82ef9d`…`35b51da` | Preserve parcial, schema, sync, repair, resolver, financeiro, RC stage |
| DS-04 APIs | `cd51c0a`…`bbd0189` | List/summary/detail + permissões |
| DS-05 UI | `236ef35`…`a822367` | Grid, drawer, interações, polish visual |
| DS-06.1 | `9c9f3cf` | Resolver canônico nas telas existentes |
| DS-06.2 | *(este)* | RC comercial + fixtures + doc |

Lista completa: `git log --oneline --grep=output-document -i`.

---

## 13. Checks deste RC

| Check | Resultado |
|---|---|
| `npx prisma format` | OK |
| `npx prisma validate` | OK (com `DATABASE_URL` dummy local de schema) |
| Testes direcionados OD | OK (stock-documents, sync-integration, resolver, allocation, financial-status, list/detail APIs, permissions, page, rc, audit-db) |
| `npm test` | OK |
| `npm run build` | OK |
| `git diff --check` | OK |
| Revisão segurança | OK (estática — §9; sem regressão de permissões/raw/audit) |
| Revisão desempenho | OK (estática — §8) |
| Visual 1366/1920 | OK (layout + testes; browser autenticado no servidor) |
