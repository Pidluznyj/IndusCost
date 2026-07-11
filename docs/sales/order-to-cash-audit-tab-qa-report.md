# QA final — OrderToCashAudit + aba Auditoria Pedido → Caixa

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-11 |
| **Escopo** | QA técnico da camada materializada + terceira aba (sem feature nova) |
| **HEAD avaliado** | `8a71cf1` (+ este relatório) |
| **Status geral** | **PARCIAL** |

---

## Status geral

**PARCIAL** — gates de código, testes unitários, build e bundles estão **PRONTOS**; a validação contra PostgreSQL (**preview/apply/validate PD 02339**) **não pôde ser executada neste ambiente** porque não há `.env` / `DATABASE_URL`.

Nenhum bug de implementação foi encontrado nesta rodada; **nenhuma correção de feature** foi necessária.

Próximo passo operacional (máquina com banco):

```bash
npx tsx scripts/rebuildOrderToCashAudit.ts --mode apply --orderCode "PD 02339"
npx tsx tmp-audits/validate-order-to-cash-audit-pd02339.ts
```

---

## Objetivo da entrega

Criar uma **auditoria Pedido → Caixa** derivada, materializada e read-only:

1. Tabelas `OrderToCashAuditRun` / `OrderToCashAuditFact`
2. Builder puro + script de rebuild (preview/apply)
3. API GET read-only na Conciliação de Carteira
4. Terceira aba **Auditoria Pedido → Caixa** (só carrega com Cliente + Ano + Pesquisar)

Regras duras: sem proposta, sem comissão, sem write em módulos oficiais, sem recalcular na API/UI.

---

## Tabelas criadas

| Modelo | Migration | Índices |
|--------|-----------|---------|
| `OrderToCashAuditRun` | `prisma/migrations/20260722120000_order_to_cash_audit/migration.sql` | status, mode, year, startedAt, periodFrom/To, createdAt |
| `OrderToCashAuditFact` | mesma migration | unique `(runId, auditKey)` + índices de pedido, cliente, vendedor, produto, NF, doc, estágios, datas, etc. |
| FK | `OrderToCashAuditFact.runId` → `OrderToCashAuditRun.id` ON DELETE CASCADE | — |

Checklist banco (código/migration):

| # | Item | Resultado |
|---|------|-----------|
| 1 | Migration cria Run | **OK** (SQL + schema) |
| 2 | Migration cria Fact | **OK** |
| 3 | Índices existem | **OK** (dezenas de `CREATE INDEX` no SQL) |
| 4–12 | Apply/facts/PD 02339/valores/CR/pagamento/alertas | **BLOQUEADO** — sem `DATABASE_URL` |

Cobertura unitária do motor (substitui parcialmente DB para regras 8–12):

| Regra | Evidência |
|-------|-----------|
| Valor atribuído ≤ pedido | `orderToCashAuditBuilder.test.ts` #14 |
| Cabeçalho NF não infla pedido | #8, #15 |
| CR separado | #9, #10 |
| Status pagamento | #10, #11 + `classifyPaymentStatus` |
| Alertas | #12–15 + flags `has*` |

---

## Scripts criados

| Script | Função |
|--------|--------|
| `scripts/rebuildOrderToCashAudit.ts` | preview / apply (só grava Run+Fact) |
| `src/lib/sales/orderToCashAuditBuilder.ts` | montagem pura das linhas |
| `src/lib/sales/orderToCashAuditRebuild.ts` | CLI parse + helpers de persistência |
| `tmp-audits/validate-order-to-cash-audit-pd02339.ts` | validação read-only PD 02339 |

Docs: `docs/sales/order-to-cash-audit-schema.md`, `docs/sales/order-to-cash-audit-rebuild.md`.

---

## Endpoints criados

| Método | Path | Notas |
|--------|------|-------|
| `GET` | `/api/finance/portfolio-reconciliation/order-to-cash-audit` | Lista; exige cliente + ano |
| `GET` | `/api/finance/portfolio-reconciliation/order-to-cash-audit/runs` | Runs recentes |
| `GET` | `/api/finance/portfolio-reconciliation/order-to-cash-audit/:factId` | Detalhe de fato |

Implementação: `orderToCashAuditApi.ts` (puro) + `financeOrderToCashAuditApi.server.ts` (Prisma read-only) + rotas em `financePortfolioReconciliationRoutes.ts`.

Checklist API (testes + código):

