# Regras de comissão — fontes e status (IndusCost)

> **Documento canônico do módulo.** As seções numeradas 1–15 são regras
> oficiais decididas pelo negócio. Não são hipóteses e não devem ser
> reabertas a cada tarefa. Divergências conhecidas entre estas regras e o
> código atual estão na seção final "Divergências do código".

## Fonte oficial por superfície

| Superfície | Fonte |
|------------|--------|
| Auditoria 360º — aba Comissões | `CommissionOrderSnapshot` / `CommissionOrderItemSnapshot` (read-only) |
| Comercial > Comissões (listagem / fechamento) | Schedule materializado + snapshot ligado; baixas via `CommissionReceiptLedgerLine` |
| Pagamento | Somente ledger fechado RECEIPT_BASED (`COMMISSIONABLE` liberado) |

Não criar cálculo paralelo de margem na UI.

## Quando `NO_MARGIN` é válido

Somente se **não** houver comissão prevista no snapshot oficial e os itens ACTIVE tiverem falta real de tabela/margem (`NO_COMMERCIAL_PRICE_TABLE`, `INVALID_COMMERCIAL_PRICE_RANGE`), sem schedule/CR com prevista.

**Relatórios (Comercial > Comissões):** se o ledger CLOSED/prévia estiver stale com `NO_MARGIN`/`ZERO_AMOUNT` mas existir `CommissionOrderSnapshot` ACTIVE com comissão > 0 (ex.: PD 02523), a listagem **reexibe** o valor oficial via `enrichReportLinesWithOfficialSnapshots` / `COMMISSION_SOURCE_MISMATCH` — sem alterar pagamento nem reescrever o ledger.

## Quando usar `COMMISSION_SOURCE_MISMATCH`

- Schedule ACTIVE com `scheduledCommissionAmount = 0`
- e `CommissionOrderSnapshot.totalFinalCommissionAmount > 0` (ou item com final > 0)

Alerta: `COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT`.

A listagem **mostra** a prevista do snapshot; **não libera** pagamento até materializar de novo.

## Comissão paga

Não alterar automaticamente. Ajustes em valores já pagos = apenas sinalização operacional.

## Vendedor

Usar vendedor canônico (`CommissionPerson` + alias), alinhado entre telas.

**Auditoria 360º / CRM:** o mesmo canônico alimentar `resolveOrderSellerIdentity`
(`src/lib/commercial/orderSellerIdentityResolver.ts`). Vendedor comissionável =
Vendedor do Pedido resolvido. ID Nomus só em campo técnico — nunca como label.

Ver também: [commission-main-vs-order-audit-source-map.md](./commission-main-vs-order-audit-source-map.md)
e [crm-order-seller-canonical-grouping.md](../commercial/crm-order-seller-canonical-grouping.md).

---

# Regras oficiais do módulo

## 1. Data oficial da regra de comissão

A comissão usa a regra e a tabela comercial **vigentes na data comercial da
venda**. A referência principal é a `issueDate` oficial do pedido/venda, ou a
data comercial equivalente quando o domínio declarar outra fonte.

| Data | Decide |
|------|--------|
| Venda | regra, tabela, margem, faixa e percentual |
| Recebimento | liberação proporcional, competência financeira e pagamento |

A data de recebimento **não** escolhe tabela, faixa nem percentual.

Não recalcular venda antiga usando simplesmente a tabela publicada hoje.

## 2. Tabela comercial histórica

Reconstrução de cálculo histórico busca a versão aplicável na data da venda:

```
effectiveFrom <= data comercial  AND  effectiveTo > data comercial
```

A resolução ponto-no-tempo pode precisar considerar versões hoje `ARCHIVED`
que eram válidas na data da venda. Filtrar só por `status = PUBLISHED` para
venda passada é **incompatível** com a regra oficial.

Versão arquivada não vale só por existir: precisa de vigência histórica válida
e não ambígua. São inconsistências que exigem diagnóstico e auditoria:

