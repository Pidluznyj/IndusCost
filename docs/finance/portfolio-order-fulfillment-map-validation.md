# Mapa de Atendimento — Validação final ponta a ponta

**Projeto:** IndusCost / My Industry  
**Módulo:** Financeiro → Conciliação de Carteira → Central de Inteligência  
**Data da validação:** 2026-07-11  
**HEAD validado:** `adefb6a` (antes deste documento) → commit deste relatório anexa o doc  
**Status:** **PRONTO** (modo FIXTURE — Postgres local indisponível)

> Complementa: [`portfolio-order-fulfillment-map-requirements.md`](./portfolio-order-fulfillment-map-requirements.md), [`pd02339-fulfillment-validation.md`](./pd02339-fulfillment-validation.md).

---

## 1. Resumo executivo

A lógica de **Mapa de Atendimento item a item** está estável na camada paralela (read-only) da Inteligência da Carteira:

| Critério | Resultado |
|----------|-----------|
| PD 02339 responde item a item | **PASS** (fixture) |
| Britânia totais / sem duplicidade | **PASS=65 FAIL=0** (fixture) |
| Cards principais não duplicam valor | **PASS** |
| Layout em 3 blocos + alertas distintos | **PASS** (contrato UI) |
| Módulos oficiais intactos | **PASS** |
| Migrations / writes nesta feature | **Nenhuma** nesta validação |

**Limitação de ambiente:** `localhost:5432` inacessível — scripts caíram para **FIXTURE**. Reexecutar com DB + run `1dc2ead7-533d-4ad4-bc4c-621061fa5623` para fechar o ciclo materializado.

---

## 2. Problema corrigido

Antes, a Central misturava:

1. **Status financeiro** (CR/baixa) com **atenção operacional** (itens/documentos).
2. **Alertas técnicos** (cabeçalho NF, excesso, produto fora) parecendo “dinheiro novo”.
3. Cabeçalho de NF sugerindo valor de carteira maior que o pedido.

**Correção:** motor `portfolioOrderFulfillmentMap.ts` + UI em três blocos (financeiro / operacional / alertas) + drawer com aba **Mapa de Atendimento** primeiro, sem JSON cru.

---

## 3. Regra de negócio item a item (validada)

1. Quantidade atendida **capped** ≤ quantidade pedida por item.  
2. Excesso de documento fica em `excessQuantity` / alertas — **não** soma carteira.  
3. Produto fora do pedido em `itemsOutsideOrder` — **não** aumenta valor do pedido.  
4. Cabeçalho NF é referência de risco; valor atribuído ≤ valor oficial do pedido.  
5. Status financeiro (`FIN_*`) e operacional (`OP_*`) são eixos separados; alertas coexistêm.  
6. Sem inventar CR, baixa, NF ou condição de pagamento.

---

## 4. Validação PD 02339

**Script:** `npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts`  
**Fonte nesta execução:** FIXTURE (DB offline)

| Check | Resultado |
|-------|-----------|
| Pedido encontrado | PASS — `3915fa28-1947-4388-bb27-2699c3cbb516` |
| Valor R$ 158.000,00 | PASS |
| Itens individuais | PASS — 4 itens (452, 455, 456, 537) |
| Documentos / NFs | PASS — 3 NFs / 3 docs |
| CR | PASS objetivo — **ausente nesta fixture** (`FIN_FATURADO_SEM_CR`); UI mostra estado vazio “Nenhum Contas a Receber…” **sem inventar título** |
| Financeiro ≠ operacional | PASS — `FIN_FATURADO_SEM_CR` × `OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE` |
| Cabeçalho não infla | PASS — header R$ 355.290; atribuído R$ 158.000 |
| Excesso separado | PASS — qtde excedente 23.000 |
| Produto fora separado | PASS — produtos 538 e 453 |
| Conclusão executiva | PASS — texto PT com eixos e alertas |

**Resumo script:** `PASS=19 FAIL=0`

---

## 5. Validação Britânia

**Script:** `npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts`  
**Fonte:** FIXTURE Britânia-shaped  
**runId esperado:** `1dc2ead7-533d-4ad4-bc4c-621061fa5623`

| Métrica | Esperado | Atual | Status |
|---------|----------|-------|--------|
| Pedidos | 31 | 31 | PASS |
| Valor total | R$ 3.324.636,50 | 3.324.636,50 | PASS |
| Sem NF/doc/CR (qtd) | 13 | 13 | PASS |
| Sem NF/doc/CR (valor) | R$ 1.380.296,00 | 1.380.296,00 | PASS |
| Futuro + presente | R$ 495.460,00 | 495.460,00 | PASS |
| Vencida/bloqueada | R$ 884.836,00 | 884.836,00 | PASS |
| Soma status = carteira | — | ok | PASS |
| PD 02159 vencido/bloqueado | CARTEIRA_VENCIDA_BLOQUEADA | ok | PASS |

