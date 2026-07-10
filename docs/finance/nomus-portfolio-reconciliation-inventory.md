# Inventário — Conciliação de carteira Nomus (Pedido × Documento de Saída × Contas a Receber)

Documento de descoberta (read-only). **Não implementa sync, migration, cron nem alteração em Contas a Receber / Faturamento / Fluxo de Caixa / Comissões.**

Caso âncora: **PD 02339** (Britânia) — `SalesOrder.id=3915fa28-1947-4388-bb27-2699c3cbb516`, `externalSalesOrderId=2335`, valor pedido R$ 158.000,00.

NF vinculadas (`SalesOrderNfeLink`):

| NF | nfeExternalId | Valor cabeçalho |
|----|---------------|-----------------|
| 6845 | 6937 | R$ 108.240,00 |
| 7052 | 7188 | R$ 168.075,00 |
| 7195 | 7377 | R$ 78.975,00 |

Problema: vínculo Pedido → NF é por **cabeçalho**; falta itemização confiável do documento de saída para alocar quanto de cada NF pertence ao pedido.

---

## 1. Padrão atual de integração Nomus no IndusCost

### Client compartilhado — `src/lib/nomusRestClient.ts`

| Aspecto | Comportamento |
|---------|---------------|
| **URL** | `buildNomusUrl(baseUrl, resource, query?)` — normaliza barra final de `NOMUS_BASE_URL`, evita `/rest/rest`, anexa `searchParams` |
| **Auth** | `buildNomusHeaders()`: `Accept: application/json`; opcional `Authorization: Bearer ${NOMUS_TOKEN}`; opcional header custom `NOMUS_AUTH_HEADER_NAME` + `NOMUS_AUTH_HEADER_VALUE` |
| **GET JSON** | `fetchNomusJson(url)` — somente GET |
| **Query** | Objeto `Record<string,string>` → querystring (ex.: `pagina`, `tamanhoPagina`, `query`) |
| **Paginação** | Não está no client; cada sync decide (`pagina` / `tamanhoPagina` / cursor) |
| **Preview vs apply** | Não está no client; scripts CLI (`preview`/`apply` ou `--apply`) |
| **Log seguro** | `redactNomusUrlForLog`, `redactHeadersForLog`, `describeNomusCredential`, `sanitizeNomusErrorBody` — nunca loga valor de AUTH/TOKEN/KEY/SECRET/PASSWORD/VALUE |
| **Erro / rate limit** | HTTP 429: espera `tempoAteLiberar` (JSON) ou `Retry-After` ou backoff exponencial; 5xx retry; corpo sanitizado no throw |

Variáveis relevantes: `NOMUS_BASE_URL`, `NOMUS_TOKEN`, `NOMUS_AUTH_HEADER_NAME`, `NOMUS_AUTH_HEADER_VALUE`, `NOMUS_MAX_RETRIES`, `NOMUS_FINANCIAL_PAGE_SIZE`, `NOMUS_PAGE_SIZE`.  
`NOMUS_AUTH` aparece só na redação de logs (não é lido por `buildNomusHeaders`).

### Scripts oficiais (já existentes)

| Script | Recurso Nomus | Client | Preview/Apply |
|--------|---------------|--------|---------------|
| `scripts/nomusSalesOrdersSyncV1.ts` | `pedidos` (+ `pessoas`/`produtos` pontuais) | **cópia local** de headers/URL/retry (não importa `nomusRestClient`) | dry-run padrão; `--apply` grava |
| `scripts/nomusNfesSync.ts` | `nfes` | `fetchNomusJson` / `buildNomusUrl` | `preview` \| `apply` |
| `scripts/nomusAccountsReceivableSync.ts` | `contasReceber` | idem | `preview` \| `apply` |
| `scripts/nomusAccountsPayableSync.ts` | `contasPagar` | idem | `preview` \| `apply` |
| `scripts/nomusCustomersSyncV1.ts` | `pessoas` | cópia local | dry / `--apply` |
| `scripts/nomusProductsSyncV1.ts` | `produtos` | cópia local | dry / `--apply` |
| `scripts/nomusBomComponentsSyncV1.ts` | `componentesListaMateriais` | cópia local | dry / `--apply` |
| `scripts/nomusProposalsSyncV1.ts` | `propostas` | cópia local | dry / `--apply` |
| `scripts/nomusSyncOrchestrator.ts` | orquestra customers→…→sales-orders | spawn dos scripts | `--dry` / `--apply` |

Filtro RSQL pontual (ex. pedidos): `query=id=={id}` em `pessoas`/`produtos`.

### Lacuna confirmada

