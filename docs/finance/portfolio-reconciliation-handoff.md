# Handoff — Conciliação de Carteira (Portfolio Reconciliation)

**Projeto:** IndusCost / My Industry  
**Módulo:** Financeiro → Conciliação de Carteira (camada **paralela** / auditoria)  
**Atualizado:** 2026-07-10  
**Branch:** `main`  
**Commit de referência (rastreabilidade UI):** `b665871dc641d05be89167552ce6a1b804e3f0eb`  
**Faixa de commits da entrega:** `b984e7e` … `b665871` (+ este handoff)

> Documento operacional para **execução no servidor**.  
> Complementar: [`portfolio-reconciliation-architecture.md`](./portfolio-reconciliation-architecture.md), [`nomus-portfolio-reconciliation-inventory.md`](./nomus-portfolio-reconciliation-inventory.md).

---

## 1. O que foi feito

Foi criada uma **camada paralela de conciliação** que materializa, por run, a rastreabilidade:

```
Pedido → NF (cabeçalho) → Documento de Estoque (itens) → Alocação itemizada → CR → Previsão
```

Inclui:

1. Sync isolado de **documentos de estoque Nomus** (`NomusStockDocument` / `Item`)
2. **Tabela fato** + run (`PortfolioReconciliationRun` / `Fact`)
3. **Motor de alocação** itemizada (não assume cabeçalho inteiro da NF)
4. **Vínculo com Contas a Receber** (somente leitura do stage Nomus)
5. **Calendário de pagamento por cliente** (ex.: Britânia dias 10/20/30)
6. **Rebuild manual** (preview/apply) — sem cron
7. **API read-only**
8. **Tela** Financeiro → Conciliação de Carteira
9. **Drawer** de rastreabilidade por pedido (PD 02339 explicável)

**Não** substitui Fluxo de Caixa, Contas a Receber, Faturamento, Comissões nem Relatório Presidencial.

---

## 2. Por que foi feito

O vínculo Pedido↔NF existente (`SalesOrderNfeLink`) é por **cabeçalho**. Em casos como **PD 02339**, várias NFs compartilham produtos/quantidades e a soma dos cabeçalhos **não** é o valor do pedido. Sem itemização via documento de estoque + alocação com saldo, a carteira e a previsão misturam atendimento real com valor fiscal de cabeçalho.

A fato responde, com confiança e alertas:

- quanto foi vendido / atendido / faturado / virado CR / recebido / aberto;
- origem de cada número;
- divergências de preço/quantidade.

---

## 3. Prompts / etapas executadas (ordem)

| # | Etapa | Commit | Hash curto |
|---|--------|--------|------------|
| 0 | Inventário / mapeamento API `documentosEstoque` (+ probe) | `docs(finance): mapeia api documentos estoque…` | `b984e7e` |
| 1 | Sync isolado documentos de estoque Nomus | `feat(finance): sincroniza documentos de estoque…` | `5aece3a` |
| 2 | Arquitetura da conciliação | `docs(finance): define arquitetura…` | `2ebd6bb` |
| 3 | Tabela fato + run | `feat(finance): adiciona tabela fato…` | `a54705b` |
| 4 | Motor de alocação itemizada | `feat(finance): cria motor de alocacao…` | `8169b3c` |
| 5 | Vínculo Contas a Receber | `feat(finance): vincula contas a receber…` | `f6e4bb4` |
| 6 | Calendário de pagamento (Britânia) | `feat(finance): adiciona calendario…` | `bb1aeca` |
| 7 | Rebuild manual preview/apply | `feat(finance): cria rebuild manual…` | `404fccd` |
| 8 | API read-only | `feat(finance): adiciona api read-only…` | `c2d7750` |
| 9 | Tela menu Financeiro | `feat(finance): adiciona tela…` | `855b961` |
| 10 | Drawer de rastreabilidade | `feat(finance): adiciona rastreabilidade…` | `b665871` |
| 11 | Handoff (este documento) | `docs(finance): documenta handoff…` | *(após push)* |

### O que cada etapa entregou

