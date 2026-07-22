# Máquina de estados — Fluxo de Pedidos (Kanban)

**OP-46** · Formalização normativa da única máquina de estados do Kanban comercial.  
**Catálogo TypeScript:** `src/lib/sales/salesOrderFlowCatalog.ts`  
**Auditoria prévia:** [current-state-audit.md](./current-state-audit.md)  
**Políticas reutilizadas:** [effective-schedule-policy.md](../../finance/effective-schedule-policy.md), [stage-release-candidate.md](../../output-documents/stage-release-candidate.md)

---

## 1. Checklist YAGNI e reutilização (antes de alterar)

| Pergunta | Decisão |
|----------|---------|
| Precisamos de novo master / tabela de status? | **Não.** Kanban continua projeção read-only. |
| Precisamos de motor completo de evidências agora? | **Não.** OP-46 só formaliza máquina + catálogos. |
| Podemos reutilizar FIN-03? | **Sim** — liberação / atendimento / residual (`salesOrderItemFinancialFulfillmentClassifier`). |
| Podemos reutilizar vínculos OP / DS / NF-e? | **Sim** — links Nomus já auditados em OP-45. |
| `INCONSISTENT` vira coluna? | **Não.** É condição auxiliar que coexiste com o estágio operacional. |
| Espalhar strings de estágio? | **Não.** Só o catálogo central. |

---

## 2. Regra central

> A **coluna do pedido** representa a **primeira obrigação ainda não cumprida** entre todos os **itens ativos**.

Formalmente:

1. Classificar cada item ativo em um `SalesOrderItemFlowStage`.
2. Excluir itens em `CANCELED` da votação.
3. Se não restar item ativo → pedido `CANCELED`.
4. Caso contrário → estágio do pedido = `min(priority(stage))` entre os ativos  
   (`pickSalesOrderFlowStageFromItemStages` no catálogo).

`INCONSISTENT` **não** substitui essa coluna: anexa códigos/severidade ao mesmo cartão.

---

## 3. Colunas (estágios) e prioridade

| Ordem | Código | Label oficial | Prioridade | Área responsável |
|------:|--------|---------------|----------:|------------------|
| 1 | `WAITING_RELEASE` | Aguardando liberação | 10 | COMERCIAL |
| 2 | `WAITING_PRODUCTION_ORDER` | Aguardando OP | 20 | PCP_PRODUCAO |
| 3 | `IN_PRODUCTION` | Em produção | 30 | PCP_PRODUCAO |
| 4 | `WAITING_OUTPUT_DOCUMENT` | Aguardando documento de saída | 40 | EXPEDICAO_FATURAMENTO |
| 5 | `WAITING_NFE` | Aguardando NF-e | 50 | FISCAL |
| 6 | `SHIPPED_COMPLETED` | Enviado / concluído | 60 | NENHUMA |
| 7 | `CANCELED` | Cancelado | 90 | NENHUMA |

Prioridade menor = obrigação mais cedo = vence na agregação.

### Condição auxiliar (não-coluna)

| Código | Uso |
|--------|-----|
| `INCONSISTENT` | Há um ou mais `SalesOrderFlowInconsistencyCode` no pedido/item. |

---

## 4. Critérios de entrada e saída (item)

Fontes oficiais (não inventar segunda verdade): status Nomus do item + FIN-03, vínculos OP (`NomusProductionOrderSalesLink.linkedQuantity`), alocação documental (DS/O2C), `SalesOrderNfeLink` / `NomusNfe` (autorizada = status 4; cancelada = 7).

### 4.1 `WAITING_RELEASE`

| | Critério |
|--|----------|
| **Entrada** | Item ativo com obrigação comercial de liberação ainda aberta (FIN-03 / status Nomus: não liberado para produção/faturamento conforme classificador oficial). |
| **Saída** | Item liberado (ou cancelado/corte residual zero). |
| **Próxima ação** | Liberar itens pendentes no Nomus / acompanhar liberação comercial. |

### 4.2 `WAITING_PRODUCTION_ORDER`

| | Critério |
|--|----------|
| **Entrada** | Item liberado **e** `requiresProduction === true` **e** `remainingFulfillment = max(0, activeObligation − fulfilledQuantity) > 0` **e** cobertura de OP (`linkedQuantity`) insuficiente para esse residual. |
| **Não entrar** | Quando `fulfilledQuantity >= activeObligation` — nunca `WAITING_PRODUCTION_ORDER` (mesmo sem OP). Seguir precedência documental/fiscal (`WAITING_OUTPUT_DOCUMENT` / `WAITING_NFE` / `SHIPPED_COMPLETED`) e classificar `FULFILLED_WITHOUT_PRODUCTION` (INFO). |
| **Saída** | OP cobre o residual **ou** item deixa de exigir produção **ou** residual zero **ou** evidência terminal de envio/conclusão (NF-e válida cobrindo o alvo). |
| **Próxima ação** | Abrir ou vincular Ordem de Produção aos itens liberados. |
| **Gap (OP-45)** | Se `requiresProduction` não estiver contratado → não inventar; emitir `REQUIRES_PRODUCTION_UNKNOWN` e **não** forçar esta coluna só por ausência de OP. |

