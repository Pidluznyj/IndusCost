# Funil Pedido → Caixa — Validação no banco

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Script** | `tmp-audits/validate-sales-order-to-cash-funnel.ts` |
| **Tipo** | Auditoria read-only (sem write / migration / UI) |
| **Data** | 2026-07-11 |

> Relacionados:  
> [`sales-order-to-cash-funnel-requirements.md`](./sales-order-to-cash-funnel-requirements.md) ·  
> [`current-sales-funnel-inventory.md`](./current-sales-funnel-inventory.md)

---

## 1. Como rodar

Pré-requisitos:

- `.env` com `DATABASE_URL` apontando para o banco (mesmo padrão dos syncs).
- Run **SUCCESS** da Conciliação de Carteira (fatos materializados), preferencialmente a mais recente.

Comandos:

```bash
npx tsx tmp-audits/validate-sales-order-to-cash-funnel.ts

npx tsx tmp-audits/validate-sales-order-to-cash-funnel.ts --customer "BRITANIA" --verbose

npx tsx tmp-audits/validate-sales-order-to-cash-funnel.ts \
  --seller "Ana" \
  --from 2026-01-01 \
  --to 2026-12-31 \
  --dateAxis ORDER_ISSUE_DATE \
  --limit 200
```

Argumentos:

| Flag | Função |
|------|--------|
| `--customer` | Filtro por nome de cliente (contains) |
| `--seller` | Filtro por nome de vendedor |
| `--from` / `--to` | Intervalo `AAAA-MM-DD` |
| `--dateAxis` | Eixo da data (obrigatório se usar from/to) |
| `--limit` | Tamanho da página (default 200, máx. 500) |
| `--verbose` | Detalha cada check e amostra de rows |

`dateAxis` aceitos: `ORDER_ISSUE_DATE`, `EXPECTED_DELIVERY_DATE`, `STOCK_DOCUMENT_DATE`, `NFE_DATE`, `RECEIVABLE_DUE_DATE`, `RECEIVABLE_SETTLEMENT_DATE`, `FORECAST_DATE`, `UPDATED_AT`.

O script chama o mesmo loader da API (`loadOrderToCashFunnelList`) — **somente leitura**.

---

## 2. O que valida

| Check | Significado |
|-------|-------------|
| `stagePrincipalUnico` | Cada `salesOrderId` aparece uma vez na página |
| `semDuplicidadePedidoNfCr` | Soma dos estágios exclusivos = `totals.activeStageValueSum` (não Pedido+NF+CR) |
| `alertasNaoSomamCarteira` | `riskSummary.note` deixa claro que alertas são referência |
| `propostaNaoUsadaComoFonteOficial` | Código/API sem import de Proposal; payload sem `proposalId` |
| `comissaoNaoUsada` | Sem imports/campos de comissão |
| `pedidoAntigoSemEvidenciaBloqueado` | Pedidos ≥90 dias sem evidência Doc/NF/CR → `BLOQUEADO_REVISAO` / `SEM_EVIDENCIA` |
| `crAbertoClassificado` | `FIN_CR_ABERTO` → estágio `CR_ABERTO` |
| `recebidoClassificado` | `FIN_RECEBIDO` → estágio `RECEBIDO` |
| `documentoSemCrClassificado` | Fiscal sem CR coerente com `NF_SEM_CR` / `DOCUMENTO_SEM_NF` (exceto atendimento operacional) |
| `payloadComExplicacoes` | Todos os `summaryCards` têm `explanation` |
| `semJsonCru` | Payload sem `nomusRawResponse` / Prisma / stack |
| `topRiscos` | Se há valor bloqueado, `topRisks` inclui bloqueados |

Também imprime: estágios, temperaturas e top riscos (até 10).

---

## 3. Como interpretar

```text
=== Funil Pedido → Caixa — Validação ===
Período: ...
Pedidos analisados: N
Estágios: ...
Temperaturas: ...
Top riscos: ...
Validações PASS/FAIL:
- stagePrincipalUnico: PASS
...
PASS/FAIL: PASS|FAIL
```

| Resultado | Ação |
|-----------|------|
| **PASS** | Conjunto filtrado coerente com o paradigma Pedido → Caixa |
| **FAIL** | Investigar checks falhos; ver `--verbose` e detalhe do pedido |
| Mensagem de “sem dados / sem run” | Rebuild da Conciliação ou sync AR/NF antes de revalidar |
| Check “Sem candidatos no conjunto” | Não é falha — o filtro não trouxe amostra daquele caso |

Exit code `1` se `PASS/FAIL: FAIL` ou se a carga do banco falhar.

**Nota:** no ambiente local sem Postgres (`localhost:5432` inacessível), o script termina em **FAIL** com `cargaBanco` — isso é esperado. A validação completa deve rodar **no servidor** com `DATABASE_URL` e run SUCCESS.

---

## 4. Exemplos de falha

| Sintoma | Causa provável | Próximo passo |
|---------|----------------|---------------|
| `stagePrincipalUnico` FAIL | Bug de agregação / join duplicando pedido | Revisar `groupFactsByOrder` / paginação |
| `semDuplicidadePedidoNfCr` FAIL | Analytics somando eixos misturados | Conferir `valueForStage` vs cards de risco |
| `pedidoAntigo...` FAIL | Pedido velho classificado como futuro/quente | Revisar datas e evidências no fulfillment map |
| `crAbertoClassificado` FAIL | Fato com CR aberto em estágio comercial | Revisar prioridade Baixa > CR > NF no motor |
| `propostaNaoUsada...` FAIL | Import acidental de Proposal | Remover dependência; proposta só histórico opcional |
| `semJsonCru` FAIL | Vazamento de raw no payload | Sanitizar DTO (como `sanitizeFulfillmentMapForApi`) |
| Carga banco FAIL | Sem `DATABASE_URL` ou sem run SUCCESS | Configurar env / rebuild conciliação |

---

## 5. Próximos passos

1. Rodar no servidor com a run SUCCESS mais recente.  
2. Casos foco: Britânia, PD02339, pedidos bloqueados e CR aberto.  
3. Só então plugar a UI da aba Funil (componentes isolados).  
4. Manter OP opcional (ver descoberta Nomus).  
5. Não alterar Fluxo de Caixa / CR oficial / Comissões.

---

## 6. Status

Script e este documento criados para validação operacional read-only.  
UI do Dashboard **ainda não** consome o novo endpoint nesta etapa.
