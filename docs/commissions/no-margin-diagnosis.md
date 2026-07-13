# Diagnóstico — Comissões `NO_MARGIN` (pedidos Mai/2026)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-13 |
| **Escopo** | Diagnóstico **read-only** — sem correção, sem migration, sem alteração de cálculo |
| **Script** | `tmp-audits/inspect-commission-no-margin-orders.ts` |
| **Ambiente desta execução** | Sem `DATABASE_URL` — mapa de código + hipóteses técnicas; **reexecutar no servidor com banco** para preencher evidências por pedido |

Pedidos alvo:

- PD 02488  
- PD 02490  
- PD 02480  
- PD 02577  
- PD 02566  
- PD 02546  

---

## 1. Resumo executivo

O status de tela **`NO_MARGIN`** (motivo *“Margem ou tabela comercial…”*) **não** significa “margem IndusCost de produção ausente”.

É um **diagnóstico de ledger/fechamento** que mapeia status materializados do snapshot de itens:

- `NO_COMMERCIAL_PRICE_TABLE`
- `INVALID_COMMERCIAL_PRICE_RANGE`

para o rótulo **`NO_MARGIN`**.

A causa técnica mais provável, alinhada ao sintoma (tabela republicada em **13/07/2026 10:02** e pedidos de **maio/2026** que continuam zerados após reprocessar), é:

**`PRICE_TABLE_NOT_PUBLISHED_AT_ORDER_DATE` / `NO_PRICE_TABLE_FOR_ORDER_DATE`**

Ou seja: o motor busca a Formação de Preço **vigente na data de referência do pedido/NF**, **não** na data de hoje e **não** na data de publicação recente. Publicar em julho **não** cobre automaticamente maio, salvo a versão publicada ter `effectiveFrom`/`effectiveTo` cobrindo a data do pedido (ou da NF).

Hipótese secundária a confirmar no banco: **`PRODUCT_SKU_NOT_MATCHED`** — existe linha na tabela por SKU (`610.85` / `610.85AA`), mas o `PriceTableItem.productId` ≠ `SalesOrderItem.productId` (o lookup usa **somente UUID local**).

---

## 2. Pedidos analisados

| Pedido | Live DB nesta máquina | Esperado (hipótese) |
|--------|------------------------|---------------------|
| PD 02488 | SKIP | NO_MARGIN ← snapshot `NO_COMMERCIAL_PRICE_TABLE` (ou range inválido) |
| PD 02490 | SKIP | idem |
| PD 02480 | SKIP | idem |
| PD 02577 | SKIP | idem |
| PD 02566 | SKIP | idem |
| PD 02546 | SKIP | idem |

Para preencher a coluna live:

```bash
npx tsx tmp-audits/inspect-commission-no-margin-orders.ts
```

com `DATABASE_URL` apontando para o ambiente operacional. O script grava `tmp-audits/inspect-commission-no-margin-orders.result.json`.

---

## 3. Resultado por pedido

_Sem evidência live neste ambiente._ Estrutura que o script imprime por pedido:

1. Dados do pedido (código, `issueDate`, cliente, vendedor Nomus `externalSellerId` / `nomusSellerName`, status, total)  
2. Itens (`skuSnapshot`, `productId`, `externalProductId`, qtd, preço, líquido)  
3. Comissão atual (`CommissionOrderSnapshot` + itens + schedules + ledger + `CommissionRecord` legado)  
4. Formação de preço (load nas datas: referência do motor / hoje / 13/07/2026)  
5. Comparação de datas  
6. Causa classificada (`NoMarginCause`)  
7. Runs recentes de `CommissionCalculationRun` e menção ao pedido no `summaryJson`

---

## 4. Motivo técnico do `NO_MARGIN`

### 4.1 Função exata que gera o rótulo `NO_MARGIN`

| Campo | Valor |
|-------|--------|
| **Arquivo** | `src/lib/commissions/commissionReceiptEngine.ts` |
| **Função** | `mapSnapshotItemStatusesToLedgerDiagnosis` |
| **Condição** | Todos os `itemStatuses` ∈ `{NO_COMMERCIAL_PRICE_TABLE, INVALID_COMMERCIAL_PRICE_RANGE}` **ou** mistura desses com `{NO_RULE, NO_COMMISSION_TABLE_RATE}` **desde que** haja pelo menos um status de “margem/tabela” |
| **Motivo fixo** | `"Margem ou tabela comercial indisponível para cálculo de comissão"` |

Trecho conceitual:

```ts
const SNAPSHOT_MARGIN_ISSUE_STATUSES = new Set([
  "NO_COMMERCIAL_PRICE_TABLE",
  "INVALID_COMMERCIAL_PRICE_RANGE",
]);
// se todos (ou mistura com regra) → { status: "NO_MARGIN", reason: "Margem ou tabela comercial..." }
```

