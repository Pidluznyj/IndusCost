# Plano de fonte de dados — abas da Conciliação de Carteira × OrderToCashAudit

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-12 |
| **Base inventário** | `docs/finance/portfolio-reconciliation-tabs-inventory.md` |
| **Escopo** | Diagnóstico definitivo de fonte — **sem** integração visual neste prompt |
| **Scripts** | `tmp-audits/inspect-portfolio-reconciliation-tab-sources.ts` · `tmp-audits/check-order-to-cash-audit-api-query.ts` |

Runs de referência (já populadas):

| Run | Papel |
|-----|--------|
| `41c2470a-b685-4765-a954-77110fd8cf5c` | Geral · SUCCESS · mode **APPLY** · customerFilter **null** · 5860 facts |
| `a0bdc0b6-b3d5-42ca-a548-283edbc31cfa` | Britânia · customerFilter **200** · year **2026** · 53 facts |

---

## 1. Diagnóstico por aba

### 1.1 Conciliação

| Pergunta | Resposta |
|----------|----------|
| Usa OrderToCashAudit hoje? | **Não** |
| Fonte atual | `PortfolioReconciliationRun` / `PortfolioReconciliationFact` |
| Deve migrar agora? | **Não no curto prazo** para não quebrar cards/comparison/businessAnswers |
| Para refletir a base nova? | Precisa **camada de compatibilidade** (adapter Fact O2C → shape Portfolio) **ou** rebuild paralelo de Portfolio a partir das mesmas fontes oficiais — **não** basta “continuar só com Portfolio” se a verdade de negócio passou a ser O2C |

**Recomendação definitiva:** manter o **contrato de UI/API** da Conciliação, mas planejar **fonte canônica = OrderToCashAudit** via adapter no service (fase 2). Até lá, Conciliação e O2C podem divergir numericamente.

### 1.2 Inteligência da Carteira

| Pergunta | Resposta |
|----------|----------|
| Usa OrderToCashAudit hoje? | **Sim (preferencial)** — run geral SUCCESS + adapter |
| Fonte atual | `OrderToCashAuditRun`/`Fact` → adapter → motor `portfolioMaturity*` / O2C board |
| Fallback | `PortfolioReconciliationRun`/`Fact` se não houver O2C SUCCESS geral |
| Caminho | Adapter `orderToCashAuditToPortfolioFactsAdapter.ts` (CR 1× por pedido; estágio O2C remapeia status) |

**Comportamento final (etapa 4):** motor de maturidade **mantido**; facts vêm de OrderToCashAudit. Disclaimer UI: *Pedido de venda não é caixa confirmado. CR confirma financeiro. Baixa confirma caixa.*

### 1.3 Auditoria Pedido → Caixa

| Pergunta | Resposta |
|----------|----------|
| Endpoint certo? | **Sim** — `GET /api/finance/portfolio-reconciliation/order-to-cash-audit` |
| Tabelas certas? | **Sim** — `OrderToCashAuditRun` + `OrderToCashAuditFact` |
| Busca correta da run? | **Sim** — política §2.4 (específica → geral → sem run) |
| UI parâmetros? | Prefere `customerExternalId`; `customerId` só para resolução server-side → Nomus; `customerName` como fallback de busca |

---

## 2. Respostas técnicas objetivas (checklist do prompt)

### 1) Conciliação: Portfolio ou compatibilidade O2C?

**Compatibilidade com OrderToCashAudit** é o destino para refletir a base nova.  
**Continuar só Portfolio** = não reflete runs `41c2470a…` / `a0bdc0b6…`.  
**Curto prazo:** manter Portfolio. **Médio prazo:** adapter O2C → payload Conciliação.

### 2) Inteligência: O2C direto ou motor antigo?

**Motor antigo** (maturidade/fulfillment/O2C board) **sim**.  
**Fatos:** **OrderToCashAudit via adapter** (preferencial); Portfolio legado como fallback.

Mapeamento de estágios O2C → cards de maturidade:

| Estágio OrderToCash | Status Inteligência |
|---------------------|---------------------|
| RECEBIDO | RECEBIDO |
| CR_ABERTO | CR_ABERTO |
| NF_SEM_CR | FATURADO_SEM_CR (rótulo UI: NF sem CR) |
| PEDIDO_FUTURO_SAUDAVEL | CARTEIRA_FUTURA_PROVAVEL |
| PEDIDO_PROXIMO_ATENCAO | CARTEIRA_PRESENTE_ATENCAO |
| PEDIDO_ATRASADO_SEM_DOCUMENTO / BLOQUEADO_REVISAO | CARTEIRA_VENCIDA_BLOQUEADA |

