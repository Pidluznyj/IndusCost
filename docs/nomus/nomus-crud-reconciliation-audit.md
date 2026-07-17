# SYNC-01 — Auditoria CRUD e reconciliação das sincronizações Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-01 |
| **Atualizado** | 2026-07-17 |
| **Escopo** | Pedidos de Venda · Contas a Receber · Contas a Pagar |
| **Natureza** | Auditoria e documentação **somente** |
| **Proibido nesta etapa** | Alterar schema, sincronizadores, dados, arquivamento ou consumidores |

---

## 0. Checklist obrigatório (respostas objetivas)

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Isso já existe em algum sincronizador? | **Parcialmente.** CREATE/UPDATE existem nos três. Reconciliação de ausências **não** existe no sync de Pedido/CR/CP. Padrões próximos: `SalesOrderNfeLink.presentInLastPayload`, `NomusProductionOrderSalesLink.isCurrent`, campos de presença em `NomusStockDocument` (sem mark-absent). OP-81 audita órfãos de Pedido (read-only). |
| 2 | O padrão `lastSeenAt` / `presentInLastPayload` do Documento de Saída pode ser reutilizado? | **Sim como modelo de escrita de presença**; **não** como modelo completo de reconciliação — `shouldMarkStockDocumentsAbsent` retorna sempre `false` (sync por janela). Reutilizar a **ideia** + a disciplina de mark-absent só com payload **COMPLETE** (como OP-81 e links de NF/OP). |
| 3 | Cada consulta retorna o universo completo que declara cobrir? | **Pedido:** `recent-window` e `full-reconciliation` cobrem só a janela/páginas da rodada — não o espelho total local. **CR/CP:** janela ampla de vencimento (`01/01/2020`–`31/12/2030`) + `apenasPendentes=false` + até `maxPages×pageSize`; **não** há prova de total Nomus vs local. |
| 4 | Quais filtros/janelas/status/paginações impedem reconciliação? | Pedido: `dataEmissao`/`dataVencimento`, max pages, cursor rotativo, janela recente. CR/CP: `dataInicio`/`dataFim`, `apenasPendentes` (se `true`), `maxPages=200`, page size 1000, parada por página curta/`totalPaginas`. |
| 5 | Há risco de marcar ausentes após payload incompleto? | **Hoje o sync não marca ausentes** — risco inverso (órfãos eternos). Qualquer futuro mark-absent **deve** exigir completude (padrão OP-81 / stock lifecycle). |
| 6 | Quais consumidores consideram todos os registros locais como ativos? | Pedidos: gestão, CRM, Kanban/flow, carteira, O2C, comissões (sem flag de ausência). CR/CP oficiais: mitigados por heurística `syncedAt` (1h); comissões/O2C/auditoria de pedido frequentemente **sem** esse corte. |

**Independência de fontes:** Pedido, CR e CP são universos distintos. Ausência de Pedido **não** implica ausência do CR (ex.: PD 02739 vs CR 17748).

---

## 1. Matriz CREATE / UPDATE / DELETE / REACTIVATE (estado atual)

| Operação | Pedido (`SalesOrder`) | CR (`NomusAccountsReceivable`) | CP (`NomusAccountsPayable`) |
|----------|------------------------|--------------------------------|-----------------------------|
| **CREATE** | `salesOrder.create` + itens `createMany` se não houver match por `externalSalesOrderId`/código | `create` se `externalId` inexistente | Igual CR |
| **UPDATE** | `salesOrder.update` + upsert/stale de itens; custos/margem históricos preservados no header | `update` full se `payloadHash` mudou; senão só `syncedAt` | Igual CR |
| **DELETE físico** | Não | Não | Não |
| **DELETE lógico / ausência** | Não (ordem). Item: `nomusIsStale`. Link NF: `presentInLastPayload` | Não (heurística consumer `syncedAt`) | Não (heurística consumer `syncedAt`) |
| **REACTIVATE** | Implícito: se reaparece no payload, volta a ser atualizado (nunca foi marcado ausente) | Implícito via novo upsert | Implícito via novo upsert |
| **payloadHash** | Não no pedido | Sim | Sim |
| **Modo classificado** | `CREATE_UPDATE_ONLY` | `CREATE_UPDATE_ONLY` (label `full_refresh_upsert` é **enganoso**) | `CREATE_UPDATE_ONLY` (idem) |

