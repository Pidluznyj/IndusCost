# Central de Inteligência — Endpoints (read-only)

Base: `/api/finance/portfolio-reconciliation/intelligence`  
Permissão: mesmas da Conciliação (`finance.view`, `finance.accountsReceivable.view`, …).

## Listagem

`GET /api/finance/portfolio-reconciliation/intelligence`

Query: `runId`, `customerExternalId`, `customerId`, `sellerExternalId`, `sellerId`,
`companyId`, `orderCode`, `productExternalId`, `statusPrincipal`, `confidenceLabel`,
`tagsAlerta`, `minValue`, `maxValue`, `dateAxis`, `from`, `to`, `page`, `pageSize`,
`sortBy`, `sortDirection`, `asOfDate`.

`pageSize` máximo: 200. `dateAxis` inválido → 400 amigável.

### Exemplos curl

```bash
# Britânia por run
curl -sS -H "Cookie: ..." \
  "https://HOST/api/finance/portfolio-reconciliation/intelligence?runId=1dc2ead7-533d-4ad4-bc4c-621061fa5623&customerExternalId=200&asOfDate=2026-07-10"

# Por cliente
curl -sS -H "Cookie: ..." \
  "https://HOST/api/finance/portfolio-reconciliation/intelligence?customerExternalId=200"

# Por vendedor
curl -sS -H "Cookie: ..." \
  "https://HOST/api/finance/portfolio-reconciliation/intelligence?sellerExternalId=77"

# Por status
curl -sS -H "Cookie: ..." \
  "https://HOST/api/finance/portfolio-reconciliation/intelligence?statusPrincipal=CARTEIRA_VENCIDA_BLOQUEADA"

# Por confiança
curl -sS -H "Cookie: ..." \
  "https://HOST/api/finance/portfolio-reconciliation/intelligence?confidenceLabel=MUITO_BAIXA"

# Por eixo de data (emissão)
curl -sS -H "Cookie: ..." \
  "https://HOST/api/finance/portfolio-reconciliation/intelligence?dateAxis=ORDER_ISSUE_DATE&from=2026-01-01&to=2026-07-10"
```

## Detalhe do pedido

`GET /api/finance/portfolio-reconciliation/intelligence/orders/:salesOrderId`

```bash
curl -sS -H "Cookie: ..." \
  "https://HOST/api/finance/portfolio-reconciliation/intelligence/orders/UUID?runId=1dc2ead7-533d-4ad4-bc4c-621061fa5623"
```

Resposta inclui: resumo executivo, pedido, cliente, vendedor, datas, itens, NF/documento/CR,
condição de pagamento (ou “Informação não disponível na importação atual.”), timeline,
classificação, confiança, tags e ação recomendada.

## Payload listagem (resumo)

```json
{
  "ok": true,
  "cards": [{ "key": "CARTEIRA_TOTAL_ANALISADA", "value": 0, "explanation": {} }],
  "groups": [{ "statusPrincipal": "CR_ABERTO", "orderValue": 0 }],
  "sellerKpis": [],
  "rows": [],
  "pagination": { "page": 1, "pageSize": 50, "totalRows": 0, "totalPages": 0 },
  "filters": {},
  "metricExplanations": {},
  "warnings": []
}
```