Agregação segura: CR/recebido/aberto apenas no **primeiro fato** de cada `salesOrderId` no adapter.
### 3) Auditoria está buscando OrderToCashAudit corretamente?

**Sim** — endpoint, tabelas e política de run/cliente alinhadas à materialização.

### 4) Como a API escolhe a run? (comportamento final)

Prioridade em `resolveOrderToCashAuditRun` / `decideOrderToCashAuditRunPolicy`:

| Ordem | Condição | Run usada |
|-------|----------|-----------|
| a) | `runId` explícito na query e status SUCCESS | essa run |
| b) | `customerExternalId` + `year` e existe SUCCESS com `customerFilter = String(externalId)` e `year` | run específica (ex.: Britânia `a0bdc0b6…`) |
| c) | senão | última SUCCESS com `customerFilter: null` (ex.: geral `41c2470a…`) |
| d) | nenhuma | payload amigável `ORDER_TO_CASH_AUDIT_NO_RUN_MESSAGE` (sem throw) |

Filtros de Fact (nunca `customerId` interno):

- `externalCustomerId` quando presente
- senão `customerName` contains (insensitive)
- se só vier `customerId` UUID: server resolve → `externalCustomerId` via `SalesOrder`; se não resolver, mensagem pedindo `customerExternalId`
- `year` + **run geral**: filtra `orderIssueDate` (ou `createdAt` se issue null)
- `year` + **run específica**: não reaplica ano nas facts (run já escopada)
- paginação server-side; sort whitelist; rows = `OrderToCashAuditFact`

Meta da run no payload: `runId`, `isGeneralRun`, `customerFilter`, `year`, `periodFrom`, `periodTo`, `totalOrders`, `totalFacts`, `createdAt`, totais `*Value`, `status`, `mode`, timestamps.

Summary:

- Sem filtros de escopo → `summarySource: "run"` (totais da `OrderToCashAuditRun`)
- Com filtro cliente/ano/avançados → `summarySource: "filtered_facts"` (pedido/`orderNet` 1×; CR = max por pedido — sem somar CR linha a linha)

### 5) UI envia `customerId` ou `customerExternalId`?

Prefere **`customerExternalId`** quando o autocomplete tiver `code` numérico.  
Caso contrário envia `customerId` (UUID) para o server resolver, e/ou `customerName`.

### 6) “Cliente: Britânia” precisa virar `externalCustomerId=200`?

**Sim.** Query canônica: `?customerExternalId=200&year=2026`.  
Na run geral, filtro `externalCustomerId=200` (janela geral ≈ 108 linhas / 35 pedidos).

### 7) Filtro Ano 2026 usa o quê?

| Etapa | Critério |
|-------|----------|
| Resolver run | Preferência run específica `year=2026` + `customerFilter`; senão run geral |
| Filtrar facts (run geral) | `orderIssueDate` ∈ 2026 (ou `createdAt` se issue null) |
| Filtrar facts (run específica) | sem refiltro de ano |
| `periodFrom`/`periodTo` | metadado da run (não filtro da listagem) |

### 8) Divergência status/mode?

| Campo | Persistido no apply | Checagem API |
|-------|---------------------|--------------|
| `mode` | **`APPLY`** | API **não** filtra por mode |
| `status` | **`SUCCESS`** | API exige `status === "SUCCESS"` |

### 9) Por que a aba pode mostrar vazio?

1. Sem pesquisar (cliente+ano obrigatórios na UI).
2. Sem run materializada SUCCESS.
3. Filtros avançados demais (raro com Britânia 200).
4. `customerId` sem `externalCustomerId` resolvível e sem `customerName`.

Scripts:

```bash
npx tsx tmp-audits/inspect-portfolio-reconciliation-tab-sources.ts
npx tsx tmp-audits/check-order-to-cash-audit-api-query.ts --customerExternalId 200 --year 2026
curl "http://localhost:PORT/api/finance/portfolio-reconciliation/order-to-cash-audit?customerExternalId=200&year=2026&page=1&pageSize=50"
```

---

## 3. Fonte atual × fonte recomendada

| Aba | Fonte atual | Fonte recomendada (alvo) | Ajuste imediato |
|-----|-------------|--------------------------|-----------------|
| Conciliação | Portfolio Run/Fact | **OrderToCashAudit** via adapter (fase 2) | Nenhum visual agora |
| Inteligência | Portfolio Fact + motor maturidade **ou** O2C via adapter | **OrderToCashAudit via adapter (feito)** | Ativo: prefer O2C; fallback Portfolio |
| Auditoria Pedido → Caixa | OrderToCashAudit | **OrderToCashAudit** | **Feito (etapa 1)** — política de run + `externalCustomerId` + summary seguro |