---

## 2. Matriz por entidade

### 2.1 Pedidos de Venda

**Arquivos:** `scripts/nomusSalesOrdersSyncV1.ts`, `scripts/runNomusSalesOrdersSync.sh`, `scripts/runNomusSalesOrdersWideReconciliation.sh`, `src/lib/salesOrderNomusSync.server.ts`, `src/lib/nomusSalesOrdersSyncWindow.ts`, OP-81 (`scripts/audit-nomus-sales-orders-orphans.ts`, `src/lib/audit/nomusSalesOrderOrphanAudit*.ts`).

| Tema | Comportamento atual |
|------|---------------------|
| **Endpoint** | `GET /pedidos` |
| **Estratégias** | `recent-window` (default cron) · `full-reconciliation` (cursor/páginas rotativas, janela ampla) |
| **CREATE** | Match falha → `create` com `sourceSystem=NOMUS`, `status=SENT_TO_NOMUS`, `nomusRawResponse`, itens |
| **UPDATE** | Match ok → `update` header (exceto preservação de `totalCost`/`totalMargin*`) + plano de itens |
| **Campos mapeados** | Header comercial atualizado; custos locais preservados no update; itens reescritos; itens sumidos → `nomusIsStale` |
| **payloadHash** | **Não** no `SalesOrder`. Dry-run compara totais/contagens/preços |
| **Ausência de pedido** | **Nada.** Sync só processa o que veio no payload |
| **Soft delete / archive / presence** | Pedido: inexistente. Item: `nomusIsStale` + `nomusLastSeenAt`. NF link: `presentInLastPayload` |
| **recent-window reconcilia ausências?** | **Não** |
| **full-reconciliation compara local×origem?** | **Não no sync** — só amplia/rotaciona fetch. Comparação local×origem = **OP-81 (read-only)** |
| **Hooks pós-sync (apply)** | Comissão · owners comerciais · OPs · recompute fluxo do pedido |

#### Caso concreto — PD 02739 (`externalSalesOrderId` 2737)

1. Removido na origem Nomus.
2. Sync diário/recente **não o toca** (não está no payload).
3. Linha local permanece `SalesOrder` ativa (`SENT_TO_NOMUS`).
4. OP-81, com coleta `COMPLETE` + `--confirm-candidates` → `CONFIRMED_MISSING_IN_NOMUS`.
5. Telas/motores que ainda o tratam como ativo: gestão de pedidos, CRM, Kanban/flow, carteira/maturidade, previsões financeiras ligadas ao pedido, comissões (snapshots), O2C/fatos, relatórios — qualquer `findMany` sem filtro de ausência.

**Classificação do sync de Pedidos:** `CREATE_UPDATE_ONLY`  
*(o nome da estratégia `full-reconciliation` = fetch amplo, **não** reconciliação segura de ausências.)*

---

### 2.2 Contas a Receber

**Arquivos:** `scripts/nomusAccountsReceivableSync.ts`, `scripts/runNomusAccountsReceivableSync.sh`, `src/lib/nomusAccountsReceivableSyncLogic.ts`, `src/lib/nomusAccountsReceivableMapper.ts`, `src/lib/nomusFinancialSyncQueryParams.ts`.

| Tema | Comportamento atual |
|------|---------------------|
| **Endpoint** | `GET /contasReceber` |
| **Label de estratégia** | `full_refresh_upsert` quando `NOMUS_AR_INCREMENTAL=1` (runner) |
| **Parâmetros** | `pagina`, `tamanhoPagina` (default 1000), `dataInicio`/`dataFim` (default 01/01/2020–31/12/2030), `apenasPendentes` (default **`false`**), `ordenacao=dataVencimento` |
| **CREATE** | `externalId` ausente → `create` com campos oficiais + `rawPayload` + `payloadHash` + `syncedAt` |
| **UPDATE** | Hash diferente → update completo (saldo, status, recebimentos, vencimento, etc.). Hash igual → só `syncedAt` |
| **Títulos pagos/liquidados** | Com default `apenasPendentes=false`, **continuam sendo retornados e persistidos** (inclui `settlementDate`, `amountReceived`, `balanceReceivable`) |
| **Cancelados** | Campo `status` (boolean) mapeado; consumidores interpretam `status===false` em alguns fluxos (ex. comissão) |
| **Excluídos na origem** | **Não tratados** — linha local permanece |
| **deleteMany / desativação** | **Não** |
| **Consulta individual por externalId na API Nomus** | **Não implementada** no IndusCost (só lista paginada). Local: `findUnique({ externalId })` |
| **CR 17748 (PD 02739) — arquitetura** | Ciclo de vida próprio por `externalId`. Ausência do Pedido **não** remove o CR. Se o CR sumir da API, a linha envelhece (`syncedAt`) e some de dashboards com cutoff; permanece em DB e em loaders de comissão/O2C sem cutoff |