1. **Sync estoque** — models + migration + script preview/apply; não grava em AR/Fluxo/Comissões.  
2. **Arquitetura** — contrato conceitual e regras de isolamento.  
3. **Fato** — `PortfolioReconciliationRun` / `Fact` (materialização por run).  
4. **Motor** — aloca por produto/qtde; `PRICE_MISMATCH`, surplus, não reconsome saldo.  
5. **CR** — match por idNfe (preferencial); rateio só com alocação confiável.  
6. **Calendário** — ajusta previsão NFE/ORDER; **não** mexe em vencimento RECEIVABLE.  
7. **Rebuild** — CLI materializa fatos; preview não grava.  
8. **API** — GET list/detail/runs/summary; usa fato; sem recalcular se há run.  
9. **UI** — menu standalone `/finance/portfolio-reconciliation`.  
10. **Drawer** — seções gestor + técnico (traceJson só admin).

### Revisão: módulos oficiais

Na faixa `b984e7e..b665871`, **não** houve alteração indevida em:

- Fluxo de Caixa  
- Contas a Receber (dashboard/regras oficiais)  
- Faturamento  
- Comissões  
- Relatório Presidencial  

A conciliação **lê** stages Nomus / pedidos; **grava** apenas tabelas próprias da camada paralela (+ sync de estoque isolado).

---

## 4. Arquivos principais

### Backend / domínio

| Arquivo | Papel |
|---------|--------|
| `src/lib/nomusStockDocumentsMapper.ts` | Map Nomus → stage |
| `src/lib/nomusStockDocumentsSyncLogic.ts` | Lógica de sync |
| `scripts/nomusStockDocumentsSync.ts` | CLI sync |
| `scripts/probe-nomus-stock-documents.ts` | Probe API Nomus |
| `src/lib/finance/portfolioReconciliationAllocationEngine.ts` | Motor de alocação |
| `src/lib/finance/portfolioReconciliationReceivables.ts` | Vínculo CR |
| `src/lib/finance/portfolioPaymentCalendar.ts` | Calendário / Britânia |
| `src/lib/finance/portfolioReconciliationRebuild.ts` | Rebuild puro |
| `scripts/rebuildPortfolioReconciliationFacts.ts` | CLI rebuild |
| `src/lib/finance/portfolioReconciliationApi.ts` | Agregação API |
| `src/lib/finance/portfolioReconciliationOrderTrace.ts` | View-model drawer |
| `src/lib/financePortfolioReconciliationApi.server.ts` | Loaders Prisma |
| `src/lib/financePortfolioReconciliationRoutes.ts` | Rotas Express |
| `src/lib/financePortfolioReconciliationPermissions.ts` | Permissões UI |
| `src/lib/financePortfolioReconciliationClient.ts` | Query/types frontend |

### Frontend

| Arquivo | Papel |
|---------|--------|
| `src/components/finance/FinancePortfolioReconciliationPage.tsx` | Tela |
| `src/components/finance/portfolio-reconciliation/*` | Cards, tabela, badges, drawer |
| `src/App.tsx` | Rota standalone |
| `src/lib/modulePermissions.ts` / `navigationGroups.ts` / `Sidebar.tsx` | Menu |

### Docs / schema

| Arquivo | Papel |
|---------|--------|
| `docs/finance/portfolio-reconciliation-architecture.md` | Arquitetura |
| `docs/finance/nomus-portfolio-reconciliation-inventory.md` | Inventário API |
| `docs/finance/portfolio-reconciliation-handoff.md` | Este handoff |
| `prisma/schema.prisma` | Models |

---

## 5. Tabelas / migrations novas

| Migration | Tabelas / enums |
|-----------|-----------------|
| `20260710180000_nomus_stock_documents` | `NomusStockDocument`, `NomusStockDocumentItem` |
| `20260710190000_portfolio_reconciliation_fact` | `PortfolioReconciliationRun`, `PortfolioReconciliationFact` + enums status/fonte/confiança/modo |
| `20260710200000_portfolio_customer_payment_rule` | `PortfolioCustomerPaymentRule` |