---

## 4. Ajustes — status

### Auditoria (P0) — **concluído na etapa 1**

1. ~~Enviar `externalCustomerId`~~ — UI + resolução server de UUID.
2. ~~Política de run~~ — específica → geral → mensagem sem run.
3. Opcional: seletor de run na UI (ainda aberto).
4. ~~Cards: totais da Run ou agregação por pedido~~ — `summarySource`.

### Conciliação / Inteligência (P1–P2)

5. Adapter `OrderToCashAuditFact` → shape consumido por `buildListPayload` / maturity analytics (por `salesOrderId`).
6. Ou pipeline que atualize Portfolio a partir das mesmas evidências oficiais (manter duas bases sincronizadas).

---

## 5. Riscos de duplicidade

| Risco | Mitigação |
|-------|-----------|
| Somar CR em várias linhas do mesmo pedido | Cards: totais da Run **ou** `max` por `salesOrderId` |
| Somar pedido + NF + CR | Manter regra: um valor “oficial” por estágio |
| Cabeçalho NF > pedido | Já no builder O2C; UI/cards não usam NF header como valor de carteira |
| Duas bases (Portfolio vs O2C) divergentes | Tratar O2C como canônico; Portfolio legado até adapter |
| Run geral + run Britânia sobrepostas | Política de run explícita; payload inclui `runId` / `isGeneralRun` |

---

## 6. Regra de agregação segura

```text
Tabela / detalhe  → OrderToCashAuditFact (grão item × evidência)
Cards / resumo    → OrderToCashAuditRun.*Value  (summarySource=run)
                    OU agregação filtrada (summarySource=filtered_facts):
                      - pedidos: distinct salesOrderId / orderCode
                      - valor pedido: 1× orderNetValue por pedido
                      - alocado: soma allocatedValueByOrderPrice
                      - CR / recebido / aberto: max por pedido (não somar linha a linha)
```

Cadeia oficial (não mudar):

```text
Pedido (não é caixa) → Documento/NF (evidência) → CR (financeiro) → Baixa (caixa)
```

Proposta ≠ fonte oficial. Comissão fora desta tela.

---

## 7. Plano de implementação em etapas

| Etapa | Escopo | Entrega |
|-------|--------|---------|
| **0** | Diagnóstico + scripts + doc | Inventário + este arquivo |
| **1** | Fix Auditoria API/UI params | **Feito** — `externalCustomerId`, política de run, cards seguros |
| **2** | Smoke Britânia 2026 | Script validate + UI Pesquisa → ≥1 row |
| **3** | Adapter Conciliação ← O2C | Service + testes; UI sem redesign |
| **4** | Adapter Inteligência ← O2C | **Feito** — `orderToCashAuditToPortfolioFactsAdapter` + loader prefer O2C |
| **5** | Deprecar dual-read | Docs + flag / sunset Portfolio na tela |

---

## 8. Arquivos da etapa 1 (Auditoria API)

| Arquivo | Mudança |
|---------|---------|
| `src/lib/financeOrderToCashAuditApi.server.ts` | Resolução específica → geral; resolve UUID→external; meta completa; summary |
| `src/lib/finance/orderToCashAuditApi.ts` | Parse sem obrigar cliente/ano; where sem `customerId`; política pura; summary seguro |
| `src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx` | Envia `customerExternalId` / `customerName` |
| `src/lib/finance/orderToCashAuditClient.ts` | Query + helper de código Nomus |
| `src/lib/finance/orderToCashAuditApi.test.ts` / `orderToCashAuditUi.test.ts` | Cobertura da política e filtros |

**Não alterar:** Contas a Receber, Fluxo, Comissões, Presidencial, migrations, syncs Nomus.

---

## 9. Conclusão objetiva

| Aba | Ação |
|-----|------|
| **Conciliação** | Continua Portfolio **hoje**; alvo = O2C via **adapter** |
| **Inteligência** | Motor antigo + **fatos O2C** (adapter); fallback Portfolio |
| **Auditoria** | O2C com política de run + `externalCustomerId`; sem filtros a API usa a run geral `41c2470a…` |

Smoke esperado:

```text
GET .../order-to-cash-audit?customerExternalId=200&year=2026&page=1&pageSize=50
→ run específica Britânia se SUCCESS; senão geral + filtro 200/2026; rows > 0 quando facts existem
```
