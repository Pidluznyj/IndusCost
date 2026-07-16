# TRIB-02 — Plano de correção: aba Tributos vazia

**Origem:** `docs/sales-orders/taxes-empty-state-diagnosis.md` (TRIB-01)  
**Escopo:** plano apenas — **não implementar** nesta etapa.  
**Não inventar dados do PD 02781** — validação em servidor fica para consultas read-only listadas abaixo.

---

## 1. Sintoma e condição comprovada

Mensagem observada:

> Tributos documentais indisponíveis para este pedido.

| Condição | Evidência no código |
|----------|---------------------|
| `fiscalTaxes == null` / `undefined` | `SalesOrderTributosTab` → `data-testid="sales-order-tributos-empty"` |
| FE `denied === false` | `SalesOrderDetailDialog`: `denied={!canTributos}` |
| FE libera SUPER_ADMIN | `AuthContext.hasPermission`: `role === "SUPER_ADMIN"` → `true` (PERM-31) |
| BE pode negar com bag parcial | `canViewSalesOrderFiscalTaxesFromPermissions` exige `detail.view` \| `invoice.view` se existir qualquer `sales_orders.*` |
| Rota passa bag crua | `salesOrderDetailRoutes.ts`: `permissions: appAuth.permissions ?? []` (**não** `effectivePermissions`, **sem** role) |
| Sessão HTTP ≠ `/me` compact | `toAppAuthContext` chama `toSafeAppUser(user)` **sem** `sessionCompact` → SUPER_ADMIN mantém `permissions` do DB |

`buildSalesOrderFiscalTaxesPayload` **sempre** devolve objeto (mesmo sem NF). Portanto empty ≠ “sem NF” (sem NF = `sales-order-tributos-no-nfe`).

---

## 2. Classificação dos problemas

| # | Problema | Classe | Papel no sintoma empty | Status |
|---|----------|--------|------------------------|--------|
| P0 | Gate fiscal BE usa `appAuth.permissions` (bag) enquanto FE libera via `effectivePermissions` **ou bypass SUPER_ADMIN**; bag com `sales_orders.view` sem `detail.view`/`invoice.view` → `fiscalTaxes: null` | **permissão** + **contrato incorreto da API** | **Causa do empty reportado** | Comprovado no código |
| P0b | FE mapeia `fiscalTaxes: null` para empty genérico em vez de denied / motivo explícito | **interpretação errada do frontend** | Amplifica o sintoma (mensagem enganosa) | Comprovado |
| P1 | `OrderToCashAuditFact.nfeExternalId` não seeda `nfeMap` (só `nfeNumber` / surrogate negativo) | **dependência indevida do O2C** (uso incompleto) / **vínculo Pedido → NF-e** | Não gera empty; pode gerar no-nfe ou NF sem summary | Comprovado; secundário |
| P1b | `NomusStockDocument.idNfe` não seeda `nfeMap` sozinho | **ausência de leitura pelo Documento de Saída** / **vínculo Pedido → NF-e** | Idem | Comprovado; secundário |
| — | Filtro NF válida/cancelada | **filtro incorreto de NF válida** | Não explica empty | Descarta para este sintoma (filtros existem e são coerentes no builder) |
| — | Campos ICMS/IPI/PIS/COFINS/ST | **campos tributários não carregados** | Não explica empty (builder retorna payload mesmo sem `NomusNfeFiscalSummary`) | Descarta para este sintoma |
| — | Outro | — | — | Sem evidência adicional no código |

### Causa técnica mais provável (P0)

Para usuário **SUPER_ADMIN** (ou FE com `detail.view`/`invoice.view` efetivo):

1. FE: `canTributos === true` (bypass de role ou chaves efetivas).
2. BE: `userContext.permissions` = bag persistida da sessão HTTP; se contém `sales_orders.*` sem `sales_orders.detail.view` e sem `sales_orders.invoice.view` → `allowFiscal === false`.
3. Payload: `fiscalTaxes: null`.
4. UI: empty (não denied).

Isso encaixa o sintoma **sem** depender de NF, XML ou O2C do PD 02781.

---

## 3. Menor conjunto de correções

### Fase A — corrigir empty (obrigatória, mínima)