- **Não existe** referência a `documentosEstoque` / `documentos-estoque` no repositório (antes deste inventário).
- **Não existe** script/package npm de sync para documentos de estoque.
- Conciliação Pedido × NF × AR hoje depende de cabeçalho (`SalesOrderNfeLink` + títulos AR com `idNfe`), sem itens do documento de saída.

---

## 2. API alvo — `GET /rest/documentosEstoque`

| Item | Valor |
|------|--------|
| Recurso | `documentosEstoque` |
| URL base | `{NOMUS_BASE_URL}documentosEstoque` (`NOMUS_BASE_URL` deve terminar em `/rest/`) |
| Método | GET somente |
| Query esperada (PD 02339) | `query=idNfe==6937;tipoDocumentoEstoque==DocumentoSaida` (e análogos 7188, 7377) |
| Probe | `scripts/probe-nomus-stock-documents.ts` (reutiliza `buildNomusUrl` + `fetchNomusJson`) |
| Saída raw | `tmp-audits/nomus-documentos-estoque-probe.json` (gitignored) |

```bash
npx tsx scripts/probe-nomus-stock-documents.ts --idNfe=6937,7188,7377 --tipo=DocumentoSaida --limit=50
```

---

## 3. Resultado real do probe (PD 02339)

**Status (2026-07-10, workstation local):** probe **não executou live** — ausente `.env` / `NOMUS_BASE_URL` (e auth) neste workspace. O script foi validado até a checagem de env (`Variável obrigatória ausente: NOMUS_BASE_URL`).

**Próximo passo operacional:** rodar no servidor (`/opt/induscost`) ou com `.env` local contendo as variáveis Nomus já usadas pelos syncs oficiais:

```bash
npx tsx scripts/probe-nomus-stock-documents.ts --idNfe=6937,7188,7377 --tipo=DocumentoSaida --limit=50
```

| idNfe | Documentos | id documento | tipoDocumentoEstoque | data | # itensDocumentoEstoque | Itens com idProduto / qtde / valorUnitario |
|-------|------------|--------------|----------------------|------|-------------------------|--------------------------------------------|
| 6937 | _bloqueado — sem credencial local_ | | | | | |
| 7188 | _bloqueado — sem credencial local_ | | | | | |
| 7377 | _bloqueado — sem credencial local_ | | | | | |

Arquivo JSON esperado após sucesso: `tmp-audits/nomus-documentos-estoque-probe.json` (ainda não gerado).

### Checklist de capacidade

| Pergunta | Resposta |
|----------|----------|
| `documentosEstoque` retorna `itensDocumentoEstoque`? | **Não confirmado** — aguarda probe live |
| Itens têm `idProduto`, `qtde`, `valorUnitario`? | **Não confirmado** — aguarda probe live |
| Isso resolve alocação por item do PD 02339? | **Hipótese:** sim, se cada item do documento de saída puder ser cruzado com itens do pedido (`externalProductId` / SKU) e a soma alocada bater com o valor do PD; NFs com valor de cabeçalho > pedido (ex. 7188 = R$ 168.075 vs PD R$ 158.000) reforçam a necessidade de rateio por item, não por cabeçalho |

---

## 4. Próxima proposta de tabelas (não implementar nesta etapa)

Somente desenho — **sem migration / sem persistência agora**:

1. **`NomusStockDocument`** (stage do cabeçalho `documentosEstoque`)
   - `externalId`, `tipoDocumentoEstoque`, `idNfe`, `documentDate`, `rawPayload`, `payloadHash`, `syncedAt`
2. **`NomusStockDocumentItem`**
   - FK documento; `externalItemId?`, `externalProductId` (`idProduto`), `quantity`, `unitValue`, `lineTotal`, `rawPayload`
3. **`SalesOrderStockDocumentAllocation`** (ou extensão de `SalesOrderNfeLink`)
   - vínculo pedido ↔ documento/item (ou pedido ↔ fração da NF), com valor alocado e método (`ITEM_MATCH`, `MANUAL`, etc.)

Fluxo futuro sugerido: probe → mapper → sync preview/apply espelhando NF/AR → conciliação Pedido × itens documento × AR — **fora do escopo desta etapa**.

---

## 5. Arquivos desta etapa

| Arquivo | Papel |
|---------|--------|
| `scripts/probe-nomus-stock-documents.ts` | Probe GET read-only |
| `docs/finance/nomus-portfolio-reconciliation-inventory.md` | Este inventário |
| `tmp-audits/nomus-documentos-estoque-probe.json` | Raw do probe (local, não versionar) |

**Regras respeitadas:** sem alteração em Contas a Receber, Faturamento, Fluxo de Caixa, Comissões; sem cron; sem rotina automática; sem migration; sem gravação em banco; sem log de credenciais; client Nomus existente reutilizado.