### 4.3 `IN_PRODUCTION`

| | Critério |
|--|----------|
| **Entrada** | Há OP vinculada com cobertura parcial/total ainda em andamento; quantidade produzida oficial ainda insuficiente para a obrigação ativa (quando normalizada). |
| **Saída** | Produção coberta para a qty ativa **ou** fluxo passa a exigir só documento/NF **ou** residual zero. |
| **Próxima ação** | Acompanhar apontamento/andamento da OP. |
| **Gap** | Qty produzida normalizada ainda não existe no stage → `PRODUCTION_QTY_NOT_NORMALIZED`; usar presença/cobertura de OP como proxy até OP de normalização. |

### 4.4 `WAITING_OUTPUT_DOCUMENT`

| | Critério |
|--|----------|
| **Entrada** | Liberado (e produção satisfeita ou não exigida) **e** quantidade ativa sem alocação documental suficiente (DS / resolver O2C). |
| **Saída** | Documento de saída alocado cobrindo a qty ativa (ou residual zero). |
| **Próxima ação** | Emitir/sincronizar Documento de Saída alocado ao pedido. |

### 4.5 `WAITING_NFE`

| | Critério |
|--|----------|
| **Entrada** | Há cobertura documental (ou evidência de faturamento pendente de NF) **e** não há NF-e **válida** cobrindo a qty ativa. |
| **Saída** | NF-e válida vinculada (ver §7). |
| **Próxima ação** | Emitir/autorizar NF-e válida vinculada ao documento/pedido. |

### 4.6 `SHIPPED_COMPLETED`

| | Critério |
|--|----------|
| **Entrada** | Obrigação operacional do item encerrada: qty ativa coberta por **NF-e válida** (proxy de envio até existir data de saída normalizada) **ou** residual oficial zero após atendimento/corte com cobertura fiscal da parte atendida. |
| **Saída** | Só por regressão evidenciada (ex.: NF cancelada com item ainda ativo → volta a `WAITING_NFE` / inconsistência). |
| **Próxima ação** | Nenhuma. |

### 4.7 `CANCELED`

| | Critério |
|--|----------|
| **Entrada** | Status oficial de cancelamento do item (FIN-03 / Nomus). |
| **Saída** | Não reabre por projeção Kanban; eventual reabertura só via correção na origem. |
| **Próxima ação** | Nenhuma. |

---

## 5. Retorno de etapa (regressão)

Regressão **só** quando a evidência oficial deixa de cumprir a obrigação da etapa atual:

| Situação | Efeito |
|----------|--------|
| NF-e autorizada → cancelada (7) com item ainda ativo | Volta para `WAITING_NFE` (ou `WAITING_OUTPUT_DOCUMENT` se DS também cair); `NFE_CANCELED_WITH_ACTIVE_ITEMS`. |
| Documento/alocação O2C removida ou stale | Pode voltar de `WAITING_NFE` → `WAITING_OUTPUT_DOCUMENT`; `O2C_ALLOCATION_STALE`. |
| Vínculo OP removido / `linkedQuantity` insuficiente | Pode voltar de `IN_PRODUCTION` → `WAITING_PRODUCTION_ORDER` (se ainda exige produção **e** a obrigação operacional ainda não estiver encerrada por NF-e válida). |
| Liberação revertida na origem | Volta para `WAITING_RELEASE`. |

Não regressar por heurística financeira paralela (cronograma efetivo FIN não redefine coluna comercial).

---

## 6. Cancelamento, corte e atendimento parcial

### 6.1 Cancelamento

- Item cancelado → estágio `CANCELED`; **não vota** na coluna do pedido.
- Todos os itens cancelados → pedido `CANCELED`.
- Mistura cancelado + ativo → coluna = primeira obrigação dos **ativos**.

### 6.2 Corte (`FULFILLED_WITH_CUT`)

- Residual comercial **zero** (política FIN / FIN-03): o item **não** mantém obrigação de liberação/produção/documento para a qty cortada.
- Parte atendida ainda pode exigir DS/NF → estágio conforme cobertura da qty atendida.
- Corte **inferido** sem status oficial → `CUT_WITHOUT_OFFICIAL_STATUS` (ERROR); não inventar corte.

### 6.3 Atendimento parcial

- Qty atendida avança evidências (OP/DS/NF); qty residual mantém a obrigação mais cedo ainda aberta.
- Item parcial com residual incoerente → `PARTIAL_WITHOUT_REMAINING_QTY`.
- Pedido com vários itens em estágios distintos → coluna = min priority; `MIXED_ACTIVE_ITEM_STAGES` (INFO).

### 6.4 Status desconhecido