- `effectiveTo` igual a `effectiveFrom`;
- `effectiveTo` anterior a `effectiveFrom`;
- duas versões vigentes na mesma data;
- produto duplicado na mesma versão.

Não reparar vigências automaticamente sem preview e evidência da origem.

## 3. Snapshot é o congelamento oficial

O cálculo é congelado em snapshot, preservando: vendedor, produto, regra,
tabela e versão, preço de referência, custo, margem, faixa, percentual, base,
valor e motivos de exclusão/impossibilidade.

Depois de materializado corretamente, relatório **não recalcula silenciosamente**
com cadastro atual.

**Precedência:**

1. ledger oficial fechado — para o que foi efetivamente fechado;
2. schedule efetivo — para liberação prevista;
3. snapshot oficial ACTIVE — cálculo congelado do pedido;
4. cálculo dinâmico — só preview, diagnóstico ou reconstrução controlada.

Não misturar percentual de uma fonte com valor de outra.

Percentual desconhecido é `null` e exibe `—`. Nunca virar 0% artificial.

## 4. Estados financeiros não são sinônimos

| Estado | Significado |
|--------|-------------|
| `CALCULATED` | comissão calculada no pedido |
| `SNAPSHOTTED` | cálculo congelado no snapshot |
| `CLOSED_ZERO_UNRELEASED` | fechamento existe, valor zero, nada liberado, nada em lote, nada pago |
| `CLOSED_WITH_VALUE` | fechamento histórico com valor positivo |
| `RELEASED_UNPAID` | liberada, ainda não paga |
| `IN_PAYMENT_BATCH` | incluída em lote de pagamento |
| `PAID` | pagamento concluído |

A existência de `closingId`, isoladamente, **não prova pagamento**.
"Já paga/fechada" é tecnicamente insuficiente e pode ser falso.

## 5. Imutabilidade do ledger fechado

Reprocessamento não pode apagar ledger fechado, substituir valor histórico,
alterar comissão paga, reabrir fechamento automaticamente nem transformar
divergência atual em alteração retroativa sem auditoria.

Divergindo do fechado, preservar **ambos**: valor histórico, valor recalculado,
diferença, causa e ação de reconciliação — classificado como
`COMMISSION_SOURCE_MISMATCH`. Isso **não** autoriza liberação nem pagamento
automático.

## 6. Reprocessamento por estado

| Estado | Comportamento |
|--------|---------------|
| `CLOSED_ZERO_UNRELEASED` | recalcula para diagnóstico; snapshot e schedules podem ser reconstruídos com segurança; ledger intacto; diferença positiva vai para reconciliação; nada liberado automaticamente |
| `CLOSED_WITH_VALUE` | recalcula para diagnóstico; preserva ledger; não substitui valor fechado; apresenta divergência |
| `RELEASED_UNPAID` | preserva o liberado; diferença exige reconciliação explícita |
| `IN_PAYMENT_BATCH` | proteção forte; não modificar automaticamente |
| `PAID` | imutável; só ajuste compensatório auditável e autorizado |

Corrigir a distinção de estados **não** significa "desbloquear todos os
fechamentos".

## 7. Vendedor e exclusões históricas

Regras já vigentes, a preservar ao corrigir outros defeitos:

- vendedor comissionável é o vendedor oficial do pedido de venda;
- responsável comercial não substitui o vendedor comissionável;
- pedidos anteriores a 02/2026 podem seguir a atribuição histórica à Gislene;
- pedido sem vendedor resolvido fica `NO_SELLER`;
- Britânia e Esmaltec não são comissionáveis;
- exclusão de cliente é aplicada **antes** da faixa comercial;
- recebimento libera comissão proporcionalmente.

## 8. Schedule efetivo

Schedule `ACTIVE` ligado a snapshot `SUPERSEDED` **não** é fonte efetiva.