**O `full_refresh` cobre todos os títulos?**  
Cobre o **universo da query** (janela de datas + `apenasPendentes` + páginas até stop). **Não** prova espelho 1:1 com Nomus. **Não** remove ausentes.

**Classificação:** `CREATE_UPDATE_ONLY`  
Se a expectativa for “DB local = universo atual Nomus”: **`FULL_RECONCILIATION_UNSAFE`**.

---

### 2.3 Contas a Pagar

**Arquivos:** `scripts/nomusAccountsPayableSync.ts`, `scripts/runNomusAccountsPayableSync.sh`, espelhos de lógica/mapper + `nomusFinancialSyncQueryParams.ts`.

| Tema | Comportamento atual |
|------|---------------------|
| **Endpoint** | `GET /contasPagar` |
| **Estratégia / CRUD** | Idêntico ao CR (`full_refresh_upsert` = upsert do payload; sem delete) |
| **Eixo oficial** | **`dataVencimento` / `dueDate`** — agrupamento, filtro e competência operacional (`getAccountsPayableOperationalDueDate`, ledger de fluxo de caixa). `scheduleDate` é informativo |
| **Pagos / cancelados / excluídos** | Pagos e liquidados entram com `apenasPendentes=false`. Cancelados tratados em regras de consumidor. Excluídos na origem **não** são reconciliados |
| **CP ausente no Fluxo de Caixa?** | Dashboards/cash flow aplicam cutoff `syncedAt` + regras de aberto/cancelado — tendem a ocultar ghost. Linha **permanece** na tabela oficial |
| **Consumidores da tabela oficial** | Contas a Pagar, Fluxo de Caixa, Centros de Custo, relatório executivo/presidencial, alocações |

**Classificação:** `CREATE_UPDATE_ONLY` / expectativa de espelho → `FULL_RECONCILIATION_UNSAFE`.

---

## 3. Prova de completude por sincronizador

| | Pedido | CR | CP |
|---|--------|----|----|
| **Endpoint** | `/pedidos` | `/contasReceber` | `/contasPagar` |
| **Estratégia** | `recent-window` / `full-reconciliation` | `full_refresh_upsert` / `full_initial_or_manual` | Idem |
| **Período** | Emissão (recente) ou env amplo | `dataInicio`–`dataFim` (vencimento) | Idem |
| **Filtros** | datas emissão/vencimento | `apenasPendentes`, datas, ordenação | Idem |
| **Page size** | `NOMUS_PAGE_SIZE` (tip. 100) | 1000 (financeiro) | 1000 |
| **Max pages** | tip. 30 (recent) / 5–200 (wide) | 200 default | 200 |
| **Parada** | página vazia, janela excedida, `hasNext`, max pages | página curta / `totalPaginas` / max pages | Idem |
| **HTTP 429** | retry + contador | via `fetchNomusJson` / retries env | Idem |
| **Após erro** | falha da página/run; sem mark-absent | erros de map/apply contados; sem delete | Idem |
| **Payload parcial possível?** | **Sim** (max pages, cursor, janela, 429 fatal) | **Sim** (max pages, erro mid-run) | **Sim** |
| **Como provar COMPLETE hoje** | OP-81 (`fetchCompleteness`) para auditoria. Sync de pedido **não** exporta o mesmo contrato de completude para mark-absent | Contadores `pagesRead`/`recordsRead` — **sem** confronto com total Nomus nem pass de missing | Idem |
| **Classificação do modo** | `CREATE_UPDATE_ONLY` | `CREATE_UPDATE_ONLY` (label unsafe se interpretado como reconciliação) | Idem |