**Objetivo:** quem o FE considera apto a ver Tributos recebe `fiscalTaxes` objeto (ou denied explícito).

| Passo | Alteração | Arquivos |
|-------|-----------|----------|
| A1 | Passar ao gate a **mesma autoridade** da sessão efetiva: `effectivePermissions` **e/ou** `role` (tratar SUPER_ADMIN como liberado), em vez de só `permissions` cruas | `src/lib/salesOrderDetailRoutes.ts`; espelhar em callers de `getOrderFullAudit` / portfolio audit se usarem o mesmo `userContext` |
| A2 | Opcional e recomendado: em `canViewSalesOrderFiscalTaxesFromPermissions`, aceitar também `sales_orders.view` **ou** documentar alinhamento com o guard da rota (`detail.view \| view`) | `src/lib/sales-orders/salesOrderFiscalTaxesPermissions.ts` |
| A3 | Contrato API: quando gate negar, enviar sinal explícito (ex. `fiscalTaxes: null` + `fiscalTaxesAccess: "denied"`) **ou** FE: se `fiscalTaxes == null` e permissão FE ok, tratar como denied/erro de contrato — não empty genérico | `salesOrderDetailClient.ts` + `SalesOrderTributosTab.tsx` / `SalesOrderDetailDialog.tsx` |

**Não** alterar nesta fase: parser XML, Prisma models, filtros de cancelamento, settlements B/C/D.

### Fase B — vínculos NF (somente se, após A, a API devolver payload e o pedido ainda cair em no-nfe / sem summary)

| Passo | Alteração | Arquivo principal |
|-------|-----------|-------------------|
| B1 | Seedar `nfeMap` com `fact.nfeExternalId > 0` | `orderFullAuditService.ts` (`loadOrderFullAudit`) |
| B2 | Seedar `nfeMap` com `NomusStockDocument.idNfe > 0` quando o doc já está ligado ao pedido | idem |
| B3 | Evitar surrogate negativo quando existir `nfeExternalId` real | idem |

Fonte oficial dos impostos permanece: **`NomusNfeFiscalSummary` + `NomusNfeTaxLine`** via `buildSalesOrderFiscalTaxesPayload` — não inventar tributos a partir de O2C.

---

## 4. Funções reutilizáveis (não reinventar)

| Função | Uso |
|--------|-----|
| `canViewSalesOrderFiscalTaxes` / `canViewSalesOrderFiscalTaxesFromPermissions` | Gate; estender ou alinhar input |
| `hasPermission` / `getEffectivePermissions` (`appAuth.ts`) | Critério de sessão |
| `getOrderFullAudit` / `loadOrderFullAudit` | Resolução pedido + `audit.nfes` |
| `buildSalesOrderFiscalTaxesPayload` | DTO da aba (já idempotente com 0 NF) |
| `applyNormalizedNfeStatus` / flags `isCanceled` / `isValidForBilling` | Manter filtros atuais |
| `labelForFiscalTaxType` / parser `nfeFiscalXmlParser` | Campos ICMS, IPI, PIS, COFINS, ICMS_ST |

---

## 5. Fonte oficial dos tributos

| Camada | Fonte |
|--------|-------|
| Destacados documentais (aba) | `NomusNfe` → `NomusNfeFiscalSummary` + `NomusNfeTaxLine` (HEADER para totais; ITEM separado) |
| Lista de NF do pedido | Preferência: `SalesOrderNfeLink`; complementar (fase B): O2C `nfeExternalId`, DS `idNfe` |
| Não oficiais para ICMS/IPI tipados | Fallback `HEADER_DIFF` / `OTHER` sem inventar tipos |

---

## 6. Vínculos que precisam ser aceitos

| Vínculo | Hoje | Meta |
|---------|------|------|
| Pedido → `SalesOrderNfeLink` → NF-e | Aceito | Manter |
| Pedido → O2C → `nfeExternalId` → NF-e | Parcial (número/surrogate) | Aceitar id positivo (fase B) |
| Pedido → Documento de Saída → `idNfe` → NF-e | Não seeda mapa | Aceitar quando doc ligado ao pedido (fase B) |
| NF cancelada | Em `cancelledNfes`, fora dos totais válidos | Manter |

---

