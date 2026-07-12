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
| Usa OrderToCashAudit hoje? | **Não** |
| Fonte atual | Mesmos `PortfolioReconciliationFact` + motor `portfolioMaturity*` / fulfillment map |
| Deve usar O2C direto agora? | **Não diretamente** no motor atual (grão e campos diferem) |
| Caminho certo | Manter motor de intelligence, trocar **input de fatos** para um adapter a partir de `OrderToCashAuditFact` (agrupado por `salesOrderId`) **ou** manter dual-run até o adapter existir |

**Recomendação definitiva:** Intelligence **continua com o motor antigo**, mas a **fonte materializada alvo** é OrderToCashAudit (via adapter por pedido). Não reescrever maturidade neste momento.

### 1.3 Auditoria Pedido → Caixa

| Pergunta | Resposta |
|----------|----------|
| Endpoint certo? | **Sim** — `GET /api/finance/portfolio-reconciliation/order-to-cash-audit` |
| Tabelas certas? | **Sim** — `OrderToCashAuditRun` + `OrderToCashAuditFact` |
| Busca correta da run? | **Parcial** — ver §2 |
| UI parâmetros? | **Gap** — manda `customerId` UUID, não `externalCustomerId=200` |

---

## 2. Respostas técnicas objetivas (checklist do prompt)

### 1) Conciliação: Portfolio ou compatibilidade O2C?

**Compatibilidade com OrderToCashAudit** é o destino para refletir a base nova.  
**Continuar só Portfolio** = não reflete runs `41c2470a…` / `a0bdc0b6…`.  
**Curto prazo:** manter Portfolio. **Médio prazo:** adapter O2C → payload Conciliação.

### 2) Inteligência: O2C direto ou motor antigo?

**Motor antigo** (maturidade/fulfillment/O2C board) **sim**.  
**Fatos:** migrar para O2C via adapter (não “ligar Intelligence direto na tabela Fact item-a-item” sem agregação por pedido).

### 3) Auditoria está buscando OrderToCashAudit corretamente?

**Sim o endpoint/tabelas.**  
**Não a política de run/cliente** (detalhes abaixo).

### 4) Como a API escolhe a run?

Código atual (`resolveLatestSuccessRunId`):

| Comportamento | Implementado? |
|---------------|---------------|
| Última run geral SUCCESS **sem** `customerFilter`? | **Não** (não há essa query) |
| Preferir run por cliente/ano quando existir? | **Não** (não prioriza `customerFilter`/`year` da run) |
| Fallback geral se não houver específica? | **Não** como hierarquia explícita |
| O que faz de fato? | `OrderToCashAuditFact.findFirst` com cliente + `(run.year = year OR orderIssueDate no ano)` + `run.status = SUCCESS`, `orderBy createdAt desc` → pega o **fato mais recente**, depois usa o `runId` dele |

### 5) UI envia `customerId` ou `externalCustomerId`?

**`customerId` interno (UUID)** via `CustomerAutocompleteFilter` (`sel.id`).  
Ao selecionar, a UI **zera** `customerExternalId` (`""`).

### 6) “Cliente: Britânia” precisa virar `externalCustomerId=200`?

**Sim, para alinhamento Nomus/runs** (`customerFilter: "200"` e `externalCustomerId` nos facts).  
Hoje o autocomplete **não** envia 200. Se o UUID do cadastro bater com `fact.customerId`, funciona; se não, a aba fica vazia mesmo com run Britânia populada.

### 7) Filtro Ano 2026 usa o quê?

| Etapa | Critério |
|-------|----------|
| Resolver run | `run.year === 2026` **OU** `orderIssueDate` ∈ 2026 |
| Filtrar facts da listagem | **`orderIssueDate` ∈ 2026** (ou `createdAt` se issue null) — **não** filtra só por `run.year` |
| Período `periodFrom`/`periodTo` da run | **Não** usado na listagem |

### 8) Divergência status/mode?

| Campo | Persistido no apply | Checagem API |
|-------|---------------------|--------------|
| `mode` | **`APPLY`** (uppercase) | API **não** filtra por mode |
| `status` | **`SUCCESS`** | API exige `status === "SUCCESS"` |
| CLI | `--mode apply` (lowercase) | só na CLI; grava `APPLY` |

**Sem bug de case** se o apply concluiu com SUCCESS. `APPLY` vs `apply` na coluna `mode` não impede a listagem.

### 9) Por que a aba pode mostrar vazio?

Ordem de probabilidade (código):

1. **UI manda parâmetro errado / incompleto** — não pesquisou (sem applied); ou só usou filtro global da página (externalId) sem autocomplete na aba; ou `customerId` UUID ≠ `fact.customerId`.
2. **API acha run mas filtra fact** — year por `orderIssueDate` exclui linhas; cliente UUID sem match.
3. **API não acha run** — nenhum fato SUCCESS com aquele cliente+ano → mensagem “Nenhum run SUCCESS…”.
4. **Endpoint errado** — improvável (path e registration corretos).
5. **Retorno ok e componente não renderiza** — improvável se `rows.length > 0` (há branch explícita); empty state cobre 0 rows.

Scripts: rodar no servidor com `.env`:

```bash
npx tsx tmp-audits/inspect-portfolio-reconciliation-tab-sources.ts
npx tsx tmp-audits/check-order-to-cash-audit-api-query.ts --customerExternalId 200 --year 2026
npx tsx tmp-audits/check-order-to-cash-audit-api-query.ts --customerId <uuid-britania> --year 2026
```