### Classificação dos modos (contrato SYNC-01)

| Modo | Significado | Onde se aplica hoje |
|------|-------------|---------------------|
| **CREATE_UPDATE_ONLY** | Pode criar/atualizar; **não** reconcilia ausências | Sync Pedido, CR, CP |
| **FULL_RECONCILIATION_SAFE** | Coleta completa comprovada + política segura de ausência | **Nenhum** dos três syncs. OP-81 aproxima a **prova** (só leitura) |
| **FULL_RECONCILIATION_UNSAFE** | Declara “full refresh” sem prova suficiente / sem delete seguro | Interpretação do label `full_refresh_upsert` de CR/CP; expectativa errada de espelho |

---

## 4. Lacunas encontradas

1. **Pedido:** sem presence/payloadHash no header; sync não detecta remoção (PD 02739).
2. **Nome enganoso:** `full-reconciliation` (Pedido) e `full_refresh_upsert` (CR/CP) sugerem espelho; são **CREATE_UPDATE_ONLY**.
3. **CR/CP:** sem `lastSeenAt` / `presentInLastPayload` / `isCurrentInNomus`; ausência só mitigada por heurística `syncedAt − 1h` em parte dos consumidores.
4. **Documento de Saída:** campos de presença existem, mas mark-absent está **desligado** (janela).
5. **Sem API Nomus de lookup CR/CP por id** no código IndusCost — confirmação direcionada (estilo OP-81) precisaria de lista filtrada ou novo endpoint.
6. **Comissões / O2C** leem CR local sem cutoff de frescor → ghost titles afetam cálculo se o título sumir na origem.
7. **Fontes independentes** ainda não têm política conjunta documentada operacionalmente (só neste audit).

---

## 5. Riscos

| Risco | Severidade | Notas |
|-------|------------|-------|
| Pedido órfão continua em carteira/CRM/Kanban/comissões | **Alta** | PD 02739 |
| CR/CP ghost com saldo abre relatório se cutoff falhar ou for bypassado | **Alta** | Comissões sem cutoff |
| Marcar ausente em sync parcial (futuro) | **Alta** | Falso positivo em massa |
| Inferir CR ausente a partir de Pedido ausente | **Alta** | Proibido — fontes independentes |
| Label `full_refresh` gerando falsa confiança operacional | **Média** | Runners/cron |
| Heurística 1h `syncedAt` mascara mas não arquiva | **Média** | DB cresce; auditorias veem lixo |

---

## 6. Consumidores afetados

### Pedidos

| Área | Assume local = ativo na origem? |
|------|----------------------------------|
| Gestão / Intelligence | Sim (filtros de negócio, sem ausência) |
| CRM | Sim |
| Kanban / Flow | Sim |
| Carteira / maturidade | Sim |
| Previsões / portfolio cash | Sim (se pedido ainda no universo) |
| Comissões | Sim (snapshots/schedules do pedido local) |
| Order to Cash | Sim |
| Relatórios executivos / PDF | Sim |
| **Exceção** | OP-81 (detecta ausência; não altera consumidores) |

### Contas a Receber

| Área | Filtro de frescor / aberto |
|------|----------------------------|
| Contas a Receber / títulos | Heurística `syncedAt` + regras aberto |
| Fluxo de Caixa | Heurística + aberto |
| Agenda efetiva / horizonte | Heurística |
| Relatório presidencial | Heurística (motor oficial) |
| Comissões (scheduler / materialização / receipt) | **Frequentemente sem cutoff** |
| Auditoria full do pedido / schedule lista | Todos os CR das NFs (inclui liquidados) |

### Contas a Pagar

| Área | Filtro |
|------|--------|
| Contas a Pagar | Heurística `syncedAt` + regras |
| Fluxo de Caixa | Heurística + aberto + cancelado |
| Centros de Custo (dashboards) | Heurística via where oficial |
| Alocação CC (alguns loaders) | Pode carregar local sem cutoff |
| Alertas / relatórios | Depende do caminho (oficial vs raw) |

