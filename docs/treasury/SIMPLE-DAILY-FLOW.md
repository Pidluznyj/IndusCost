# Fluxo diário simplificado — Central de Tesouraria

**Status:** entregue na branch `feat/treasury-simple-daily-flow` (pré-merge)  
**Atualizado:** 2026-07-28  

Experiência diária **simples** sobre o módulo avançado já existente. Não substitui agenda, comparação de cenários, CR/CP avançados, OFX técnico, fechamento formal, relatórios nem auditoria — apenas simplifica a navegação padrão e compõe APIs/motores reutilizados.

Documentação técnica correlata: [12-BUSINESS-RULES.md](./12-BUSINESS-RULES.md), [15-PROJECTION-AND-DOUBLE-COUNTING.md](./15-PROJECTION-AND-DOUBLE-COUNTING.md), [16-DAILY-CLOSING.md](./16-DAILY-CLOSING.md), [17-OFX-AND-RECONCILIATION.md](./17-OFX-AND-RECONCILIATION.md), [14-PERMISSIONS-AND-FEATURE-FLAGS.md](./14-PERMISSIONS-AND-FEATURE-FLAGS.md), [ACTIVATION.md](./ACTIVATION.md).

---

## 1. Princípios canônicos

| Princípio | Regra |
|-----------|--------|
| Fonte oficial dos títulos | **Nomus** (`NomusAccountsReceivable` / `NomusAccountsPayable`). A Tesouraria **não** altera títulos oficiais. |
| Vínculo de conta | Conta financeira Nomus → `TreasuryFinancialAccount.nomusBankAccountId`. |
| Saldo inicial | **Manual** (sugerido pelo saldo final fechado do dia anterior, quando houver). |
| Saldo final bancário | **Manual** (valor visto no extrato/app do banco). |
| `dueDate` oficial | **Nunca** alterado pela Tesouraria. |
| Baixa automática Nomus | **Proibida**. |
| Movimentação de dinheiro | A Tesouraria **não** transfere dinheiro real; registra intenção/ledger local. |
| Dinheiro | Decimal / string; fuso `America/Sao_Paulo`. |
| Histórico | Sem exclusão física (cancelar / reverter / versionar). |
| Ativação | Opt-in (`TREASURY_MODULE_ENABLED`); processos externos permanecem desligados. |

---

## 2. Navegação padrão vs avançada

**Abas principais:** Hoje · Contas · Conferir banco · Próximos dias  

**Recursos avançados:** hub `/finance/treasury/advanced` (ADMIN / SUPER_ADMIN) + deep-links preservados (`/agenda`, `/projections`, `/receivables`, `/payables`, `/ofx`, `/reconcile`, `/closing`, `/reports`, `/audit`, …).

---

## 3. Jornada diária entregue

| Passo | UI / API |
|-------|----------|
| Vincular conta Nomus | Contas (`/accounts`) |
| Abrir o dia / saldo inicial | `/today/opening` → `GET/POST …/today/opening` |
| CR previsto / realizado | `/today/receivables` (lista paginada simples) |
| CP previsto / realizado | `/today/payables` |
| Saldos previsto / realizado / divergência | `/today` (payload agregado) + `/today/closing` |
| Informar saldo final | `/today/closing` |
| Investigar divergência / OFX | `/bank` (assistente simples; reusa preview/apply/match/ledger) |
| Fechar o dia | Fechamento formal existente + atalho guiado |
| Sugestão D+1 | `suggestTreasuryDailyOpeningBalance` a partir do `observedBalance` fechado |
| Projeção | `/projection` (Contratual / Provável; reusa `GET /agenda`) |

---

## 4. Fórmulas canônicas

### Saldo final previsto

```text
saldo inicial
+ CR previsto − CP previsto
± transferências previstas
+ lançamentos manuais previstos
= saldo final previsto
```

### Saldo final realizado calculado

```text
saldo inicial
+ CR baixado no Nomus − CP baixado no Nomus
± entradas/saídas locais realizadas
± transferências realizadas
= saldo final realizado calculado
```

### Divergência

```text
saldo final bancário informado − saldo final realizado calculado = divergência
```

Implementação: `treasuryDailyAccountRoutineRules.ts`, `treasuryDailyCashEngine.ts`.

---

## 5. Anti-duplicidade

1. OFX conciliado com título **não soma novamente**.  
2. OFX conciliado com ledger **não soma novamente**.  
3. OFX sem correspondência **não** altera saldo até ação explícita (manual/tarifa/juros).  
4. Transferência interna é **neutra no consolidado**.  
5. Baixa parcial usa só o liquidado; aberto segue no previsto futuro.  
6. Precedência: conciliado > baixa oficial > previsão (`treasuryFinancialIdentityRules`).

Fingerprint OFX / apply idempotente: `fileSha256` + fingerprint por conta.

---

## 5.1. Preservação dos recursos avançados

A UX simples **não remove** agenda, comparação de cenários, CR/CP avançados, programação, transferências, lançamentos manuais, movimentos bancários, importação OFX técnica, conciliação avançada, exceções, alertas, fechamento formal (`/closing`), relatórios nem auditoria. Eles permanecem em rotas/deep-links e no hub **Recursos avançados** (ADMIN / SUPER_ADMIN).

---

## 6. Persistência (sem model Prisma novo)

| Conceito | Representação |
|----------|----------------|
| Saldo inicial | `TreasuryBalanceSnapshot` MANUAL (`daily-opening:…`) |
| Saldo final bancário | `TreasuryBalanceSnapshot` MANUAL (`daily-closing-bank:…`) |
| Fechamento / reabertura | `TreasuryDailyClosing` versionado |
| Projeção | Runs/agenda existentes |
| Auditoria | `TreasuryAuditLog` append-only |

---

## 7. Superfície HTTP da UX simples (aditiva)

| Método | Path |
|--------|------|
| GET | `/api/finance/treasury/today` |
| GET/POST | `/api/finance/treasury/today/opening` |
| GET/POST | `/api/finance/treasury/today/closing` |

Handlers avançados existentes permanecem (congelados em testes de regressão ≈ 94 registros `app.*` em `treasuryRoutes.ts`).

---

## 8. Testes de preservação / validação

| Suite | Papel |
|-------|--------|
| `treasurySimpleDailyFlow.characterization.test.ts` | Congela módulo avançado antes/durante simplificação |
| `treasuryAdvancedCapabilitiesRegression.test.ts` | Rotas, APIs, models, flags, permissões, shell |
| `treasurySimpleDailyOperation.e2e.test.ts` | Jornada 18 passos + casos de negócio + UX/perf |
| `npm run test:treasury` | Runner em lotes (`scripts/runTreasuryTests.mjs`) |

---

## 9. Fora de escopo desta branch

- Merge em `main` / deploy / migrate em produção.  
- Qualquer escrita em Nomus.  
- Model Prisma `TreasuryDailyAccountRoutine`.  
- Segundo motor de projeção ou de fluxo de caixa.
