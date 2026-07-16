# OP-01 — Contrato da API Nomus `/rest/ordens`

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Endpoint** | `GET /rest/ordens` |
| **Status** | Confirmado com amostra real (2026-07) |
| **Prompt** | OP-01 |

Relacionados: [`current-state.md`](./current-state.md) · [`target-architecture.md`](./target-architecture.md) · [`../integrations/nomus-production-orders-sync.md`](../integrations/nomus-production-orders-sync.md)

---

## 1. Autenticação e base

Mesmo contrato dos demais syncs IndusCost:

- Base: `NOMUS_BASE_URL` (tipicamente termina em `/rest/` ou `/rest`)
- Auth: `NOMUS_TOKEN` (Bearer) e/ou `NOMUS_AUTH_HEADER_NAME` + `NOMUS_AUTH_HEADER_VALUE`
- Cliente: `buildNomusUrl(base, "ordens", queryParams)` + `fetchNomusJson`

Path relativo: **`ordens`** → `GET {NOMUS_BASE_URL}ordens`.

---

## 2. Paginação

Query params (padrão Nomus IndusCost):

| Param | Tipo | Descrição |
|-------|------|-----------|
| `pagina` | int ≥ 1 | Página atual |
| `tamanhoPagina` | int ≥ 1 | Tamanho da página (default sync: 50) |
| `query` | string RSQL | Filtro opcional |

Resposta: array direto **ou** envelope com `ordens` / `dados` / `data` / `items` / `content` (parser tolera todos). Metadados opcionais: `totalPaginas` / `totalPages`.

Regra de parada: página vazia, ou `length < tamanhoPagina`, ou `pagina >= totalPaginas`.

---

## 3. Consulta pontual (RSQL)

| Uso | Exemplo |
|-----|---------|
| Por nome | `query=nome=="OP 05800 - 003"` |
| Por id | `query=id==30347` |
| Por pedido (tentativa) | `query=itensPedido.idPedido==2530` |

**Atenção:** filtro nested `itensPedido.idPedido` pode não ser suportado pela API. Validar no servidor; se falhar, usar listagem paginada + filtro local pelos links.

Escape de aspas no valor RSQL: `"` → `\"` (helper `escapeNomusRsqlQuotedValue`).

---

## 4. Payload comprovado (amostra sanitizada)

Consulta: `GET /rest/ordens?query=nome=="OP 05800 - 003"`.

### 4.1 Cabeçalho OP

| Campo Nomus | Valor amostra | Semântica IndusCost |
|-------------|---------------|---------------------|
| `id` | `30347` | `NomusProductionOrder.externalId` |
| `nome` | `OP 05800 - 003` | `name` |
| `status` | `Encerrada` | `status` (string) |
| `tipo` | `Injeção` | `tipo` |
| `produto` | `311.32AA` | `productCode` (string ou objeto) |
| `quantidade` | `"15.400"` | `quantity` **15400** (pt-BR milhar) |
| `unidade` | `PC` | `unit` |
| `idProduto` | `391` | `externalProductId` |
| `empresa` | `KOPPETEL` | `companyName` |

Objeto completo persistido em `rawJson`.

### 4.2 Vínculo oficial com Pedido (`itensPedido[]`)

| Campo Nomus | Valor amostra | Semântica |
|-------------|---------------|-----------|
| `id` | `11324` | ID externo do **item** do pedido → `SalesOrderItem.nomusItemExternalId` / `externalSalesOrderItemId` |
| `idPedido` | `2530` | ID externo do **pedido** → `SalesOrder.externalSalesOrderId` / `externalSalesOrderId` |
| `item` | `00010` | sequência → `itemNumber` |
| `nomeCliente` | `Esmaltec S/A` | `customerName` (informativo) |
| `quantidade` | `"15.000"` | `linkedQuantity` **15000** |

### 4.3 Confirmação cruzada Pedido

`GET /rest/pedidos/2530`:

- `codigoPedido`: `PD 02534`
- item externo `11324`, sequência `00010`

**Regra de ouro:** o vínculo OP↔Pedido/Item é **somente** `idPedido` + `id` do `itensPedido`. Proibido inferir por nome da OP, cliente, produto, datas ou quantidades.

---

## 5. Números (decimal brasileiro)

Parser oficial: `parseNomusPtBrNumber` / `parseNomusProductionQuantity`.

| Entrada | Saída |
|---------|-------|
| `"15.400"` | `15400` |
| `"15.000"` | `15000` |
| `"1.234,56"` | `1234.56` |
| número JS finito | identidade |

---

## 6. Campos opcionais / candidatos

Ainda **não** tratados como contrato estável (mapear só se aparecerem de forma consistente):

- datas (`dataAbertura`, `dataEncerramento`, …)
- `empresa` como objeto `{ id, nome }`
- status numérico vs textual
- arrays alternativos de itens (`itensPedidos`, etc. — parser já tolera alguns aliases)

---

## 7. Erros e resiliência esperados no cliente

| Situação | Comportamento IndusCost |
|----------|-------------------------|
| HTTP 429 | retry com `tempoAteLiberar` / `Retry-After` / backoff |
| HTTP 5xx | retry exponencial até `NOMUS_MAX_RETRIES` |
| HTTP 4xx (exceto 429) | falha imediata (log redigido) |
| OP sem `id` | descartada no mapper (`MISSING_EXTERNAL_ID`) |
| `itensPedido` sem `id`/`idPedido` | link ignorado |
| Timeout | **hoje inexistente** — risco documentado |

---

## 8. O que este contrato **não** cobre

- Mutação na Nomus (somente GET)
- Endpoints candidatos descartados (`ordensProducao`, etc.) — ver discovery
- OP embutida em `pedidos` (`ordensProducao` no raw) — legado UI, não fonte oficial do stage
- Escrita em `SalesOrder` / `SalesOrderItem` além de **leitura** para resolver FKs

---

## 9. Checklist de homologação no servidor

1. `prisma migrate deploy` (migration OP já no repositório).
2. `npm run sync:nomus:production-orders:preview -- --name="OP 05800 - 003"`.
3. Conferir mapped `externalId=30347`, links `2530`/`11324`, qty 15400/15000.
4. `apply` pontual e validar linhas no banco.
5. Testar `itensPedido.idPedido==2530` — anotar se CONFIRMADO ou INDISPONÍVEL.
6. Rodar um apply de pedidos e verificar log do pós-hook OP (ou `NOMUS_PRODUCTION_ORDERS_AFTER_SYNC=false` para isolar).