---

## 7. Contrato recomendado (não implementar nesta etapa)

### Operações

| Op | Regra |
|----|-------|
| **CREATE** | `externalId` inexistente → criar; `firstSeenAt`/`lastSeenAt` = now; status presença `PRESENT` |
| **UPDATE** | Retornado no payload → atualizar campos oficiais + raw + hash; `lastSeenAt` = now; `PRESENT` |
| **DELETE LÓGICO** | Só com payload **COMPLETE**; 1ª ausência → `MISSING_CANDIDATE`; confirmação (lookup ou 2ª run completa) → `MISSING_CONFIRMED` |
| **REACTIVATE** | Ausente reaparece → `PRESENT` + UPDATE completo |

### Campos mínimos recomendados

- `firstSeenAt`, `lastSeenAt`
- `presentInLastPayload` **ou** enum `sourcePresence` (`PRESENT` \| `MISSING_CANDIDATE` \| `MISSING_CONFIRMED`)
- `payloadHash` (Pedido ainda não tem)
- `lastSeenSyncRunId` (opcional, amarra a `IntegrationRun`)
- `missingFromNomusSince` (opcional)

### Opção de modelagem (escolha)

| Opção | Prós | Contras |
|-------|------|---------|
| **A. Campos na tabela de cada entidade** | Simples; filtros Prisma diretos; alinhado a `NomusStockDocument` / NF links | Migration em 3 tabelas |
| **B. Tabela genérica de lifecycle** | Um modelo para todas as fontes | Join em todo consumer; mais complexo |
| **C. Reutilizar estrutura existente** | Menos migration se só CR/CP usarem `syncedAt` + flag nova | Pedido sem hash; inconsistente |

**Escolha recomendada: A (campos na entidade) + disciplina de completude da OP-81**, reutilizando o padrão mental de Documento de Saída / `SalesOrderNfeLink`, **não** o mark-absent desligado do stock window.

Justificativa: menor risco operacional, aderência ao que o projeto já indexa (`presentInLastPayload`, `lastSeenAt`), e consumidores podem filtrar `PRESENT` sem join genérico.

---

## 8. Estratégia de implantação cirúrgica (futuro)

1. **SYNC-01b — Schema (Pedido + CR + CP):** campos de presença; defaults `PRESENT` / `presentInLastPayload=true`.
2. **SYNC-01c — Completude compartilhada:** extrair contrato tipo OP-81 (`COMPLETE` / `INCONCLUSIVE_FETCH`) para os três fetchers.
3. **SYNC-01d — Pedido:** após run COMPLETE (ou auditoria confirmada), marcar candidatos; lookup por código; só então `MISSING_CONFIRMED`. Não arquivar ainda.
4. **SYNC-01e — CR/CP:** touch `lastSeenAt` em todo retorno; mark-absent **só** se run COMPLETE e janela = universo declarado; manter fontes independentes do Pedido.
5. **SYNC-01f — Consumidores:** filtrar `PRESENT` nos oficiais; comissões/O2C alinhados; relatório de ghost.
6. **Nunca** nesta trilha: delete físico automático; inferir CR a partir de Pedido.

---

## 9. Migrations possivelmente necessárias (futuro)

- `SalesOrder`: `payloadHash?`, `firstSeenAt`, `lastSeenAt`, `presentInLastPayload` ou `sourcePresence`, `missingFromNomusSince?`
- `NomusAccountsReceivable` / `NomusAccountsPayable`: `firstSeenAt`, `lastSeenAt`, `presentInLastPayload` / `sourcePresence`, `lastSeenSyncRunId?`, `missingFromNomusSince?`
- Índices em presença + `lastSeenAt`
- **Não** nesta etapa SYNC-01

---

## 10. Testes necessários (futuro)

| Caso | Entidade |
|------|----------|
| CREATE novo externalId | Pedido / CR / CP |
| UPDATE com hash/campo alterado | CR / CP / Pedido |
| Hash igual → só presença/`syncedAt` | CR / CP |
| Payload incompleto → **zero** mark-absent | Todos |
| COMPLETE + ausente → CANDIDATE → CONFIRMED | Pedido (já coberto em espírito pela OP-81) |
| REACTIVATE | Todos |
| Pedido ausente **não** marca CR | Cross-source |
| CP agrupa/filtra por `dueDate` após presence | CP |
| Regressão consumidores com filtro `PRESENT` | Finance + comissões |

