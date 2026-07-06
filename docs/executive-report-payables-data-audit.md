# Auditoria — Contas a Pagar no Relatório Executivo

Data da auditoria: 2026-06-24  
Escopo: paridade entre **Financeiro → Contas a Pagar** e **Relatório Presidencial / Executivo → Contas a Pagar**.

---

## 1. Qual endpoint/helper alimenta a tela Financeiro → Contas a Pagar?

- **API:** `GET /api/finance/accounts-payable/dashboard`
- **Motor:** `buildFinanceAccountsPayableDashboard` em `src/lib/financeAccountsPayableDashboard.ts`
- **Carga Prisma:** `buildFinanceApPrismaWhere` + `FINANCE_AP_TITLE_SELECT`
- **UI:** `FinanceAccountsPayablePage.tsx` — cards em “Resumo executivo”

## 2. Qual endpoint/helper alimenta o Relatório Executivo → Contas a Pagar?

- **API:** `GET /api/finance/executive-report` (ou geração PDF equivalente)
- **Orquestração:** `buildFinanceExecutiveReport` em `src/lib/financeExecutiveReport.ts`
- **KPIs de seção:** `buildExecutiveReportPayablesSection` em `src/lib/financeExecutiveReportDataSources.ts`
- **Apresentação:** `ExecutiveReportDocument.tsx`

O relatório **não recalcula** AP — delega ao mesmo motor via `buildOfficialAccountsPayableDashboardForReport`.

## 3. Quais filtros a tela oficial usa?

Padrão (`createDefaultFinanceApUiFilters`):

| Filtro | Valor padrão |
|--------|--------------|
| `status` | `all` |
| `year` | ano corrente |
| `month` | **vazio** (sem filtro de mês) |
| `companyName`, `personName`, etc. | vazios |
| `managementScope` | escopo gerencial padrão |

A tela filtra títulos por **vencimento no ano inteiro**, não no mês corrente.

## 4. Quais filtros o relatório usava (antes da correção)?

`buildExecutiveReportApFilters` propagava `filters.month` do relatório presidencial:

```typescript
month: filters.month ?? undefined  // ex.: 6 para jun/2026
```

Isso restringia a carteira AP ao **mês de vencimento selecionado no relatório**.

## 5. Qual data-base é usada na tela oficial?

- `referenceDate` = fim do dia local de “hoje” (ou data escolhida na UI, se houver)
- Cards de horizonte (“Vence hoje”, “Próx. 7/30 dias”) usam **data operacional** vs `referenceDate`
- `paidThisMonthAmount` usa o **mês calendário de `referenceDate`**

## 6. Qual data-base é usada no relatório?

- `asOfDate` obrigatório (ex.: `2026-06-26`)
- `resolveExecutiveReportReferenceDate` → fim do dia local dessa data
- Mesma regra de data operacional e pagamento do motor oficial

## 7. Qual ano/mês é usado na tela oficial?

- **Ano:** ano corrente (filtro de vencimento)
- **Mês:** não aplicado por padrão

## 8. Qual ano/mês é usado no relatório?

- **Ano:** parâmetro `year` do relatório (ex.: 2026)
- **Mês:** parâmetro `month` do relatório — usado para **destaque narrativo**, comparativos (pago mês/YTD) e outras seções (faturamento, fluxo)
- **Correção:** cards de **carteira AP** passam a usar `buildExecutiveReportApPortfolioFilters` — **ano sem mês**, igual à tela oficial

## 9. O card “Em aberto” da tela oficial representa o quê?

- Soma de `balancePayable` de títulos **em aberto** no universo filtrado (ano inteiro por padrão)
- Status: open, overdue, dueToday, upcoming (não cancelados, não excluídos por saneamento)
- **Não** limitado ao mês de vencimento quando mês está vazio

## 10. O card “Em aberto” do relatório representava o quê (antes)?

- Mesmo campo (`cards.totalOpenAmount`) do motor oficial, **mas** com filtro `month=6`
- Resultado: apenas títulos com vencimento em junho/2026 → ~R$ 491 mil

## 11. Por que a tela oficial mostra R$ 5,49 Mi e o relatório mostrava R$ 491,1 mil?

**Causa raiz:** escopo de filtro diferente.

