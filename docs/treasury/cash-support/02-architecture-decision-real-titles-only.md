# ADR 001 — Fronteira de conciliação: somente títulos reais

- **Status:** Aceita
- **Data:** 2026-08-06
- **Contexto:** Etapa 1 (`f0821d7`) comprovou (a) que existe motor de conciliação
  bancária maduro no IndusCost e (b) que **não existe identidade estável** atravessando
  Proposta → PV → DS → NF-e → CR.
- **Substitui:** a premissa original do Prompt 0 §5, de conciliar por `economicEventKey`
  estável ao longo da evolução documental.

---

## 1. Decisão

### 1.1 Nenhum segundo motor de conciliação

`TreasuryReconciliation*` (match, movements, allocations) é a **autoridade única** de
conciliação bancária. O Apoio ao Caixa é camada de **leitura unificada + apresentação +
delegação de comandos**. Não terá tabela de match, de alocação, de estado de conciliação
nem de residual.

### 1.2 Somente títulos reais são conciliáveis

Conciliável = título oficial existente no Nomus, identificado por `externalId` positivo,
lado `AR` ou `AP`. Só ele pode receber `TreasuryReconciliationAllocation` de kind `TITLE`.

### 1.3 Previsões são contexto, nunca alvo

Linhas FIN-08 de `lineKind` `ORDER_PLAN_FORECAST`, `ORDER_RESIDUAL_FORECAST` e
`DOCUMENT_AWAITING_CR` (id sintético negativo):

- **não recebem allocation** — sob nenhuma condição;
- **não podem ser marcadas como recebidas ou pagas**;
- **não geram estado de conciliação**;
- aparecem apenas para explicar o que se espera do futuro.

Motivo: o id sintético é FNV-1a de `forecast:{orderCode}:{parcela}:{dueDate}` — muda
quando a parcela é reagendada e desaparece quando o CR real é emitido. Amarrar dinheiro
bancário a essa chave produziria conciliação que se perde sozinha.

### 1.4 Semântica financeira congelada

| Conceito | Regra |
|---|---|
| CR/CP real | Compromisso **oficial**. Autoridade: Nomus |
| Movimento bancário | Dinheiro **efetivo**. Autoridade: `TreasuryBankMovement` |
| `bankDate` (`postedCivilDate`) | Determina o **realizado** de caixa |
| `dueDate` | Determina **previsão, atraso e programação** — nunca realizado |
| Movimento válido sem classificação | **Afeta a posição bancária mesmo assim** |
| Classificação | **Explica** o movimento; não cria nem destrói dinheiro |
| Transferência interna | Efeito individual em cada conta; **consolidado = zero** |
| Conciliação | **Não realiza baixa oficial no Nomus** (`TREASURY_RECONCILIATION_DOES_NOT_REALIZE_OFFICIAL = true`) |
| Título coberto por movimento | **Não pode ser somado novamente** ao caixa |

---

## 2. Identidades

Três identidades **distintas e não intercambiáveis**. Nenhuma se converte na outra.

### A. `officialTitleKey` — conciliável

```
officialTitleKey = {companyCode}:{side}:{externalId}
  side ∈ { ACCOUNTS_RECEIVABLE, ACCOUNTS_PAYABLE }
  externalId: inteiro POSITIVO (id oficial Nomus)
```

- Estável: é o id do título no sistema de origem.
- Único alvo permitido de allocation `TITLE`.
- Mapeia direto para `TreasuryReconciliationAllocation.nomusSide` + `nomusExternalId`,
  que já existem.
- **Invariante:** `externalId > 0`. Valor negativo é previsão — rejeitar.

### B. `bankMovementKey` — evidência bancária

```
bankMovementKey = TreasuryBankMovement.id (uuid)
```

Reusa a identidade existente. Deduplicação já garantida no banco por
`@@unique([accountId, fingerprint])` e `@@unique([accountId, fitId])`. O Apoio ao Caixa
**não cria identidade nova** para movimento e não recalcula fingerprint.

### C. `forecastContextKey` — apenas contexto

```
forecastContextKey = {orderCode}:{lineKind}:{externalIdSintetico}
```

- **Instável por natureza:** muda com recálculo, reagendamento ou emissão do CR.
- **Proibida em allocations.** Nenhuma escrita a referencia.
- Serve só para agrupar e exibir a previsão na tela e correlacionar visualmente com o
  pedido.
- Toda linha que a carrega tem `reconcilable = false`.

### Invariante de tipo
Os três são tipos distintos no contrato (Etapa 4). Nenhuma função aceita um no lugar do
outro; nenhum caminho de escrita aceita `forecastContextKey`.

---

## 3. Consequências

**Positivas**
- Zero duplicação: o motor existente responde por estado, residual, capacidade,
  locking, auditoria e reversão.
- Conciliação inquebrável: ancorada em id oficial Nomus, imune à evolução documental.
- Superfície de escrita mínima → menor risco financeiro.

**Negativas / aceitas**
- Previsão do Pedido nunca será conciliada, mesmo quando "obviamente" corresponder a um
  depósito. O usuário deve esperar o CR real. **Aceito**: é a única forma de não inventar
  chave instável.
- Não haverá rastreio automático PV → CR dentro do Apoio ao Caixa.
- Empresa/conta/moeda continuam limitados enquanto a Linha do tempo não os expuser
  (ver `01-current-state-audit.md` §7).

**Rejeitadas**
- Criar `economicEventKey` derivando de `orderCode` + parcela: `CR_REAL` não carrega
  número de parcela; fecharia só no nível do pedido, o que não é identidade de evento.
- Persistir tabela de correlação previsão→título: seria segunda autoridade e exigiria
  reconstruir cobertura FIN-08.
