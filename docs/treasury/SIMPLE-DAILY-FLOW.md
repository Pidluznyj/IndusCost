# Fluxo diário simplificado — Central de Tesouraria

**Status:** canônico para a jornada diária (produto)  
**Branch de preparação:** `feat/treasury-simple-daily-flow`  
**Atualizado:** 2026-07-28  

Este documento define a experiência diária **simples** sem substituir o módulo avançado já entregue. A UI unificada ainda não é implementada aqui — apenas o contrato de produto e as fórmulas.

Documentação técnica correlata: [12-BUSINESS-RULES.md](./12-BUSINESS-RULES.md), [15-PROJECTION-AND-DOUBLE-COUNTING.md](./15-PROJECTION-AND-DOUBLE-COUNTING.md), [16-DAILY-CLOSING.md](./16-DAILY-CLOSING.md), [17-OFX-AND-RECONCILIATION.md](./17-OFX-AND-RECONCILIATION.md).

---

## 1. Princípios canônicos

| Princípio | Regra |
|-----------|--------|
| Fonte oficial dos títulos | **Nomus** (`NomusAccountsReceivable` / `NomusAccountsPayable`). A Tesouraria **não** altera títulos oficiais. |
| Vínculo de conta | Conta financeira **Nomus** (`idContaBancaria` / `bankAccountId`) é a origem do vínculo com `TreasuryFinancialAccount.nomusBankAccountId`. |
| Saldo inicial | **Manual** (informado pelo operador no começo do dia), preferencialmente sugerido pelo saldo final fechado do dia anterior. |
| Saldo final bancário | **Manual** (valor visto no extrato/app do banco no fim do dia). |
| `dueDate` oficial | **Nunca** alterado pela Tesouraria. |
| Baixa automática Nomus | **Proibida**. |
| Movimentação de dinheiro | A Tesouraria **não** transfere dinheiro real; registra intenção/ledger local. |
| Dinheiro | Decimal / string; fuso `America/Sao_Paulo`. |
| Histórico | Sem exclusão física (cancelar / reverter / versionar). |

---

## 2. Conceitos do dia

| Conceito | Significado |
|----------|-------------|
| Recebimentos previstos (CR previsto) | Títulos CR ainda em aberto com data de planejamento no dia (cenário da jornada). |
| Recebimentos realizados (CR realizado) | Valor efetivamente liquidado no Nomus no dia (`amountReceived` + `settlementDate`). Baixa parcial = só o liquidado. |
| Pagamentos previstos (CP previsto) | Títulos CP em aberto com data de planejamento no dia. |
| Pagamentos realizados (CP realizado) | Valor efetivamente pago no Nomus no dia (`amountPaid` + data de liquidação). |
| Saldo previsto | Resultado da fórmula de saldo final previsto (abaixo). |
| Saldo realizado | Resultado da fórmula de saldo final realizado calculado (abaixo). |
| Saldo final informado | Saldo bancário digitado pelo operador (observado). |
| Divergência | `saldo final bancário informado − saldo final realizado calculado`. |
| OFX | Prova bancária: confirma ou explica movimentos; **não** duplica valores já realizados por título/ledger. |
| Fechamento | Congela a posição do dia (versão imutável; reabertura cria nova versão). |
| Abertura do próximo dia | Saldo final **informado** (ou fechado) sugere o saldo inicial de D+1. |
| Projeção futura | Horizonte pós-fechamento (cenários CONTRACTUAL / PROBABLE / CONFIRMED + MANUAL), risco de saldo negativo e reserva mínima. |

---

## 3. Fórmulas canônicas

Valores em string decimal Tesouraria. Transferências internas afetam contas individualmente e são **neutras no consolidado**.

### 3.1 Saldo final previsto

```text
saldo inicial
+ CR previsto
− CP previsto
+ transferências previstas recebidas
− transferências previstas enviadas
+ lançamentos manuais previstos
= saldo final previsto
```

### 3.2 Saldo final realizado calculado

```text
saldo inicial
+ CR baixado no Nomus
− CP baixado no Nomus
+ entradas locais realizadas
− saídas locais realizadas
+ transferências recebidas
− transferências enviadas
= saldo final realizado calculado
```

### 3.3 Divergência

```text
saldo final bancário informado
− saldo final realizado calculado
= divergência
```

Interpretação: divergência ≠ 0 exige investigação (OFX/conciliação/ledger), não auto-baixa Nomus.

---

## 4. Regras contra duplicidade