Regra mínima: só schedules vinculados ao snapshot oficial `ACTIVE` são
efetivos.

Isso **não** decide que existe apenas um schedule `ACTIVE` por `receivableId`
no banco inteiro. O grão de unicidade ainda precisa ser confirmado
considerando pedido, vendedor, título, parcela, divisão de comissão e origem.

Não criar índice ou trigger global antes de provar o grão oficial.

## 9. Rastreabilidade do reprocessamento

Por pedido analisado deve ser possível responder: entrou no escopo? foi
recalculado? qual era o snapshot anterior? qual o cálculo proposto? houve
mudança? ficou unchanged? foi bloqueado? por qual estado de proteção? houve
erro? foi efetivamente materializado?

Decisões mínimas: `RECALCULATE`, `UNCHANGED`, `BLOCKED`, `PROTECTED`,
`SKIPPED`, `ERROR`.

Resumo agregado do run **não** é suficiente.

## 10. Caso PD 02747 — regressão, não regra especial

Confirmado: `issueDate` 10/07/2026; líquido R$ 1.107,80; snapshot ACTIVE de
13/07/2026; dois itens `NO_COMMERCIAL_PRICE_TABLE`; ledger de julho
`ZERO_AMOUNT`; nada liberado; nada pago; mesmos produtos comissionáveis em
materializações posteriores.

Determinar objetivamente: qual versão histórica era aplicável em 10/07/2026;
se os produtos estavam nela; se os preços eram válidos; se o snapshot estava
correto à época; se houve publicação retroativa; se o pedido deixou de ser
rematerializado por ser tratado como pago; qual o cálculo atual; qual a
divergência frente ao fechamento.

Não forçar comissão positiva só porque pedidos posteriores comissionaram.
Não manter zero só porque existe `closingId`.

## 11. Arredondamento monetário

Substituição global de `decimalToNumber` ou das funções de arredondamento
**não está autorizada**.

Antes de unificar: definir função oficial, definir a etapa de arredondamento,
testar valores de fronteira, comparar implementação atual e proposta, gerar
preview das diferenças e medir impacto sobre snapshots, schedules e ledger.

Não alterar valores históricos fechados por mudança de arredondamento.

## 12. Forecast vencido

A classificação temporal usa **uma única** data de referência (`asOfDate`),
aplicada igualmente em: classificação da linha, bucket, agregação, cards e
testes.

Não classificar o bucket com uma referência e reclassificar depois com o
relógio real do servidor.

Não está comprovado que o card de produção esteja exatamente R$ 10 inflado.
Está comprovado que o cálculo precisa ser determinístico no tempo.

## 13. Materialização e schedule

Requisito oficial: **um snapshot novo não é plenamente efetivo enquanto os
schedules derivados não estiverem consistentes.**

Não está decidido que a única solução é transação única. Comparar: transação
única, estado intermediário explícito, orquestrador idempotente, compensação e
reconciliação automática. Escolher só após mapear fluxo e limites
transacionais.

## 14. Proveniência do ledger

A proveniência **existe** hoje: quando há schedule, `ruleSnapshotJson` grava
`commissionReceivableScheduleId`, `ratePercent`, `source`, `exclusionRuleId` e
`capturedAt` (`commissionReceiptClosing.ts`). O `ledgerLineKey` também compõe
com o id do schedule.

O problema é que essa proveniência **não é fortemente estruturada nem fácil de
consultar** — está em JSON, não em coluna.

Melhorias possíveis: `snapshotId`, `scheduleId`, versão da tabela, regra, hash
do cálculo e código da causa.

Não criar FK rígida sem avaliar a necessidade de o ledger fechado permanecer
legível depois que schedules forem superseded.

## 15. Itens ainda não decididos

Não tratar como decidido:

- índice ou trigger exato para unicidade cross-snapshot;
- grão definitivo de unicidade do schedule;
- transação única obrigatória para materialização + scheduler;
- substituição global de `Number` por `Decimal`;
- função monetária definitiva;
- reparo automático das vigências históricas corrompidas;
- forma contábil/fiscal do ajuste compensatório após pagamento.

Exigem proposta técnica, impacto e aprovação.

---

# Divergências do código (levantadas em 04/08/2026)

Nenhuma corrigida nesta etapa. Referência para o trabalho subsequente.

| # | Regra | Divergência | Evidência |
|---|-------|-------------|-----------|
| D1 | 4, 6 | `classifyCommissionReprocessLifecycle` colapsa `inClosedLedger \|\| paidRecord` em `"paid"`. A carga do ledger filtra só `closingId != null` — não lê `releasedCommissionAmount`, `status` nem `commissionPaymentScheduleId`. Mensagem afirma "já paga/fechada", falso para `CLOSED_ZERO_UNRELEASED` | `commissionReprocess.ts:172`, `commissionReprocess.server.ts:311`, `commissionReprocess.ts:211` |
| D2 | 1, 2 | Resolução da faixa consulta **apenas** `status: "PUBLISHED"`. Não há leitura ponto-no-tempo de versões `ARCHIVED` — venda passada é avaliada contra a tabela publicada hoje | `commission-commercial-tier.server.ts:55` |
| D3 | 2 | Vigências históricas corrompidas em produção: versões com `effectiveTo = effectiveFrom` (janela de largura zero) e 8 com `effectiveTo` anterior a `effectiveFrom`. Contra o filtro `effectiveTo > referenceDate` não casam nunca | consulta de produção, `PriceTableVersion` |
| D4 | 9 | Reprocessamento persiste só resumo agregado do run. Não há decisão consultável por pedido — PD 02747 não aparece em `CommissionCalculationRun` | ausência de persistência por linha em `commissionReprocess.server.ts` |
| D5 | 13 | Materializador e scheduler abrem `$transaction` independentes; entre eles há janela com snapshot ACTIVE e schedules ainda inconsistentes | `commissionOrderMaterializer.server.ts:191`, `commissionReceivableScheduler.server.ts:162` |
| D6 | 8 | Índice único parcial é `(orderSnapshotId, receivableId) WHERE status='ACTIVE'` — escopado por snapshot, permite N ACTIVE para o mesmo título entre snapshots. Foi como 638 órfãos existiram sem violar constraint | migration `20260710120000_commission_receivable_schedule` |
| D7 | 11 | Três arredondamentos coexistem com desempate diferente: `roundMoney` (`Math.round(v*100)/100`), `roundCommissionMoney` (`+ Number.EPSILON`) e `normalizeCommissionLedgerMoney`. 236 usos de `decimalToNumber` levam `Decimal(20,2)` para float | `commission-money.shared.ts:4`, `commissionReprocess.ts:115` |
| D8 | 12 | Agregação do forecast re-deriva vencimento com `m.dueMonthKey < curKey` em vez de confiar no `bucket`, misturando referência declarada e relógio do servidor. `commissionE2eValidation` falha por isso (`overdueCommissionTotal` 18 ≠ 8) | `commissionReceivableForecast.ts:253,263` |
| D9 | 8 | **Já corrigido** — regra de vigência aplicada em motor, orquestrador e rastreio, com guarda de última milha em `mapMaterializedScheduleToLedgerStatus` | `commissionScheduleVigency.ts`, commits `6927f3d` e `f0473d4` |
| D10 | 7 | **Já corrigido** — exclusão de cliente avaliada antes da faixa comercial | `commissionOrderCalculation.ts:284` |

## Correção de registro anterior

Diagnóstico anterior afirmou que o ledger "não guarda de qual schedule veio".
**Incorreto.** A proveniência existe em `ruleSnapshotJson` e no `ledgerLineKey`
(regra 14). O que falta é estrutura consultável, não o dado.