Testes atuais relevantes (sem alteração nesta etapa):  
`npm run test:nomus:sales-orders-sync`, `test:nomus:accounts-receivable`, `test:nomus:accounts-payable`, `test:nomus:sales-orders-orphans`.

---

## 11. Plano de backfill (futuro)

1. Rodar sync COMPLETE (ou OP-81 + CR/CP full window) e setar `PRESENT` + `lastSeenAt=syncedAt` em tudo tocado.
2. Pedidos locais NOMUS não vistos → `MISSING_CANDIDATE` (não confirmar em massa).
3. Confirmar com lookup (Pedido) / segunda run COMPLETE (CR/CP) → `MISSING_CONFIRMED`.
4. Exportar lista de alto risco (NF, comissão paga, saldo aberto) para decisão humana.
5. Só então política de arquivamento (fora deste ticket).

---

## 12. Critérios de aceite (desta etapa SYNC-01)

- [x] Documentado CREATE/UPDATE/ausência para Pedido, CR e CP
- [x] Classificados modos `CREATE_UPDATE_ONLY` / `FULL_RECONCILIATION_SAFE` / `FULL_RECONCILIATION_UNSAFE`
- [x] Prova de completude e lacunas registradas
- [x] Consumidores mapeados
- [x] Contrato recomendado + opção de schema escolhida (A)
- [x] Caso PD 02739 e arquitetura CR 17748 descritos sem consulta produtiva pelo Cursor
- [x] Sem alteração de schema, sync, dados ou consumidores
- [x] Documento em `docs/nomus/nomus-crud-reconciliation-audit.md`

---

## Apêndice A — Evidências-chave (paths)

| Tema | Path |
|------|------|
| Sync Pedido apply create/update | `scripts/nomusSalesOrdersSyncV1.ts` |
| Item stale | `src/lib/salesOrderNomusSync.server.ts` |
| Estratégias Pedido | `src/lib/nomusSalesOrdersSyncWindow.ts` |
| OP-81 | `docs/commercial/nomus-sales-orders-orphan-audit.md` |
| CR apply | `scripts/nomusAccountsReceivableSync.ts` (`runApply`) |
| CP apply | `scripts/nomusAccountsPayableSync.ts` |
| Query financeira compartilhada | `src/lib/nomusFinancialSyncQueryParams.ts` |
| Label `full_refresh_upsert` | `src/lib/nomusAccountsReceivableSyncLogic.ts`, `nomusAccountsPayableSyncLogic.ts` |
| Runner CR | `scripts/runNomusAccountsReceivableSync.sh` |
| Presence stock (sem mark-absent) | `src/lib/nomusStockDocumentsSyncLifecycle.ts` (`shouldMarkStockDocumentsAbsent`) |
| Freshness AR/AP | `src/lib/financeNomusArReportFreshness.ts`, `financeNomusApReportFreshness.ts` |
| Eixo vencimento CP | `src/lib/financeAccountsPayableOperational.ts` |
| Presence NF link | `src/lib/salesOrderNfeLink.ts` |
| Schema | `prisma/schema.prisma` (`SalesOrder`, `NomusAccountsReceivable`, `NomusAccountsPayable`, `NomusStockDocument`) |

---

## Apêndice B — Resumo executivo

| Entidade | CREATE | UPDATE | Ausência | Modo real |
|----------|--------|--------|----------|-----------|
| Pedido | Sim | Sim (com preservação de custo) | **Não reconciliada** (OP-81 só audita) | `CREATE_UPDATE_ONLY` |
| CR | Sim | Sim (`payloadHash`) | **Não** (ghost + heurística) | `CREATE_UPDATE_ONLY` / label unsafe |
| CP | Sim | Sim (`payloadHash`) | **Não** (idem; eixo `dueDate`) | `CREATE_UPDATE_ONLY` / label unsafe |

**Próximo passo seguro:** schema de presença (opção A) + mark-absent apenas com completude comprovada — **sem** implementar nesta entrega.