- Status Nomus fora do catálogo mapeado → `ITEM_STATUS_UNKNOWN` (WARNING).
- Não promover para `SHIPPED_COMPLETED` nem `CANCELED` por chute.
- Preferir manter a última obrigação segura conhecida ou `WAITING_RELEASE` se não houver evidência de liberação.

---

## 7. Regra de envio pela NF-e válida

Até existir data de envio/saída normalizada no stage:

1. **NF-e válida** = vínculo pedido/item + status autorizado (código Nomus **4**), não cancelada (**7**).
2. Essa NF-e válida é o **proxy oficial de envio/conclusão operacional** para `SHIPPED_COMPLETED`.
3. Ausência de data de envio → `NFE_SHIP_DATE_MISSING` (INFO), **sem** impedir conclusão pelo proxy.
4. NF sem documento alocado → `NFE_WITHOUT_DOCUMENT` (WARNING); não inventar DS.
5. Documento sem NF → permanece `WAITING_NFE` + `DOCUMENT_WITHOUT_NFE` (INFO).

Alinhado a `nfeStatus.ts` / auditoria OP-45.

---

## 8. Conclusão do pedido

Pedido em `SHIPPED_COMPLETED` quando **todos** os itens ativos estão em `SHIPPED_COMPLETED` (agregação pela regra central).

Pedido em `CANCELED` quando **não há** itens ativos (todos cancelados) ou o pedido não possui itens ativos elegíveis.

Itens stale: não votam como obrigação operacional; `STALE_ITEM_PRESENT` (INFO).

---

## 9. Próxima ação e área responsável

Definidos no catálogo:

- `SALES_ORDER_FLOW_STAGE_NEXT_ACTION`
- `SALES_ORDER_FLOW_STAGE_RESPONSIBLE_AREA`

A UI do Kanban deve ler **só** esses maps (não hardcodar textos por coluna).

---

## 10. Códigos de inconsistência e severidades

Severidades: `INFO` &lt; `WARNING` &lt; `ERROR` &lt; `CRITICAL`.

| Código | Severidade | Significado resumido |
|--------|------------|----------------------|
| `ITEM_STATUS_UNKNOWN` | WARNING | Status Nomus do item desconhecido |
| `REQUIRES_PRODUCTION_UNKNOWN` | WARNING | Necessidade de produção não contratada |
| `PRODUCTION_QTY_NOT_NORMALIZED` | WARNING | Qty produzida ainda não normalizada |
| `OP_LINK_WITHOUT_QUANTITY` | WARNING | Vínculo OP sem `linkedQuantity` |
| `DOCUMENT_WITHOUT_NFE` | INFO | DS sem NF-e válida |
| `NFE_WITHOUT_DOCUMENT` | WARNING | NF-e sem DS alocado |
| `NFE_CANCELED_WITH_ACTIVE_ITEMS` | ERROR | NF cancelada com itens ativos |
| `NFE_SHIP_DATE_MISSING` | INFO | Data de envio não normalizada |
| `PARTIAL_WITHOUT_REMAINING_QTY` | WARNING | Parcial sem residual coerente |
| `CUT_WITHOUT_OFFICIAL_STATUS` | ERROR | Corte sem status oficial |
| `FULFILLED_WITHOUT_COVERAGE` | WARNING | Atendido sem cobertura doc/fiscal |
| `FULFILLED_WITHOUT_PRODUCTION` | INFO | Atendido pelo estoque / sem necessidade de OP (não afirma movimento de estoque) |
| `STALE_ITEM_PRESENT` | INFO | Item stale no pedido |
| `MIXED_ACTIVE_ITEM_STAGES` | INFO | Itens ativos em estágios distintos |
| `O2C_ALLOCATION_STALE` | WARNING | Alocação O2C defasada |
| `DUPLICATE_TRUTH_RISK` | CRITICAL | Risco de segunda fonte da verdade |

---

## 11. O que OP-46 **não** implementa

- Coletor de evidências / classificador por pedido a partir do DB.
- API paginada por coluna do Kanban.
- Normalização de qty produzida ou data de envio.
- Campo `requiresProduction` no contrato (apenas inconsistência + regra de não inventar).
- Alteração de FIN-03, O2C ou masters Nomus.

---

## 12. Contratos TypeScript (fonte única)

| Símbolo | Papel |
|---------|--------|
| `SalesOrderFlowStage` | Coluna do pedido |
| `SalesOrderItemFlowStage` | Estágio do item (mesmos valores) |
| `SalesOrderFlowInconsistencyCode` | Código auxiliar |
| `SalesOrderFlowInconsistencySeverity` | Severidade |
| `stagePriority` / `SALES_ORDER_FLOW_STAGE_PRIORITY` | Ordenação |
| `SALES_ORDER_FLOW_STAGE_LABELS` | Labels oficiais |
| `pickSalesOrderFlowStageFromItemStages` | Regra central pura |

Qualquer consumidor novo **importa** deste módulo — não redeclara strings de estágio ou código.