Também é aplicada quando o schedule está `ACTIVE` com `scheduledCommissionAmount <= 0` (`diagnoseMaterializedSchedule`).

> Nota de schema: o enum Prisma `CommissionReceiptLedgerLineStatus` **ainda não lista** `NO_MARGIN` (existe no union TypeScript). A UI/fechamento pode estar mostrando o diagnóstico em memória / caminho paralelo; o **status real do item** no banco é tipicamente `NO_COMMERCIAL_PRICE_TABLE`.

### 4.2 Função que grava o status “de verdade” no snapshot

| Campo | Valor |
|-------|--------|
| **Arquivo** | `src/lib/commissions/commissionOrderCalculation.ts` |
| **Funções** | `resolvePureCommissionRate` → `calculateItemCommission` |
| **Status possíveis** | `NO_COMMERCIAL_PRICE_TABLE`, `INVALID_COMMERCIAL_PRICE_RANGE`, `NO_COMMISSION_TABLE_RATE`, … |
| **Campos que procura** | `commercialTiersByProductId.get(productId)` + preço unitário líquido do item |

Se `tiers` vazio → `NO_COMMERCIAL_PRICE_TABLE`  
(“Produto sem tabela comercial publicada para a data de referência.”)

### 4.3 Tabela / consulta da Formação de Preço

| Campo | Valor |
|-------|--------|
| **Arquivo** | `src/lib/commissions/commission-commercial-tier.server.ts` |
| **Função** | `loadCommercialPriceTiersForProduct(db, productId, referenceDate)` |
| **Tabelas** | `PriceTable` códigos `ATACADO`, `VAREJO_1`, `VAREJO_2`, `VAREJO_3` com `status = ACTIVE` |
| **Versão** | `PriceTableVersion` com `status = PUBLISHED` e vigência: `effectiveFrom <= referenceDate` e (`effectiveTo` null **ou** `effectiveTo > referenceDate`) |
| **Item** | `PriceTableItem` por **`priceTableVersionId + productId`** (unique) |
| **Campos lidos** | `salePrice`, `commissionPerc` |

**Não consulta:** SKU, `externalProductId`, Proposal, responsável comercial do cliente.

### 4.4 Data usada pelo motor

| Campo | Valor |
|-------|--------|
| **Arquivo** | `src/lib/commissions/commission-source-resolver.ts` |
| **Função** | `resolveCommissionRuleReferenceDate` |
| **Prioridade** | 1) `SalesOrderNfeLink.dataProcessamento` da NF vinculada → 2) `SalesOrder.issueDate` |
| **Não usa** | data atual (“hoje”), data de publicação da tabela, `settlementDate` (exceto exclusão de cliente em outros fluxos) |

O snapshot grava essa data em `CommissionOrderSnapshot.saleDate`.

---

## 5. A tabela publicada em 13/07/2026 deveria impactar maio/2026?

**Não, automaticamente.**

Regras do projeto:

1. Comissão usa o motor oficial com **data de referência do pedido/NF**.  
2. Reprocessamento **não deve forçar** comissão se a margem/tabela aplicável àquela data não existir.  
3. Publicar em 13/07/2026 só beneficia pedidos cuja `referenceDate` caia dentro de `effectiveFrom`/`effectiveTo` da versão publicada.

Se a versão nova tiver `effectiveFrom ≈ 2026-07-13` (ou “a partir de hoje”), pedidos com `issueDate` em **maio/2026** continuam sem tabela vigente → reprocessar **recalcula e permanece zero** (`NO_CHANGE` / mesmo status).

Só haveria impacto em maio se:

- a publicação for **retroativa** (`effectiveFrom` ≤ data do pedido/NF), **e**
- existir `PriceTableItem` para o **mesmo `productId`** local do item do pedido em **todas** as quatro faixas.

---

## 6. Reprocessamento rodou e manteve o mesmo resultado?

**Hipótese confirmável pelo script (com DB):**

- Runs em `CommissionCalculationRun` (summary com engine `materializeCommissionForSalesOrder+…`)  
- Diff de reprocess (`commissionReprocess.ts`): `action: "unchanged"` / `blockReason: "NO_CHANGE"` quando o valor recalculado = atual  

Comportamento esperado do código: **sim** — rematerializar com a mesma data de referência e a mesma ausência de tabela vigente **reproduz** `NO_COMMERCIAL_PRICE_TABLE` → UI `NO_MARGIN`.

Isso **não** indica falha do reprocessamento; indica que o input (vigência/match) não mudou para a data do pedido.

---

## 7. Problema de SKU / `externalProductId`?

**Possível causa secundária.**

