# OrderToCashAudit — Rebuild

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Script** | `scripts/rebuildOrderToCashAudit.ts` |
| **Runner oficial** | `scripts/runOrderToCashAuditRebuild.sh` |
| **Procedimento operacional** | **`docs/finance/order-to-cash-audit-rebuild-official.md`** |
| **Validação PD 02339** | `tmp-audits/validate-order-to-cash-audit-pd02339.ts` |
| **Motor** | `src/lib/sales/orderToCashAuditBuilder.ts` |
| **Tabelas** | `OrderToCashAuditRun`, `OrderToCashAuditFact` |

> **Operação das 3 abas da Conciliação:** use o documento oficial em Finanças  
> (`docs/finance/order-to-cash-audit-rebuild-official.md`) — sync Nomus → preview → apply, logs e validação Britânia/run geral.

---

## Objetivo

Materializar a auditoria **Pedido → Caixa** em tabelas derivadas, reconstruíveis e read-only para a UI.

A rotina **só grava** em `OrderToCashAuditRun` / `OrderToCashAuditFact`.  
Não altera SalesOrder, NF, Documento de Estoque, Contas a Receber, Fluxo de Caixa, Comissões, Proposta etc.

---

## Preview (não grava)

```bash
npx tsx scripts/rebuildOrderToCashAudit.ts --mode preview --orderCode "PD 02339"
```

Imprime totais, contagens de estágio/pagamento/alertas e top 10 pedidos com risco.

---

## Apply (grava run nova)

```bash
npx tsx scripts/rebuildOrderToCashAudit.ts --mode apply --orderCode "PD 02339"
```

- Cria uma **nova** `OrderToCashAuditRun` (imutável).
- Insere facts com `runId` da run.
- **Não** apaga runs antigas neste fluxo.
- Status final: `SUCCESS` | `PARTIAL` | `FAILED`.

---

## Por cliente + ano (padrão da UI futura)

Na UI, **cliente + ano** serão obrigatórios para não carregar a base inteira.

```bash
npx tsx scripts/rebuildOrderToCashAudit.ts --mode preview --customerExternalId 200 --year 2026
npx tsx scripts/rebuildOrderToCashAudit.ts --mode apply --customerExternalId 200 --year 2026
```

Parâmetros adicionais:

| Flag | Descrição |
|------|-----------|
| `--salesOrderId` | UUID do pedido |
| `--from` / `--to` | Período (`YYYY-MM-DD`) |
| `--dateAxis` | Eixo do período (default `ORDER_ISSUE_DATE`) |
| `--limit` | Limite de pedidos |

**dateAxis:** `ORDER_ISSUE_DATE` · `EXPECTED_DELIVERY_DATE` · `STOCK_DOCUMENT_DATE` · `NFE_DATE` · `RECEIVABLE_DUE_DATE` · `RECEIVABLE_SETTLEMENT_DATE`

---

## Validar PD 02339

1. Apply do pedido:

```bash
npx tsx scripts/rebuildOrderToCashAudit.ts --mode apply --orderCode "PD 02339"
```

2. Validação:

```bash
npx tsx tmp-audits/validate-order-to-cash-audit-pd02339.ts
```

A validação localiza a última run `SUCCESS` com o pedido e verifica:

- pedido / itens;
- vendedor do pedido;
- condição de pagamento (ou `MISSING`);
- NF / documento / itens (quando existirem);
- valor atribuído ≤ R$ 158.000,00;
- cabeçalho NF não infla o pedido;
- CR / paymentStatus / orderToCashStage / alertas;
- sem uso de proposta ou comissão no rebuild/builder.

---

## Tabela derivada

| Propriedade | Significado |
|-------------|-------------|
| Derivada | Calculada a partir de fontes oficiais |
| Reconstruível | Novo apply = nova run; runs antigas podem coexistir |
| Read-only na UI | Tela futura só lê |
| Escrita | Apenas este script (ou rotina futura equivalente) |

---

## UI — não carregar tudo sem filtro

A futura aba na Conciliação de Carteira **não** deve listar todos os facts sem filtro.

Filtro operacional mínimo recomendado:

1. `customerExternalId` (ou cliente interno)
2. `year` (via `dateAxis`, tipicamente emissão do pedido)

Opcional: pedido, estágio, temperatura, vendedor, alertas.

Sem filtro, o volume de facts por item × documento torna a consulta inviável.

---

## Migration

Schema: `prisma/migrations/20260722120000_order_to_cash_audit/`

Aplicar no ambiente antes do primeiro `apply` (`prisma migrate deploy` / fluxo interno).  
Este documento não executa migrate em produção.
