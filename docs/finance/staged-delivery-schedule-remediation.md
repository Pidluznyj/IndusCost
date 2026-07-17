# FIN-13 — Remediação da agenda em entregas parciais (staged delivery)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | FIN-13 |
| **Atualizado** | 2026-07-17 |
| **Motor** | `salesOrderEffectiveFinancialSchedule` (FIN-05) + `salesOrderStagedDeliverySchedule` |
| **Migration** | **Não** — agenda efetiva é derivada; sem tabela de agenda manual explícita |

---

## 1. Comportamento atual (bug)

Após calcular o residual comercial ativo dos itens (`itemActiveResidualTotal`), o motor distribuía esse valor em **todas** as parcelas originais do Pedido por peso (`allocateResidualToOriginalInstallments`).

Exemplo incorreto:

- Pedido R$ 300.000 · 3 × R$ 100.000  
- 1ª entrega R$ 100.000 · residual R$ 200.000  
- Resultado: residual R$ 66.666,67 em **cada** parcela (rateio percentual)

Isso distorce competência mensal e não representa “próxima posição ocupada pela entrega”.

Arquivo-raiz: `src/lib/finance/salesOrderEffectiveFinancialSchedule.ts` (`allocateResidualToOriginalInstallments` + loop de residual).

---

## 2. Fluxo normal preservado

Quando Documento/CR cobre **toda** a obrigação comercial ativa (`itemActiveResidualTotal = 0`):

- substituição integral (como hoje);
- `activeOrderResidualSchedule` vazio;
- **nenhuma** redistribuição staged.

Quando **não** há materialização (sem Documento/CR válido):

- parcelas originais do Pedido permanecem a previsão vigente (pesos = 100%).

---

## 3. Condição que ativa a exceção (`STAGED_AUTOMATIC`)

Todas simultâneas:

1. ≥ 1 bloco de entrega válido (Documento e/ou CR agrupado por NF);
2. `itemActiveResidualTotal > 0`;
3. item `PARTIALLY_FULFILLED` ou `NOT_FULFILLED`;
4. ≥ 2 posições planejadas no Pedido;
5. sem agenda manual explícita (mecanismo ainda inexistente).

**Não** ativar só porque `Documento < Pedido` (corte/cancelamento/inconclusivo).

---

## 4. Algoritmo escolhido

1. Ordenar entregas: `documentDate` → `issuedAt` → `documentKey`.  
   CR sem Documento: agrupar por `sourceInvoiceId` (1 bloco / NF).
2. Ordenar posições: `installmentNumber` → `dueDate` → índice.
3. Cada entrega ocupa **uma** posição aberta (não N títulos CR).
4. Residual comercial ativo redistribuído **somente** nas posições restantes (pesos relativos).
5. Centavos na última posição residual.
6. Mais entregas que posições + residual > 0 → `stagedResidualWithoutPosition` + alerta (sem inventar vencimento).

Base comercial do residual continua FIN-04 (`allocatedByOrderPrice` / itens). CR com frete/imposto **não** aumenta o consumo comercial.

---

## 5. Classificação central

| Código | Significado |
|---|---|
| `NO_MATERIALIZATION` | Sem Doc/CR válido |
| `FULL_SUBSTITUTION` | Cobertura total da obrigação ativa |
| `STAGED_AUTOMATIC` | Entrega parcial + saldo ativo + multi-posição |
| `STAGED_MANUAL` | Agenda manual explícita (reservado; sem schema hoje) |
| `CLOSED_WITH_CUT` | Residual zero com corte |
| `CANCELED` | Sem obrigação futura por cancelamento |
| `INCONCLUSIVE` | UNKNOWN / não seguro zerar |

---

## 6. Consumidores

Todos já consomem FIN-05 (FIN-08/09/10/11). Correção no motor propaga para:

- Detalhe financeiro do Pedido  
- Contas a Receber efetiva  
- Auditoria 360° / projeção  
- Alertas  
- Relatório mês a mês / O2C facts (após rebuild derivado)

Fluxo de Caixa permanece Nomus-only (sem previsão de Pedido).

---

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Regressão pedido integral | Bifurcação explícita + testes byte/semântica |
| Mais docs que parcelas | Alerta + `stagedResidualWithoutPosition` |
| Agenda manual inexistente | Sem migration; path `STAGED_MANUAL` só com input explícito futuro |
| Facts O2C desatualizados | Comando `repair:staged-delivery-schedules` (rebuild derivado) |

---

## 8. Migration

**Não necessária.** Não há persistência de agenda residual; não há evidência explícita de agenda manual no schema.