---

## 6. Scripts novos (package.json)

```text
sync:nomus:stock-documents:preview
sync:nomus:stock-documents:apply
rebuild:portfolio-reconciliation:preview
rebuild:portfolio-reconciliation:apply
test:portfolio-reconciliation
```

Também: `scripts/probe-nomus-stock-documents.ts` (probe manual).

---

## 7. Endpoints novos (read-only)

| Método | Path |
|--------|------|
| GET | `/api/finance/portfolio-reconciliation` |
| GET | `/api/finance/portfolio-reconciliation/orders/:salesOrderId` |
| GET | `/api/finance/portfolio-reconciliation/runs` |
| GET | `/api/finance/portfolio-reconciliation/runs/:runId/summary` |

Permissões (OR): `finance.view`, `finance.accountsReceivable.view`, `finance.accountsPayable.view`, `reports.view`, `settings.nomus.view`.  
TraceJson completo no drawer: `users.manage` / `settings.view` / `accessProfiles.manage`.

---

## 8. Como funciona o vínculo

```
SalesOrder / SalesOrderItem
    │
    ├─ SalesOrderNfeLink ──► NomusNfe (cabeçalho fiscal)
    │                              │
    │                              ▼
    │                    NomusStockDocument (idNfe)
    │                              │
    │                              ▼
    │                    NomusStockDocumentItem (produto/qtde/valor)
    │                              │
    │                              ▼
    │              Motor: aloca qtde ao saldo do item do pedido
    │              (nunca assume valor total do cabeçalho da NF)
    │                              │
    │                              ▼
    │              NomusAccountsReceivable (preferência sourceInvoiceId = idNfe)
    │                              │
    │                              ▼
    └──────────────► PortfolioReconciliationFact
                     forecastSource: RECEIVABLE > NFE > ORDER > UNRESOLVED
                     (+ calendário se NFE/ORDER; RECEIVABLE soberano)
```

---

## 9. Como funciona a tabela fato

- Cada **apply** do rebuild cria (ou reutiliza) um `PortfolioReconciliationRun` e grava linhas em `PortfolioReconciliationFact`.
- Grão típico: **linha de evidência** (item pedido × item documento / surplus / header-only / order-only).
- A API/UI **não recalcula** alocação se existir run `SUCCESS`; lê a fato.
- Sem run: mensagem amigável pedindo rebuild manual.

---

## 10. Status de confiança

| Nível | Significado típico |
|-------|-------------------|
| `HIGH` | Alocação itemizada limpa, sem mismatch relevante |
| `MEDIUM` | Alocado com ressalvas (ex. preço divergente, parcial) |
| `LOW` | Pedido só / NF só cabeçalho / pouca evidência |
| `BLOCKED` | Qualidade de dados impede uso confiável da linha |

Status de linha (exemplos): `ORDER_ONLY`, `HEADER_ONLY_LINK`, `ITEM_ALLOCATED`, `PRICE_MISMATCH`, `QUANTITY_SURPLUS_IN_NFE`, `FULLY_ALLOCATED`, `RECEIVABLE_CONFIRMED`, `RECEIVED`, `DATA_QUALITY_ISSUE`, …

---

## 11. Regra Britânia

- `customerExternalId = 200`
- Dias permitidos: **10, 20, 30**
- Nunca antecipa; move para o próximo dia permitido
- Fallback embutido em código se não houver linha em `PortfolioCustomerPaymentRule`
- Aplica-se a previsões derivadas de **NFE/ORDER**; se `forecastSource = RECEIVABLE`, o vencimento do título **não** é recalculado

---

## 12. O que ainda não é automático

- **Sem cron** de sync de documentos de estoque
- **Sem cron** de rebuild da fato
- Previsão **não** alimenta o Fluxo de Caixa oficial
- Sem edição na UI (somente leitura)
- Sem seed obrigatório de regras de pagamento (Britânia tem fallback)
- Carga histórica depende de execução manual no servidor

---

## 13. O que precisa ser executado no servidor