---

## 3. Fonte atual × fonte recomendada

| Aba | Fonte atual | Fonte recomendada (alvo) | Ajuste imediato |
|-----|-------------|--------------------------|-----------------|
| Conciliação | Portfolio Run/Fact | **OrderToCashAudit** via adapter (fase 2) | Nenhum visual agora |
| Inteligência | Portfolio Fact + motor maturidade | **Mesmo motor** + fatos O2C agregados por pedido (fase 2–3) | Nenhum visual agora |
| Auditoria Pedido → Caixa | OrderToCashAudit | **OrderToCashAudit** (já) | Corrigir resolução run + `externalCustomerId` (próximo prompt) |

---

## 4. Ajustes necessários (próximos prompts — não neste)

### Auditoria (prioridade P0)

1. Enviar **`externalCustomerId`** quando conhecido (resolver a partir do pedido/cliente Nomus; para Britânia = **200**).
2. Política de run explícita:
   1. run SUCCESS com `customerFilter` = cliente e `year` = ano (se existir);
   2. senão run SUCCESS geral (`customerFilter` null) que contenha facts do cliente/ano;
   3. senão fato mais recente (comportamento atual como último recurso).
3. Opcional: seletor de run na UI (`41c2470a…` vs `a0bdc0b6…`).
4. Cards: preferir totais da **Run** ou agregação **por pedido/CR** (não somar `receivable*` linha a linha).

### Conciliação / Inteligência (P1–P2)

5. Adapter `OrderToCashAuditFact` → shape consumido por `buildListPayload` / maturity analytics (por `salesOrderId`).
6. Ou pipeline que atualize Portfolio a partir das mesmas evidências oficiais (manter duas bases sincronizadas).

---

## 5. Riscos de duplicidade

| Risco | Mitigação |
|-------|-----------|
| Somar CR em várias linhas do mesmo pedido | Cards: totais da Run **ou** `max/group by salesOrderId` / receivableId |
| Somar pedido + NF + CR | Manter regra: um valor “oficial” por estágio (pedido **ou** evidência **ou** CR) |
| Cabeçalho NF > pedido | Já no builder O2C; UI/cards não usam NF header como valor de carteira |
| Duas bases (Portfolio vs O2C) divergentes | Tratar O2C como canônico; Portfolio legado até adapter |
| Run geral + run Britânia sobrepostas | Política de run explícita; UI mostra `runId` |

---

## 6. Regra de agregação segura

```text
Tabela / detalhe  → OrderToCashAuditFact (grão item × evidência)
Cards / resumo    → OrderToCashAuditRun.*Value  OU
                    agregação:
                      - pedidos: distinct salesOrderId / orderCode
                      - valor pedido: 1× orderNetValue por pedido
                      - alocado: soma allocatedValueByOrderPrice (linhas ORDER_ITEM_ALLOCATED)
                      - CR / recebido / aberto: NÃO somar linha a linha;
                        preferir totais da Run ou max/único por receivable/pedido
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
| **0** (este prompt) | Diagnóstico + scripts + doc | Este arquivo |
| **1** | Fix Auditoria API/UI params | `externalCustomerId`, política de run, cards seguros |
| **2** | Smoke Britânia 2026 | Script validate + UI Pesquisa → ≥1 row |
| **3** | Adapter Conciliação ← O2C | Service + testes; UI sem redesign |
| **4** | Adapter Inteligência ← O2C | Enrich por pedido + maturity |
| **5** | Deprecar dual-read | Docs + flag / sunset Portfolio na tela |

---

## 8. Arquivos a alterar no próximo prompt (etapa 1)

| Arquivo | Mudança esperada |
|---------|------------------|
| `src/lib/financeOrderToCashAuditApi.server.ts` | Política de resolução de run (específica → geral → fallback) |
| `src/lib/finance/orderToCashAuditApi.ts` | Where/agregação de summary segura (CR por pedido) se necessário |
| `src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx` | Preferir/enviar `externalCustomerId` |
| `src/lib/finance/orderToCashAuditClient.ts` | Query com externalId; helpers de resolução cliente |
| `src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx` | Exibir runId/meta; opcional seletor |
| `src/components/finance/portfolio-reconciliation/OrderToCashAuditSummaryCards.tsx` | Consumir totais seguros |
| `src/lib/finance/orderToCashAuditApi.test.ts` / `orderToCashAuditUi.test.ts` | Cobrir política de run + externalId |
| (opcional) `CustomerAutocomplete` / search DTO | Expor código externo Nomus se disponível |

**Não alterar neste próximo passo (salvo se bloqueador):** Contas a Receber, Fluxo, Comissões, Presidencial, migrations.

---

## 9. Conclusão objetiva

| Aba | Ação |
|-----|------|
| **Conciliação** | Continua Portfolio **hoje**; alvo = O2C via **adapter** |
| **Inteligência** | Continua motor antigo **hoje**; alvo = fatos O2C agregados |
| **Auditoria** | Já é O2C; **corrigir** escolha de run + **`externalCustomerId=200`** para Britânia |

Vazio na Auditoria, se ocorre com Britânia 2026, é **quase certamente** parâmetro de cliente (UUID vs 200) e/ou política de run — **não** endpoint errado nem mode `APPLY` vs `apply`.
