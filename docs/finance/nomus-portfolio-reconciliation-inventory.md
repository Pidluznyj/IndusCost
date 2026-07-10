# Inventário — Conciliação de carteira Nomus (Pedido × Documento de Saída × Contas a Receber)

Stage isolado de **documentos de estoque** Nomus para conciliação futura Pedido × NF × saída.  
**Não altera** Contas a Receber, Faturamento, Fluxo de Caixa nem Comissões. Sem cron / sem rotina automática.

Caso âncora: **PD 02339** (Britânia) — `SalesOrder.id=3915fa28-1947-4388-bb27-2699c3cbb516`, `externalSalesOrderId=2335`, valor pedido R$ 158.000,00.

NF vinculadas (`SalesOrderNfeLink`):

| NF | nfeExternalId | Valor cabeçalho |
|----|---------------|-----------------|
| 6845 | 6937 | R$ 108.240,00 |
| 7052 | 7188 | R$ 168.075,00 |
| 7195 | 7377 | R$ 78.975,00 |

Problema original: vínculo Pedido → NF por **cabeçalho**; faltava itemização do documento de saída.

---

## 1. Padrão atual de integração Nomus no IndusCost

### Client compartilhado — `src/lib/nomusRestClient.ts`

| Aspecto | Comportamento |
|---------|---------------|
| **URL** | `buildNomusUrl(baseUrl, resource, query?)` — normaliza barra final de `NOMUS_BASE_URL`, evita `/rest/rest` |
| **Auth** | `NOMUS_TOKEN` (Bearer) e/ou `NOMUS_AUTH_HEADER_NAME` + `NOMUS_AUTH_HEADER_VALUE` |
| **GET JSON** | `fetchNomusJson(url)` — retry/rate-limit 429 |
| **Log seguro** | redação de AUTH/TOKEN/VALUE; URL sem query completa |

### Scripts oficiais (já existentes)

| Script | Recurso Nomus |
|--------|---------------|
| `nomusSalesOrdersSyncV1.ts` | `pedidos` |
| `nomusNfesSync.ts` | `nfes` |
| `nomusAccountsReceivableSync.ts` | `contasReceber` |
| `nomusAccountsPayableSync.ts` | `contasPagar` |
| `nomusStockDocumentsSync.ts` | **`documentosEstoque`** (novo, isolado) |

---

## 2. API `GET /rest/documentosEstoque` — probe real (servidor)

Comando:

```bash
npx tsx scripts/probe-nomus-stock-documents.ts --idNfe=6937,7188,7377 --tipo=DocumentoSaida --limit=50
```

### Resultado confirmado

| idNfe | Doc estoque | Data | Itens (idProduto / qtde / unitário / total est.) | Total |
|-------|-------------|------|--------------------------------------------------|-------|
| 6937 | 7951 | 13/05/2026 08:10:33 | 456×3000@4,92=14760; 452×9000@4,92=44280; 455×10000@4,92=49200 | R$ 108.240,00 |
| 7188 | 8175 | 08/06/2026 14:58:10 | 537×10000@5,86; 452×4500@5,85; 538×6200@5,85; 453×8000@5,86 | R$ 168.075,00 |
| 7377 | 8422 | 26/06/2026 15:06:10 | 452×3500@5,85; 455×10000@5,85 | R$ 78.975,00 |

### Checklist

| Pergunta | Resposta |
|----------|----------|
| Retorna `itensDocumentoEstoque`? | **Sim** |
| Itens têm `idProduto`, `qtde`, `valorUnitario`? | **Sim** |
| Resolve alocação por item do PD 02339? | **Parcialmente** — é a ponte NF→itens; a regra de consumo por pedido ainda não está implementada |

### Interpretação PD 02339 (ainda sem automação)

- Pedido R$ 158.000 — produtos 456(3k), 452(9k), 537(5k), 455(10k) @ ~5,85/5,86.
- NF 6845 (6937): bate qtde de 456/452/455, mas unitário do documento é 4,92.
- NF 7052 (7188): produto 537 com 10k pode cobrir os 5k restantes do PD; a NF inteira **não** pertence ao pedido.
- NF 7195 (7377): não deve ser consumida automaticamente (repete produtos já atendidos).

---

## 3. Models isolados (implementados)

Migration: `prisma/migrations/20260710180000_nomus_stock_documents`

### `NomusStockDocument`

| Campo | Tipo |
|-------|------|
| `id` | uuid |
| `externalId` | Int unique (id Nomus do documento) |
| `idNfe` | Int? |
| `tipoDocumentoEstoque` | String? |
| `dataDocumento` | DateTime? |
| `rawJson` | Json (payload completo) |
| `syncedAt` / `createdAt` / `updatedAt` | DateTime |

Índices: `externalId`, `idNfe`, `tipoDocumentoEstoque`, `dataDocumento`.

### `NomusStockDocumentItem`

| Campo | Tipo |
|-------|------|
| `id` | uuid |
| `stockDocumentId` | FK → NomusStockDocument (cascade) |
| `externalItemId` | Int? |
| `externalProductId` | Int? (`idProduto`) |
| `quantity` / `unitValue` / `estimatedTotalValue` | Decimal(20,6) |
| `rawJson` | Json |

Índices: `stockDocumentId`, `externalProductId`.

**Não** altera `NomusNfe`, `SalesOrder`, `NomusAccountsReceivable`.  
**Não** cria vínculo automático com pedido nesta etapa.

---

## 4. Sync manual

```bash
# Preview (sem gravar)
npm run sync:nomus:stock-documents:preview -- --from=2025-07-01 --to=2026-07-10 --tipo=DocumentoSaida

# Apply (upsert + replace itens)
npm run sync:nomus:stock-documents:apply -- --from=2025-07-01 --to=2026-07-10 --tipo=DocumentoSaida

# Teste pontual PD 02339
npm run sync:nomus:stock-documents:preview -- --idNfe=6937,7188,7377 --tipo=DocumentoSaida
```

Comportamento:

- Reutiliza `nomusRestClient` (`buildNomusUrl` / `fetchNomusJson`).
- Query RSQL: `tipoDocumentoEstoque==DocumentoSaida;data=ge=…;data=le=…` (ou `idNfe==…`).
- Preview não grava; apply faz upsert por `externalId`, `deleteMany` itens + `createMany`.
- Sem cron / sem orquestrador.

---

## 5. O que será usado na conciliação (próximas etapas)

1. `NomusStockDocument` + `NomusStockDocumentItem` — itemização física/valor da saída.
2. `SalesOrder` / itens do pedido — demanda a alocar.
3. `SalesOrderNfeLink` — candidatos NF do pedido (cabeçalho).
4. `NomusAccountsReceivable` — títulos por `idNfe` (somente leitura; **não** alterados aqui).

Ainda **não** implementado: motor de alocação Pedido↔itens do documento, tabelas de allocation, UI, cron.

---

## 6. Arquivos desta linha

| Arquivo | Papel |
|---------|--------|
| `scripts/probe-nomus-stock-documents.ts` | Probe GET read-only |
| `scripts/nomusStockDocumentsSync.ts` | Sync preview/apply |
| `src/lib/nomusStockDocumentsMapper.ts` | Parser/mapper |
| `src/lib/nomusStockDocumentsSyncLogic.ts` | CLI/query/paginação/plano |
| `src/lib/nomusStockDocuments.test.ts` | Testes unitários |
| `prisma/migrations/20260710180000_nomus_stock_documents` | DDL isolado |

**Isolamento confirmado:** esta base não alimenta Fluxo, Faturamento, AR ou Comissões até uma etapa futura explícita.