| # | Item | Resultado |
|---|------|-----------|
| 1 | Sem cliente/ano → 400 amigável | **OK** (`orderToCashAuditApi.test.ts` #1) |
| 2 | Com cliente/ano → payload | **OK** (#2) |
| 3 | Paginação | **OK** (#3) |
| 4 | Ordenação whitelist | **OK** (#4) |
| 5 | sortBy inválido → default | **OK** (#5) |
| 6 | Filtros estágio/alerta | **OK** (#6, #7) |
| 7 | Não expõe Prisma | **OK** (#8 + `financeApiErrorJson`) |
| 8 | Não faz write | **OK** (#9 — só find/count) |

---

## Aba criada

**Terceira aba** em Financeiro → Conciliação de Carteira: **Auditoria Pedido → Caixa**

Arquivos UI:

- `OrderToCashAuditTab.tsx`
- `OrderToCashAuditFilters.tsx`
- `OrderToCashAuditTable.tsx`
- `OrderToCashAuditSummaryCards.tsx`
- `orderToCashAuditClient.ts`
- integração em `FinancePortfolioReconciliationPage.tsx`

Checklist UI (testes estáticos + helpers):

| # | Item | Resultado |
|---|------|-----------|
| 1 | Terceira aba com nome correto | **OK** |
| 2 | Não carrega no mount | **OK** (`applied` só após Pesquisar) |
| 3 | Mensagem inicial cliente/ano | **OK** |
| 4 | Cliente+ano+Pesquisar chama API | **OK** |
| 5 | Colunas principais | **OK** |
| 6–7 | Sort / invert | **OK** (`nextOrderToCashAuditSort`) |
| 8 | Paginação | **OK** |
| 9 | Filtros avançados na query | **OK** |
| 10 | Cards após pesquisa | **OK** (render condicional) |
| 11–13 | Loading / empty / error | **OK** |
| 14–15 | R$ e dd/MM/yyyy | **OK** (`formatFinanceCurrency` / `formatFinanceDate`) |
| 16 | Badges suaves | **OK** (paleta especificada) |
| 17 | Sem JSON cru | **OK** (alerts/flags legíveis) |

---

## Testes rodados (este ambiente)

| Comando | Resultado |
|---------|-----------|
| `npm run check:server-imports` | **OK** |
| `npm run check:frontend-server-imports` | **OK** |
| `npm test` | **OK** (495 + 250 market-intelligence, 0 fail) |
| `npm run build` | **OK** |
| `npm run check:browser-bundle` | **OK** |
| Suite focada O2C (API/UI/builder/rebuild) | **OK** (55/55) |
| `rebuild … --mode preview --orderCode "PD 02339"` | **FALHOU** — `DATABASE_URL` ausente |
| `rebuild … --mode apply --orderCode "PD 02339"` | **NÃO EXECUTADO** (mesmo bloqueio) |
| `tmp-audits/validate-order-to-cash-audit-pd02339.ts` | **FALHOU** — `DATABASE_URL` ausente |
| `rebuild … --customerExternalId 200 --year 2026` | **NÃO EXECUTADO** |

---

## Resultado PD 02339

| Camada | Resultado |
|--------|----------|
| Builder puro (regras de alocação/NF/CR/alertas) | **OK** via testes unitários |
| Preview/apply no banco | **BLOQUEADO** (sem `DATABASE_URL` / sem `.env`) |
| Script `validate-order-to-cash-audit-pd02339.ts` | **BLOQUEADO** (idem) |

Quando o banco estiver disponível, o script de validação cobre: pedido encontrado, vendedor do pedido, valor atribuído ≤ R$ 158.000, NF não inflando pedido, CR/pagamento/estágio/alertas, sem proposta/comissão.

---

## Limitações conhecidas

1. **Ambiente de agente sem PostgreSQL** — QA de banco incompleto.
2. **UI não chama API no mount da aba** — exige pesquisa; dados só após rebuild apply.
3. **Detalhe de linha é painel simples** (MVP) — sem drawer completo.
4. **Cliente via autocomplete** usa `customerId` (UUID IndusCost); `customerExternalId` também é suportado pela API.
5. **Runs antigas não são apagadas** pelo apply (imutável por design).
6. **Coluna Pedido sticky** apenas; demais colunas com scroll horizontal amplo.

---

## Confirmação de não regressão

Arquivos tocados desde o schema O2C (`c5fd24c`…`8a71cf1`) **não incluem**:

| Área | Alteração indevida? |
|------|---------------------|
| Fluxo de Caixa oficial | **Não** |
| Contas a Receber oficial | **Não** |
| Comissões | **Não** |
| Relatório Presidencial | **Não** |
| Precificação | **Não** |
| Engenharia/BOM | **Não** |
| Suprimentos | **Não** |

Escopo restrito a: migration/schema O2C, builder/rebuild, API portfolio-reconciliation O2C, aba Conciliação, docs/tmp-audits, `package.json` (registro de testes).

---

## Próximos passos

1. Em máquina com `.env` válido: aplicar migration (se ainda não) + `apply` PD 02339 + `validate-order-to-cash-audit-pd02339.ts`.
2. Opcional: `apply --customerExternalId 200 --year 2026` e smoke na UI (Cliente + Ano + Pesquisar).
3. Evoluir detalhe da linha (drawer) se o MVP for insuficiente.
4. Considerar job/cron de rebuild (fora deste escopo).

---

## Conclusão

| Critério | Status |
|----------|--------|
| Código + testes + build | **PRONTO** |
| Banco / PD 02339 ao vivo | **PENDENTE (ambiente)** |
| Bugs a corrigir nesta rodada | **Nenhum** |
| **Status final do QA** | **PARCIAL** |