- Lookup oficial: **somente** `SalesOrderItem.productId` ↔ `PriceTableItem.productId`.  
- SKU na tela da Formação de Preço (`610.85`, `610.85AA`) **não garante** match se o item do pedido aponta para outro `Product` UUID (duplicidade de catálogo, SKU republicado, produto “COMPLETO” novo).  
- `externalProductId` no item do pedido é metadado Nomus; **não** entra no `findUnique` da tabela.

O script classifica isso como **`PRODUCT_SKU_NOT_MATCHED`** quando encontra item na tabela pelo SKU com `productId` diferente e load por UUID falha.

---

## 8. Problema de vigência?

**Causa principal esperada: sim.**

Filtro explícito em `loadCommercialPriceTiersForProduct`:

- versão deve estar `PUBLISHED`  
- `effectiveFrom <= referenceDate`  
- `effectiveTo` nulo ou `> referenceDate`  

Publicação recente com vigência futura/atual **não** atende `referenceDate` de maio.

---

## 9. Problema de regra de margem / comissão?

| Tipo | Papel |
|------|--------|
| Margem de **produção** IndusCost (`marginPercent` via custo VERSIONED) | Usada no enquadramento de regra; **ausência sozinha não vira `NO_MARGIN`** |
| Faixas **comerciais** (ATACADO/VAREJO) | Ausência → `NO_COMMERCIAL_PRICE_TABLE` → **`NO_MARGIN` na UI** |
| `commissionPerc` ≤ 0 nas faixas | `NO_COMMISSION_TABLE_RATE` → diagnóstico de ledger tende a **`NO_RULE`**, não `NO_MARGIN` |
| `CommissionRule` sem match | `NO_RULE` |
| Exclusão de cliente | `CUSTOMER_EXCLUDED` |
| Vendedor | `SELLER_UNRESOLVED` / `NO_SELLER` — **não** usar responsável comercial do cliente |

Para o sintoma reportado (texto de “Margem ou tabela comercial…”), o caminho é **tabela comercial / range**, não regra fiscal isolada (`FISCAL_RULE_NOT_FOUND` não é o código atual do motor de comissão).

---

## 10. Correções recomendadas (ainda **não** aplicar)

### Correção de dado

1. Garantir versão `PUBLISHED` das quatro tabelas com **`effectiveFrom` cobrindo a data do pedido/NF** (se a regra de negócio exigir retroatividade explícita).  
2. Garantir `PriceTableItem` para o **mesmo `productId`** dos itens dos PDs (não só SKU visual).  
3. Se houver produtos duplicados no catálogo, alinhar `SalesOrderItem.productId` ao produto usado na Formação de Preço.

### Correção de tela

1. Exibir o status **real do item** (`NO_COMMERCIAL_PRICE_TABLE`) além do rótulo agregado `NO_MARGIN`.  
2. Mostrar a **data de referência** usada (NF `dataProcessamento` vs `issueDate`) e a vigência da tabela encontrada/não encontrada.  
3. Tooltip: “Publicar tabela hoje não altera pedidos cuja data de referência é anterior à vigência.”

### Correção de motor

1. (Opcional) Incluir `NO_MARGIN` no enum Prisma do ledger **ou** parar de emitir status fora do enum.  
2. (Opcional) Melhorar mensagem: distinguir “sem versão na data” vs “SKU existe mas productId diverge”.  
3. **Não** mudar a regra de data para “hoje” sem modo explícito de retroatividade.

### Opção de reprocessamento retroativo

1. Publicar/ajustar vigência **com `effectiveFrom` ≤ maio/2026** (decisão de negócio).  
2. Rodar `preview` → `apply` do reprocess filtrando os orderCodes.  
3. Validar que snapshots saem de `NO_COMMERCIAL_PRICE_TABLE` para `COMMISSIONABLE` e percentuais > 0.

---

## 11. Validações

| Comando | Resultado (ambiente local 2026-07-13) |
|---------|--------------------------------------|
| `npm run check:server-imports` | OK |
| `npm run check:frontend-server-imports` | OK |
| `npm test` | OK (0 fail) |
| `npm run build` | OK |
| `npx tsx tmp-audits/inspect-commission-no-margin-orders.ts` | OK — mapa de código + **SKIP live** (sem `DATABASE_URL`) |

---

## 12. Conclusão

**Causa principal (código + sintoma):** o motor exige Formação de Preço **PUBLISHED e vigente na data do pedido/NF**; a publicação de **13/07/2026** não altera pedidos de **maio/2026** sem vigência retroativa explícita. O reprocessamento, ao usar a mesma data de referência, **mantém** comissão zero e o diagnóstico **`NO_MARGIN`**.

**Próximo passo operacional:** rodar o script com `DATABASE_URL` no servidor e anexar o `result.json` a este documento (seção 3) para fechar causa por pedido (`PRICE_TABLE_NOT_PUBLISHED_AT_ORDER_DATE` vs `PRODUCT_SKU_NOT_MATCHED`).