### 13.1 Após `git pull` / deploy

```bash
cd /caminho/para/IndusCost
git pull origin main

npm ci   # ou npm install, conforme padrão do ambiente
npx prisma migrate deploy
npx prisma generate
npm run build

# Reiniciar o serviço Node conforme padrão do projeto
# (ex.: pm2 restart <app>  |  systemctl restart <serviço>)
```

Migrations esperadas nesta entrega:

1. `20260710180000_nomus_stock_documents`
2. `20260710190000_portfolio_reconciliation_fact`
3. `20260710200000_portfolio_customer_payment_rule`

### 13.2 Carga manual — documentos de estoque

**Sempre preview antes de apply.**

```bash
npm run sync:nomus:stock-documents:preview -- --from=2025-07-01 --to=2026-07-10 --tipo=DocumentoSaida
npm run sync:nomus:stock-documents:apply -- --from=2025-07-01 --to=2026-07-10 --tipo=DocumentoSaida
```

Requer credenciais Nomus / `.env` do servidor.

### 13.3 Rebuild da fato

```bash
npm run rebuild:portfolio-reconciliation:preview -- --from=2025-07-01 --to=2026-07-10 --customerExternalId=200 --explain
npm run rebuild:portfolio-reconciliation:apply -- --from=2025-07-01 --to=2026-07-10 --customerExternalId=200
```

### 13.4 Validação PD 02339

```bash
npm run rebuild:portfolio-reconciliation:preview -- --orderCode="PD 02339" --explain
```

Esperado no explain / fatos:

- Valor pedido materializado **R$ 158.000,00** (soma itens; **não** soma cabeçalhos NF)
- NFs **6845, 7052, 7195** (idNfe 6937, 7188, 7377)
- NF 6845: produtos 456, 452, 455 com preço doc **4,92** vs pedido **5,85** → `PRICE_MISMATCH`
- NF 7052: produto 537 alocado até o **saldo** do pedido (parcial vs qtde do documento)
- NF 7195: **não** reconsome itens já atendidos (surplus)
- Soma cabeçalhos NF ≫ valor do pedido → alerta de sobrevinculação por cabeçalho

Na UI: Financeiro → Conciliação de Carteira → filtrar pedido → abrir drawer.

---

## 14. SQLs read-only sugeridos

```sql
-- Contagens stage estoque
SELECT COUNT(*) AS stock_documents FROM "NomusStockDocument";
SELECT COUNT(*) AS stock_items FROM "NomusStockDocumentItem";

-- Documentos das NFs do PD 02339
SELECT "externalId", "idNfe", "tipoDocumentoEstoque", "dataDocumento"
FROM "NomusStockDocument"
WHERE "idNfe" IN (6937, 7188, 7377)
ORDER BY "idNfe", "externalId";

-- Itens desses documentos
SELECT d."externalId" AS doc_external_id, d."idNfe",
       i."externalProductId", i."quantity", i."unitValue", i."estimatedTotalValue"
FROM "NomusStockDocumentItem" i
JOIN "NomusStockDocument" d ON d."id" = i."stockDocumentId"
WHERE d."idNfe" IN (6937, 7188, 7377)
ORDER BY d."idNfe", i."externalProductId";

-- Último run SUCCESS
SELECT "id", "status", "mode", "finishedAt", "customerExternalId", "summaryJson"
FROM "PortfolioReconciliationRun"
WHERE "status" = 'SUCCESS'
ORDER BY "finishedAt" DESC NULLS LAST, "createdAt" DESC
LIMIT 5;

-- Facts do PD 02339 (substitua :runId)
SELECT "orderCode", "externalProductId", "nfeNumber", "nfeExternalId",
       "stockDocumentExternalId", "allocatedQuantity",
       "orderUnitPrice", "stockUnitValue",
       "allocatedValueByOrderPrice", "status", "confidenceLevel", "alertsJson"
FROM "PortfolioReconciliationFact"
WHERE "runId" = :runId
  AND "orderCode" ILIKE '%PD 02339%'
ORDER BY "nfeExternalId", "externalProductId";

-- Saldos / alocações por produto no pedido
SELECT "externalProductId",
       MAX("orderQuantity") AS order_qty,
       SUM(COALESCE("allocatedQuantity", 0)) AS allocated_qty,
       MAX("orderQuantity") - SUM(COALESCE("allocatedQuantity", 0)) AS remaining_approx
FROM "PortfolioReconciliationFact"
WHERE "runId" = :runId
  AND "orderCode" ILIKE '%PD 02339%'
  AND "salesOrderItemId" IS NOT NULL
GROUP BY "externalProductId"
ORDER BY "externalProductId";
```

