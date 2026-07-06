# Reconciliação Comissão Junho/2026 — IndusCost x Nomus

Documento de auditoria para comparar o fechamento de comissão de **Gislene Lima** entre o relatório manual Nomus e o IndusCost.

## Contexto

| Item | Valor |
|------|-------|
| **Vendedor** | Gislene Lima |
| **Período Nomus** | 01/06/2026 a 30/06/2026 |
| **Critério IndusCost** | Títulos **baixados** no mês (`NomusAccountsReceivable.settlementDate`) |
| **Base Nomus (referência manual)** | R$ 808.107,32 |
| **Comissão Nomus (referência manual)** | R$ 20.926,56 |
| **% médio Nomus (calculado)** | 2,5895% |

> O relatório Nomus considera **contas a receber quitadas no período**, não apenas NF emitida em junho. Por isso a comparação correta no IndusCost usa `settlementDate`, não `confirmedAt` nem `dueDate`.

## Como reproduzir

```bash
npx tsx scripts/reconcile-commission-nomus-june-2026.ts \
  --seller="GISLENE LIMA" \
  --year=2026 \
  --month=6 \
  --nomus-base=808107.32 \
  --nomus-commission=20926.56
```

Export JSON ou CSV:

```bash
# JSON completo
npx tsx scripts/reconcile-commission-nomus-june-2026.ts ... --json

# CSV detalhado (stdout)
npx tsx scripts/reconcile-commission-nomus-june-2026.ts ... --csv
```

O script grava automaticamente `tmp/commissions-june-2026/reconciliation-detail.csv` ao rodar em modo texto.

## Valores IndusCost (preencher após execução local)

Execute o script com banco conectado e atualize esta seção com o resultado.

| Origem | Base | Comissão | % médio |
|--------|------|----------|---------|
| Nomus (referência manual) | R$ 808.107,32 | R$ 20.926,56 | 2,5895% |
| IndusCost (liberada/a pagar) | _executar script_ | _executar script_ | _executar script_ |
| **Diferença** | _executar script_ | _executar script_ | — |

**Comissão a pagar em Junho/2026 para Gislene Lima (IndusCost):** _executar script_

## O que o script calcula

1. **Base IndusCost** — soma da base comissionável rateada por parcela/schedule (sem duplicar CR).
2. **Comissão IndusCost** — comissão **liberada** em títulos baixados no mês (`commissionReleasedAmount`).
3. **% médio IndusCost** — comissão liberada ÷ base rateada.
4. **Diferenças** — IndusCost − referência Nomus (informada via CLI, não hardcoded no serviço).
5. **Faixas de percentual** — distribuição por `itemRatePercent` (tabela comercial interpolada).
6. **Top divergências** — agrupamentos por cliente, NF, CR e produto.
7. **Títulos suspeitos** — CR com alertas (base ≠ recebido, liberação parcial, etc.).

## Causas prováveis de divergência

Quando IndusCost e Nomus não batem, as causas mais comuns são:

1. **Percentual aplicado** — IndusCost usa faixas comerciais interpoladas por produto/preço; Nomus pode ter usado percentual fixo ou tabela antiga.
2. **Base comissionável** — diferença no recorte de títulos baixados (baixa parcial, CR sem vínculo, timing de sync).
3. **Títulos fora do recorte** — NF emitida em outro mês mas baixada em junho entra no IndusCost; título baixado fora de junho não entra.
4. **Regra manual antiga** — apuração Nomus histórica pode não refletir o motor atual do IndusCost.

## Checklist YAGNI

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Precisa existir? | Sim — auditoria pontual jun/2026 sem alterar produção |
| 2 | Já existe monthly payable? | Sim — script reutiliza `getCommissionMonthlyPayableSummary` |
| 3 | Filtro por vendedor? | Sim — `--seller` + resolução por nome |
| 4 | Comparar sem hardcode? | Sim — referência Nomus só via CLI/documento |
| 5 | Dados Nomus no banco? | AR via sync; referência manual é parâmetro |
| 6 | Base em CR/parcela? | Sim — schedule + dedup por CR |
| 7 | Duplica item/título? | Não — mesma dedup do monthly payable |
| 8 | Divergência é regra ou dado? | Script separa faixas % vs alertas de dado |
| 9 | Altera cálculo? | Não — somente leitura |
| 10 | Build/testes | Rodar `npm run test:commissions` |

## Arquivos relacionados

- `scripts/reconcile-commission-nomus-june-2026.ts` — CLI de auditoria
- `src/lib/commissions/commissionNomusReconciliation.ts` — lógica pura
- `scripts/audit-commission-monthly-payable.ts` — auditoria mensal genérica
- `src/lib/commissions/commissionMonthlyPayable.ts` — agregação por settlementDate

---

_Atualize os valores IndusCost após rodar o script com `DATABASE_URL` configurada._