**Resumo script:** `PASS=65 FAIL=0`  
(Interpretação do pedido “PASS=0 FAIL”: ler como **FAIL=0**.)

---

## 6. Validação UI (contrato de código + layout)

Sem browser live nesta sessão; cobertura por testes de UI/contrato e inspeção de componentes:

| Item | Evidência |
|------|-----------|
| Três blocos: Financeiro / Operacional / Alertas | `PortfolioIntelligenceCards.tsx` — títulos e `data-testid` dos blocos |
| Cards com “?” | `MetricHelpTooltip` nos cards, sanfonas e KPIs |
| Alertas não somam carteira | badge “alerta”, texto “não soma carteira”, notice no bloco 3 |
| Drawer abre | `PortfolioIntelligenceOrderDrawer` + fetch detalhe |
| Mapa primeiro | `TABS[0] = Mapa de Atendimento` |
| Sem JSON cru no drawer de inteligência | sem `JSON.stringify` do mapa; grids tipados |
| Frescor sync/rebuild | bloco “Frescor dos dados” + banner na seção |
| Pedido antigo sem NF/doc/CR | Britânia PD 02159 → `CARTEIRA_VENCIDA_BLOQUEADA` |

**Descrição visual (texto):**

1. Cabeçalho da Central com intro de maturidade + aviso “pedido ≠ caixa até CR” + legenda Financeiro/Operacional/Alerta + banner de frescor.  
2. Cards em faixas: total → financeiro (verde/azul) → operacional → atendimento operacional → alertas tracejados → conversão.  
3. Sanfonas em 3 grupos.  
4. Drawer: chips de eixo + frescor + mapa com itens/docs/CR/excesso/fora.

---

## 7. Não regressão — módulos oficiais

| Módulo | Status |
|--------|--------|
| Fluxo de Caixa | Não alterado nesta feature (camada paralela) |
| Contas a Receber oficial | Não alterado |
| Comissões | Não alterado |
| Relatório Presidencial | Não alterado |
| Migrations novas nesta validação | Nenhuma |
| Mutations / writes | Nenhum — loaders Prisma só `find*` |
| Endpoints inteligência | Somente `app.get` em `financePortfolioReconciliationRoutes.ts` |
| Erros técnicos | `financeApiErrorJson`; detalhe do mapa em try/catch sem stack |

---

## 8. Testes executados (2026-07-11)

```
npm run check:server-imports          → OK
npm run check:frontend-server-imports → OK
npm test                              → pass (suítes agregadas; fail 0)
npm run build                         → OK
npm run check:browser-bundle          → OK
npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts
  → PASS=19 FAIL=0 (FIXTURE)
npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts
  → PASS=65 FAIL=0 (FIXTURE)
```

---

## 9. Limitações conhecidas

1. **DB offline** nesta máquina — validação materializada da run Britânia não rodou contra Postgres.  
2. **PD 02339 fixture sem CR** — financeiro = faturado sem CR; CR só aparece quando existir nos fatos (não inventado). Com sync + rebuild, o frescor da tela deixa isso explícito.  
3. Screenshots de UI browser não capturados nesta sessão (validação por contrato de código).  
4. KPIs de excedente/produto fora dependem de tags/fatos do mapa; pedidos só-ORDER_ONLY ficam em “não atendido” operacional.

---

## 10. Próximos passos

1. Reexecutar os dois scripts `tmp-audits/*` com Postgres e run `1dc2ead7-…` materializada.  
2. Confirmar PD 02339 na run real: se houver CR após sync de Contas a Receber + rebuild, eixos `FIN_CR_ABERTO`/`FIN_RECEBIDO` + alertas técnicos coexistindo.  
3. Smoke manual no browser: abrir Inteligência → Britânia → drawer PD 02339 (Mapa) e PD 02159 (vencido/bloqueado).  
4. Opcional: capturar screenshots para anexar a este doc.

---

## 11. Arquivos-chave da feature (referência)

- `src/lib/finance/portfolioOrderFulfillmentMap.ts`  
- `src/lib/finance/portfolioMaturityAnalytics.ts`  
- `src/lib/finance/portfolioMaturityIntelligenceApi.ts`  
- `src/lib/finance/portfolioIntelligenceDataFreshness.ts`  
- `src/components/finance/portfolio-reconciliation/PortfolioIntelligence*.tsx`  
- `tmp-audits/validate-pd02339-fulfillment-map.ts`  
- `tmp-audits/validate-portfolio-intelligence-britania.ts`