1. **OFX conciliado com título** não soma novamente o mesmo valor ao caixa do dia.
2. **OFX conciliado com ledger** não soma novamente.
3. **OFX sem correspondência** não altera saldo calculado até ação explícita do usuário (criar lançamento manual / alocar).
4. **Transferência interna** não altera o consolidado (soma das pernas = 0).
5. **Baixa parcial** utiliza somente o valor efetivamente liquidado (`amountReceived` / `amountPaid`); o aberto permanece no previsto futuro.
6. **Título realizado** no período **não** permanece também no previsto do mesmo período (precedência: conciliado > baixa oficial > realizado não conciliado > previsão).

Motor existente: `src/lib/treasury/domain/treasuryFinancialIdentityRules.ts`.

---

## 5. Jornada diária (produto) — 12 passos

1. Cadastrar ou vincular contas oficiais vindas do Nomus.  
2. Informar saldo inicial de cada conta no começo do dia.  
3. Apresentar CR previsto e realizado por conta.  
4. Apresentar CP previsto e realizado por conta.  
5. Calcular saldo previsto e saldo realizado.  
6. Informar manualmente o saldo final visto no banco.  
7. Calcular a divergência.  
8. Investigar divergência manualmente ou por OFX.  
9. Fechar o dia.  
10. Usar o saldo final como sugestão de abertura do próximo dia.  
11. Projetar o primeiro dia com risco de saldo negativo.  
12. Indicar excedente/déficit em relação à reserva mínima (`minimumBalance`).

Implementação futura deve **compor** APIs já existentes (`/dashboard`, `/daily-closing/preview`, balances, OFX, reconcile, projections/agenda), sem apagar handlers avançados.

---

## 6. Preservação dos recursos avançados

O fluxo simples é uma **camada de UX** sobre o módulo completo. Permanecem disponíveis (flags/ACL):

- Contas financeiras + ACL por conta  
- Snapshots e posição  
- CR/CP oficiais + overlays (expectativa, promessa, cobrança, contestação, programação CP)  
- Agenda e comparação de cenários  
- Transferências e ledger manual  
- OFX, movimentos bancários e conciliação  
- Exceções, alertas, fechamento versionado  
- Relatórios e auditoria  
- ~92 handlers HTTP e shell `TreasuryModule` com todas as seções

**Proibido** nesta iniciativa: remover models `Treasury*`, rotas avançadas, flags, permissões ou motores de domínio “porque a jornada ficou simples”.

---

## 7. Mapeamento mínimo para a implementação futura

| Passo | Implementação existente (reuso) |
|-------|----------------------------------|
| Contas / vínculo Nomus | `TreasuryFinancialAccount.nomusBankAccountId` |
| Saldo inicial / final | Snapshot MANUAL + `TreasuryDailyClosing` / `AccountPosition` |
| CR/CP previsto×realizado | `GET /api/finance/treasury/dashboard` (+ day-flow) |
| Divergência | Dashboard + closing `differenceAmount` + balance-position |
| OFX / investigação | `…/bank-imports/ofx/preview|apply` + reconcile workspace |
| Fechamento / D+1 | `GET …/daily-closing/preview`, `POST …/daily-closing` |
| Projeção / reserva | Projection engine + agenda + `minimumBalance` |

---

## 9. Persistência da rotina diária (sem model novo)

Decisão de domínio (2026-07-28): **não** criar `TreasuryDailyAccountRoutine` no Prisma.

| Conceito | Representação existente |
|----------|-------------------------|
| Saldo inicial informado | `TreasuryBalanceSnapshot` MANUAL, idempotencyKey `daily-opening:{civilDate}:v{n}` |
| Saldo final bancário informado | `TreasuryBalanceSnapshot` MANUAL, idempotencyKey `daily-closing-bank:{civilDate}:v{n}` |
| Informado por / em | `createdByUserId` / `createdAt` do snapshot (servidor) |
| Origem do saldo inicial | Metadado de domínio (`PREVIOUS_CLOSING` \| `MANUAL` \| `SNAPSHOT`) + notes |
| Previsto / realizado / divergência | Calculados (`treasuryDailyAccountRoutineRules`) |
| CLOSED / REOPENED | `TreasuryDailyClosing` + `TreasuryDailyClosingAccountPosition.observedBalance` |
| Sugestão de abertura D+1 | `observedBalance` do último fechamento CLOSED da conta |
| Auditoria | `TreasuryAuditLog` append-only |
| Concorrência | `expectedVersion` / nova versão de snapshot (sem overwrite silencioso) |

Regras puras: `src/lib/treasury/domain/treasuryDailyAccountRoutineRules.ts`.

---

## 10. Fora de escopo imediato

- Migration / model Prisma dedicado (desnecessário enquanto snapshots + closing cobrirem o estado).  
- Deploy / merge para `main`.  
- Qualquer escrita em Nomus.