| Origem | Filtro de vencimento | Em aberto |
|--------|---------------------|-----------|
| Tela oficial | Ano 2026, **sem mês** | ~R$ 5,49 Mi |
| Relatório (antes) | Ano 2026, **mês 6** | ~R$ 491,1 mil |

O motor era o mesmo; o **filtro de período** do relatório restringia demais a carteira.

## 12. O relatório estava usando apenas o mês selecionado em “Em aberto”?

**Sim.** `month: filters.month` em `buildExecutiveReportApFilters` limitava `resolveFinanceApDueDateBounds` ao mês.

## 13. O relatório estava usando apenas próximos 60 dias?

**Não** para “Em aberto”. O horizonte de 60 dias é usado em `financialHorizon` (seção separada), não no card “Em aberto”.

## 14. O relatório estava filtrando por vencimento sem deixar claro?

**Sim.** O label “Em aberto” sugeria carteira total, mas o valor era **em aberto com vencimento no mês do relatório**.

## 15. O relatório estava excluindo títulos que a tela oficial inclui?

**Sim.** Títulos em aberto com vencimento fora de jun/2026 eram excluídos pelo filtro Prisma `dueDate` + `filterFinanceApRows`.

## 16. O relatório estava usando pago/aberto de forma misturada?

Parcialmente. “Pago mês” batia porque usa **data de pagamento** no mês calendário de `referenceDate`. “Em aberto” usa **saldo em aberto** no universo filtrado por vencimento — escopos diferentes quando mês estava aplicado.

## 17. O relatório estava usando status diferente?

**Não.** Mesmo motor, mesmas regras de status e saneamento.

## 18. O relatório estava usando valor original, saldo ou valor pago diferente?

**Não.** Mesmos campos: `balancePayable` (aberto), `amountPaid`/`resolveFinanceApRealizedAmount` (pago).

## 19. O relatório estava usando data de pagamento quando deveria usar vencimento?

**Não** para “Em aberto”. O problema era filtro de **vencimento por mês**, não confusão pagamento/vencimento.

## 20. O relatório estava usando vencimento quando deveria usar pagamento?

**Não** para “Pago no mês”. Pagamento usa data efetiva de pagamento corretamente.

## 21. Há diferença entre os cards oficiais?

| Card | Significado |
|------|-------------|
| **Total a pagar** | Σ valores no universo filtrado (abertos + liquidados no escopo) |
| **Em aberto** | Σ saldo em aberto |
| **Vencido gerencial** | Saldo em aberto com data operacional &lt; hoje |
| **Vence hoje** | Data operacional = hoje |
| **Próx. 7 dias** | Janela operacional D+1 … D+7 |
| **Próx. 30 dias** | Janela operacional D+1 … D+30 |
| **Agendados** | Títulos remarcados (`purchaseOrderScheduleAudit.rescheduledOpenAmount`) |
| **Pago no mês** | Pagamentos efetivados no mês calendário de `referenceDate` |

---

## Correção aplicada

1. **`buildExecutiveReportApPortfolioFilters`** — filtros de carteira (ano, sem mês), espelhando `createDefaultFinanceApUiFilters`.
2. **`buildFinanceExecutiveReport`** — carga AP/AR e cards usam filtros de carteira; comparativos (pago mês/YTD) mantêm bounds do mês destacado.
3. **KPIs estendidos** — `totalPayableAmount`, `paidThisMonthAmount`, horizonte e `scheduledOpenAmount`.
4. **UI** — duas linhas de carteira + linha comparativa; labels alinhados à tela oficial.
5. **Resumo executivo** — `AP aberto` = `apPayload.cards.totalOpenAmount` (carteira oficial).

### Contas a Receber

Mesmo padrão identificado: `buildExecutiveReportArPortfolioFilters` aplicado. AR aberto no resumo e na seção AR usam carteira ano-inteira, igual à tela oficial.

---

## Verificação

```bash
npx tsx scripts/audit-executive-report-payables-source.ts --year=2026 --month=6 --asOfDate=2026-06-26
npm test -- src/lib/financeExecutiveReportDataSources.test.ts
```

Critério: diferença ≤ R$ 0,01 em todos os cards de carteira.