---

## 15. Ordem exata de validação no servidor

1. `git pull` + `npm ci` + `npx prisma migrate deploy` + `npx prisma generate` + `npm run build` + restart  
2. Confirmar migrations aplicadas (3 listadas acima)  
3. Sync estoque **preview** → revisar contagens → **apply**  
4. SQL: counts + docs idNfe 6937/7188/7377  
5. Rebuild **preview** Britânia / PD 02339 com `--explain`  
6. Rebuild **apply** (janela acordada)  
7. SQL: facts PD 02339 + alocações por produto  
8. Abrir UI `/finance/portfolio-reconciliation` → cards/tabela → drawer PD 02339  
9. Smoke: Fluxo / AR / Faturamento / Comissões / Presidencial **inalterados** visualmente  

---

## 16. Como voltar atrás

| Camada | Ação |
|--------|------|
| Código | `git checkout` / deploy do commit anterior a `b984e7e` (ou revert da faixa) + rebuild + restart |
| Dados fato | Truncar/apagar runs/facts da conciliação (`PortfolioReconciliationFact` / `Run`) — **não** afeta AR/Fluxo oficiais |
| Regras pagamento | Remover linhas de `PortfolioCustomerPaymentRule` (Britânia continua com fallback em código se o código permanecer) |
| Stage estoque | Opcional: limpar `NomusStockDocument` / `Item` se a sync for revertida |
| Migrations | Só com plano DBA; preferir forward-fix. Não dropar tabelas sem backup |

**Não** é necessário rollback de `NomusAccountsReceivable`, Fluxo ou Comissões — não foram mutados por esta linha.

---

## 17. Riscos restantes

| Risco | Mitigação |
|-------|-----------|
| Sync estoque depende de API Nomus / credenciais no servidor | Rodar preview; monitorar erros de auth/timeout |
| Janela de datas incompleta | Ampliar `--from`/`--to` e re-aplicar sync + rebuild |
| Pedidos sem documento de estoque | Ficam `ORDER_ONLY` / `HEADER_ONLY_LINK` — esperado |
| Apply rebuild em janela grande | Sempre preview + `--explain` em amostra (PD 02339) |
| Confusão com Fluxo oficial | Banner na UI + este handoff: camada paralela |
| Calendário só afeta NFE/ORDER | Documentado; RECEIVABLE soberano |

---

## 18. Telas

| Path | Descrição |
|------|-----------|
| `/finance/portfolio-reconciliation` | Lista, filtros, cards, tabela |
| Drawer no clique do pedido | Rastreabilidade completa |

Menu: **Financeiro → Conciliação de Carteira** (standalone, fora das abas do `FinanceModule`).

---

## 19. Testes locais (já executados na entrega)

```bash
npm run check:server-imports
npm run check:frontend-server-imports
npm test
npm run build
npm run check:browser-bundle
```

Suite focada: `npm run test:portfolio-reconciliation` (motor, CR, calendário, rebuild, API, order trace, menu/página).

---

## 20. Checklist rápido pós-deploy

- [ ] Migrations 180000 / 190000 / 200000 aplicadas  
- [ ] Sync estoque apply concluído  
- [ ] Rebuild apply com run `SUCCESS`  
- [ ] UI carrega (ou empty state de “rode rebuild” se ainda sem fato)  
- [ ] PD 02339 explicável no drawer  
- [ ] Módulos oficiais intactos  
