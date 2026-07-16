# Relatório sanitizado — Auditoria Documentos de Saída (exemplo)

> Arquivo **versionado** apenas como modelo. Relatórios reais gerados no servidor
> (`output-documents-db-audit.json` / `.md`) estão no `.gitignore`.

## metadata

| | |
|---|---|
| **Status** | ok |
| **Mode** | examples-audit |
| **Read-only** | sim |
| **Started** | 2026-07-16T00:00:00.000Z |
| **Finished** | 2026-07-16T00:00:01.000Z |
| **Duration (ms)** | 1000 |
| **Database** | postgresql://db.example.local:5432/induscost |
| **Documento** | 8451 |
| **Pedido** | PD02590 |
| **NF-e** | 7208 |
| **Sample limit** | 20 |
| **Generated at** | 2026-07-16T00:00:01.000Z |
| **Sanitization** | Identificadores sensíveis (CPF/CNPJ/e-mail/tokens) mascarados no relatório. |

## inventory

```json
{
  "documents": {
    "total": 0,
    "documentoSaida": 0,
    "otherTypes": 0,
    "withoutItems": 0
  },
  "items": {
    "total": 0
  },
  "notes": [
    "Exemplo sanitizado — sem contagens reais de produção."
  ]
}
```

## fieldCoverage

```json
[
  {
    "field": "idNfe",
    "model": "NomusStockDocument",
    "presentInSchema": true,
    "total": 0,
    "filled": 0,
    "nullCount": 0,
    "coveragePercent": 0
  }
]
```

## itemCoverage

```json
[
  {
    "field": "estimatedTotalValue",
    "model": "NomusStockDocumentItem",
    "presentInSchema": true,
    "total": 0,
    "filled": 0,
    "nullCount": 0,
    "coveragePercent": 0
  }
]
```

## rawJsonKeys

```json
{
  "sampleSize": 0,
  "keys": [],
  "notes": [
    "Exemplos de rawJson omitidos neste modelo versionado."
  ]
}
```

## nfeLinks

```json
{
  "metrics": {
    "documentsTotal": 0,
    "documentsWithIdNfe": 0,
    "documentsWithoutIdNfe": 0
  },
  "notes": [
    "Sem IDs reais de NF neste exemplo."
  ]
}
```

## salesOrderLinks

```json
{
  "metrics": {
    "documentsTotal": 0,
    "documentsWithZeroOrders": 0,
    "documentsWithOneOrder": 0,
    "documentsWithMultipleOrders": 0
  },
  "notes": [
    "Sem códigos de pedido reais neste exemplo."
  ]
}
```

## allocations

```json
{
  "metrics": {
    "documentsTotal": 0,
    "unallocated": 0,
    "partial": 0,
    "complete": 0,
    "overAllocated": 0,
    "totalDocumentValueCents": 0,
    "totalAllocatedToOrdersCents": 0
  },
  "notes": [
    "Valores monetários zerados de propósito (exemplo sanitizado)."
  ]
}
```

## accountsReceivableLinks

```json
{
  "metrics": {
    "documentsWithIdNfe": 0,
    "documentsWithReceivables": 0,
    "titlesOpen": 0,
    "titlesPartial": 0,
    "titlesReceived": 0
  },
  "notes": [
    "Sem títulos CR reais neste exemplo."
  ]
}
```

## paymentTermsEvidence

```json
{
  "sampleSize": 0,
  "hypothesisOnly": true,
  "candidateKeys": [],
  "notes": [
    "Hipóteses de pagamento omitidas no modelo versionado."
  ]
}
```

## dataQuality

```json
{
  "status": "incomplete",
  "gaps": [],
  "risks": [],
  "notes": [
    "Exemplo estático — executar o auditor no servidor para dados reais."
  ],
  "coverage": {
    "lowCoverageDocumentFields": [],
    "lowCoverageItemFields": [],
    "thresholdPercent": 80
  },
  "linkHealth": {
    "documentsWithoutIdNfe": null,
    "nfeMissingLocally": null,
    "unallocatedDocuments": null,
    "exampleDocumentFound": null,
    "exampleOrderFound": null,
    "exampleNfeFound": null
  }
}
```

## examples

```json
{
  "outputDocument": {
    "found": false,
    "query": { "document": 8451 },
    "strategies": [
      {
        "strategy": "NomusStockDocument.externalId",
        "key": "8451",
        "attempted": true,
        "matched": false,
        "bound": "unique"
      }
    ],
    "data": null,
    "notes": [
      "Exemplo ilustrativo — found=false sem payloads de produção."
    ]
  },
  "salesOrder": {
    "found": false,
    "query": { "order": "PD02590" },
    "strategies": [],
    "data": null,
    "notes": [
      "Sem cliente, CPF, CNPJ ou valores reais."
    ]
  },
  "nfe": {
    "found": false,
    "query": { "nfe": 7208 },
    "strategies": [],
    "data": null,
    "notes": [
      "Sem chave de NF-e neste exemplo."
    ]
  }
}
```

## recommendation

```json
{
  "priority": "low",
  "summary": "Modelo sanitizado para versionamento. Executar o auditor no servidor para gerar o relatório real (gitignored).",
  "actions": [
    "Rodar npm run audit:output-documents:db no servidor com DATABASE_URL de leitura.",
    "Não versionar output-documents-db-audit.json/.md gerados."
  ],
  "nextAuditSteps": [
    "Revisar examples.* e dataQuality no relatório gerado.",
    "Manter apenas este .example.md no Git."
  ]
}
```