## 7. Arquivos a alterar (fase A)

1. `src/lib/salesOrderDetailRoutes.ts` — `userContext` com autoridade efetiva (+ role se necessário)  
2. `src/lib/sales-orders/salesOrderFiscalTaxesPermissions.ts` — alinhar regra (view / SUPER_ADMIN)  
3. `src/lib/sales-orders/salesOrderDetailService.server.ts` — se `userContext` ganhar campos novos  
4. `src/lib/finance/orderFullAuditService.ts` — `getOrderFullAudit` gate (mesma regra)  
5. Call sites de audit com `userContext.permissions` (ex. portfolio reconciliation), se duplicarem o gate  
6. `src/lib/sales-orders/salesOrderDetailClient.ts` + `SalesOrderTributosTab.tsx` / `SalesOrderDetailDialog.tsx` — denied explícito (A3)

**Fase B (condicional):** principalmente `src/lib/finance/orderFullAuditService.ts`.

---

## 8. Testes necessários

### Fase A

- Gate: SUPER_ADMIN / bag `["sales_orders.view"]` → **libera** fiscal (ou denied FE coerente — nunca empty genérico com FE apto).
- Gate: bag com `detail.view` ou `invoice.view` → libera (regressão).
- Gate: bag só `sales_orders.view` + FE sem bypass → denied alinhado FE/BE.
- Rota/detail: `userContext` usa `effectivePermissions` (ou equivalente) — assert de fonte no teste de contrato.
- UI: `fiscalTaxes == null` + `denied` → mensagem de permissão; empty só para falha real de carga / contrato.
- Regressão: `buildSalesOrderFiscalTaxesPayload` com 0 NF → objeto + `no-nfe` (já coberto em parte).

### Fase B (se entrar)

- O2C com `nfeExternalId` positivo e sem `SalesOrderNfeLink` → NF em `audit.nfes` e lookup `NomusNfe`.
- Stock doc com `idNfe` ligado ao pedido → idem.
- Surrogate negativo não usado quando id real existe.
- Cancelada continua em `cancelledNfes`.

---

## 9. Consultas / checks read-only no servidor (depois)

Ordem sugerida — **somente leitura**:

1. **API com o usuário que vê o empty**  
   `GET /api/sales-orders/{id}/detail`  
   - `fiscalTaxes === null`?  
   - Comparar `/api/auth/me`: `role`, `permissions`, `effectivePermissions`.

2. **BagUser**  
   ```sql
   SELECT id, email, role, permissions, "permissionsVersion"
   FROM "AppUser" WHERE email = :email;
   ```  
   Verificar se `permissions` tem `sales_orders.*` sem `detail.view`/`invoice.view`.

3. **Pedido (ex. PD 02781 — ids reais só após SELECT)**  
   - `SalesOrder` + `SalesOrderNfeLink`  
   - `OrderToCashAuditFact` (`nfeExternalId`, `nfeNumber`, `stockDocumentExternalId`)  
   - `NomusStockDocument.idNfe`  
   - `NomusNfe` + `NomusNfeFiscalSummary` + `NomusNfeTaxLine`

4. **Logs**  
   - `getOrderFullAudit fiscalTaxes`  
   - `GET /api/sales-orders/:salesOrderId/detail`

Decisão pós-probe:

- Se `fiscalTaxes: null` e bag confirma P0 → implementar **só Fase A**.  
- Se `fiscalTaxes` objeto e `nfes.length === 0` (ou surrogates) → **Fase B** com evidência de vínculo.  
- Se há NF + summary e UI ainda empty → reabrir (não esperado pelo código atual).

---

## 10. Ordem de execução recomendada

1. Confirmar P0 no servidor (API + bag do usuário) — sem alterar código de produção além do necessário na Fase A.  
2. Implementar Fase A + testes.  
3. Revalidar PD 02781 (ou pedido âncora).  
4. Só então Fase B, se o empty tiver virado no-nfe / ausência de NF no audit.

---

## 11. Fora de escopo desta correção

- Redesign da aba Tributos / layout  
- Recalcular impostos por alíquota  
- Mudar regras de CR / settlements além do já lido  
- Inventar dados do PD 02781  
- Unificar Output Documents (DS-01) como fonte da aba
