# OP-29 — Runbook operacional, implantação e rollback (Cadeia de Suprimentos — Fase 1)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | OP-29 |
| **Atualizado** | 2026-07-22 |
| **Status** | Documentação operacional final da **fase 1** |
| **Cadeado** | `.cursor/rules/supply-chain-guardrails.mdc` (OP-00) |
| **Arquitetura** | `docs/supply-chain/parallel-domain-architecture.md` (OP-02) |
| **Auditoria de estado** | `docs/supply-chain/current-state-audit.md` (OP-01) |
| **Validação E2E** | `npm run test:supply-chain:e2e` (OP-28) |

> **Este documento descreve operação e implantação para ambientes autorizados.**  
> O Cursor / agentes locais **não** executam deploy, migrate ou alteração em produção e **não** possuem acesso confiável ao banco de produção.

---

## 0. Aviso permanente — sem retroalimentação automática

Na fase 1 **não existe** retroalimentação automática da Cadeia de Suprimentos para:

| Domínio oficial | O que **não** acontece |
|-----------------|------------------------|
| Custo publicado / tabelas de custo | SC **não** atualiza `MaterialCostTable*`, `ProductionCostTable*`, custo de produto |
| BOM / engenharia | SC **não** altera `ProductBOM`, componentes ou decisões Nomus BOM |
| Precificação | SC **não** altera preço de venda / tabelas comerciais publicadas |
| Financeiro / Contas a Pagar | Recebimento e PO **não** criam títulos AP (`createsAccountsPayable: false` no histórico) |
| Nomus (estoque, NFe, OP, syncs) | SC **não** escreve syncs nem estoque Nomus (`writesNomus` / `writesNomusStock: false`) |
| Pedidos de venda / comissões | SC **não** muta `SalesOrder*` nem motores de comissão |
| Cadastros oficiais | Sem cadastro paralelo de Material, Product, fornecedor, CC financeiro ou OP |

Evidência no código (metadados de histórico / serviços):

- `src/lib/purchasing/purchaseReceiptService.server.ts` — `createsAccountsPayable: false`, `writesNomus(Stock): false`, `updatesPublishedCost: false`
- `src/lib/purchasing/purchaseOrderService.server.ts` — PO sem AP e sem movimento de estoque na emissão
- Barreira técnica: `src/lib/supply-chain/officialEngineBoundary.ts` + `officialEngineWriteGuard.ts`
- Integrações cross-módulo de estoque: `INVENTORY_INTEGRATIONS_ENABLED = false` (`inventoryIntegrationTypes.ts`)

Qualquer ponte futura exige **escopo, auditoria e autorização explícitos** (fora desta fase).

---

## 1. Arquitetura (fase 1)

```text
┌──────────────────────────────────────────────────────────────┐
│  MOTORES OFICIAIS — somente LEITURA pela SC                  │
│  Material · Product · ProductBOM · MI · SalesOrder           │
│  FinancialSupplier · FinancialCostCenter · AP Nomus          │
│  Nomus stock docs / NFe / OP / syncs · custos · preços       │
└────────────────────────────┬─────────────────────────────────┘
                             │ IDs / adapters read-only
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  DOMÍNIO SC — dono de ESCRITA                                │
│  Almoxarifado / locais / itens logísticos                    │
│  Movimentos · saldos · reservas · contagens · auditoria      │
│  Solicitação · cotação · rodadas · evidências · adjudicação  │
│  Pedido de compra · recebimento · indicadores · shadow plan  │
└──────────────────────────────────────────────────────────────┘
```

Princípios:

1. **Domínio paralelo** — SC não substitui engenharia, MI, comercial, financeiro ou Nomus.
2. **Saldo local** só muda via ledger (`createInventoryMovement` / estorno dedicado).
3. **Feature flag ≠ permissão** — ambas são necessárias (flag ∧ ACL).
4. **Fail closed** — flag ausente/inválida = módulo/API desligado (HTTP 404 nas rotas guardadas).

Fontes de código: `supplyChainFeatureFlags.ts`, `officialEngineBoundary.ts`, `inventoryService.server.ts`.

---

## 2. Fontes oficiais (consumo read-only)

| Necessidade | Fonte oficial | Como a SC consome |
|-------------|---------------|-------------------|
| Matéria-prima | `Material` | FK / snapshot no vínculo de item; elegibilidade em `inventoryMaterialLinkRules` |
| Produto / BOM | `Product`, `ProductBOM` | Leitura (ex.: planejamento sombra); **sem write** |
| Fornecedor | `FinancialSupplier` | ID oficial em cotação / PO |
| CC operacional | `CostCenter` | Escopo ops SC |
| CC financeiro / AP | `FinancialCostCenter`, `NomusAccountsPayable` | Leitura / vínculo futuro — **sem lançamento** |
| Demanda / OP | `SalesOrder*`, `NomusProductionOrder` | Leitura auxiliar (shadow planning) |
| Mercado (MI) | `MaterialMarketQuote*` | Contexto; **≠** cotação SC |
| Estoque Nomus | `NomusStockDocument*` | Auditoria; **≠** `InventoryBalance` |
| NF-e | `NomusNfe*` | Leitura; **≠** recebimento físico SC |

Adapters / contratos: `src/lib/supply-chain/officialEngineReadAdapters.server.ts`, `officialEngineReadOnlyContracts.ts`.

---

## 3. Limites de escrita

### 3.1 SC pode escrever

- `InventoryWarehouse`, `InventoryLocation`, `InventoryItem` (vínculo a MP/produto oficial)
- `InventoryMovement` (append-only) + `InventoryBalance` (somente via movimento / rebuild)
- `InventoryReservation`, bloqueios, quarentena, contagens, `InventoryAuditLog`
- `PurchaseRequest*` (workflow)
- Cotação SC, ofertas, rodadas de negociação, evidências, adjudicação
- `PurchaseOrder*`, `PurchaseReceipt*` (+ linhas / histórico operacional)
- Indicadores e planejamento sombra (cálculo / rascunhos SC — sem mutar oficiais)

### 3.2 SC não pode escrever (protegidos)

Lista canônica em `OFFICIAL_ENGINE_PROTECTED_PRISMA_MODELS` (`officialEngineBoundary.ts`), incluindo entre outros:

`material`, `product`, `productBOM`, tabelas de custo/preço, quotes MI, `salesOrder*`, `nomusProductionOrder*`, `nomusAccountsPayable`, `financialSupplier` (mutação), `nomusStockDocument*`, `nomusNfe`, comissões, etc.

Métodos proibidos nos proxies: `create` / `update` / `upsert` / `delete` / `deleteMany` / `updateMany` / `createMany` (conforme boundary).

### 3.3 Kill switch de integrações de estoque

```ts
// src/lib/inventory/inventoryIntegrationTypes.ts
export const INVENTORY_INTEGRATIONS_ENABLED = false as const;
```

Mantém orquestrações cross-módulo (BOM→estoque, NFe→estoque, etc.) **desligadas** nesta fase. O recebimento SC posta movimento **próprio** (`PURCHASE_RECEIPT`) no ledger local — não ativa esse kill switch de integrações genéricas.

---

## 4. Feature flags

Arquivo: `src/lib/supply-chain/supplyChainFeatureFlags.ts`

| Recurso conceitual | Variável de ambiente | Default |
|--------------------|----------------------|---------|
| Compras SC | `SUPPLY_CHAIN_PURCHASES_MODULE_ENABLED` | **off** |
| Estoque SC (casca) | `SUPPLY_CHAIN_INVENTORY_MODULE_ENABLED` | **off** |
| Recebimento SC | `SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED` | **off** |
| Planejamento sombra | `SUPPLY_CHAIN_SHADOW_PLANNING_ENABLED` | **off** |
| Indicadores executivos | `SUPPLY_CHAIN_INDICATORS_ENABLED` | **off** |

**Valores que ligam:** `1`, `true`, `yes`, `on`, `enabled` (case-insensitive, trim).  
Ausente / outro valor ⇒ desligado (`defaultWhenAbsent: false`).

**Efeito com flag off:**

- Menu / casca SC ocultos (`canShowSupplyChainModuleNavigation` exige flag ∧ view).
- Guards `requireSupplyChainModuleEnabled` / `requireEnvFlagEnabled` respondem **404** `{ error: "API route not found" }`.

**Consulta admin (somente leitura):** `GET /api/settings/system/supply-chain/status`  
**Status cliente:** `GET /api/supply-chain/feature-status` (via `supplyChainClient.ts`).

> Nomes antigos em rascunhos de arquitetura (`SUPPLY_CHAIN_QUOTATION_ENABLED`, etc.) **não** são as env vars oficiais — use a tabela acima.

---

## 5. Migrations (aditivas)

Ordem cronológica sob `prisma/migrations/` (fase SC / inventory / purchasing):

| # | Migration |
|---|-----------|
| 1 | `20260410120000_purchases_block1` |
| 2 | `20260410180000_purchases_block2_mp_context` |
| 3 | `20260627120000_inventory_module_base` |
| 4 | `20260804120000_inventory_additive_warehouse_ledger` |
| 5 | `20260804130000_inventory_locations_hierarchy` |
| 6 | `20260804140000_inventory_official_material_link` |
| 7 | `20260804150000_inventory_movement_ledger_idempotency` |
| 8 | `20260805120000_inventory_initial_balance` |
| 9 | `20260806120000_inventory_reservations_blocks_quarantine` |
| 10 | `20260807120000_purchasing_additive_domain` |
| 11 | `20260808120000_purchase_request_workflow` |
| 12 | `20260809120000_purchase_quotation_collection` |
| 13 | `20260810120000_purchase_negotiation_rounds_savings` |
| 14 | `20260811120000_purchase_negotiation_evidence_trail` |
| 15 | `20260812120000_purchase_quotation_comparison` |
| 16 | `20260813120000_purchase_quotation_award_approval` |
| 17 | `20260814120000_purchase_order_formal` |
| 18 | `20260815120000_purchase_receipt_ledger` |

**Regra:** somente aditivas. **Não** dropar / renomear estruturas oficiais.  
**Rollback de schema:** não reverter com DROP em produção; isolar por feature flags (ver § Rollback).

*Nota:* `20260721130000_material_market_purchase_link` é vínculo MI↔compra (mercado), não ledger SC.

---

## 6. Ordem de deploy (ambiente autorizado)

O agente **não** executa estes passos. Operador no host:

1. **Backup** do PostgreSQL + working tree limpa no release aprovado.
2. Deploy do artefato (código) **com todas as flags SC em off**.
3. `npx prisma migrate deploy` (migrations aditivas da tabela §5).
4. `npx prisma generate` se necessário no pipeline do host.
5. Restart do serviço (`systemctl` / `pm2` conforme o ambiente).
6. Smoke **com flags off**: APIs SC/receiving/shadow/indicators devem 404; inventory legado conforme ACL.
7. Conceder permissões granulares aos usuários piloto (ver §7).
8. Criar almoxarifado + locais + vínculos MP + saldo inicial (ver §§8–10) **ainda com compras/recebimento off se desejado**.
9. Ligar flags **nessa ordem** no piloto:
   1. `SUPPLY_CHAIN_INVENTORY_MODULE_ENABLED` (se usar casca `/supply-chain/inventory`)
   2. `SUPPLY_CHAIN_PURCHASES_MODULE_ENABLED`
   3. `SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED`
   4. Opcional: `SUPPLY_CHAIN_INDICATORS_ENABLED`
   5. Opcional: `SUPPLY_CHAIN_SHADOW_PLANNING_ENABLED`
10. Validar fluxo piloto: solicitação → cotação → negociação → evidência → aprovação → PO → recebimento parcial/final → saldo → ganho realizado (matriz OP-28).
11. Só então expandir usuários / almoxarifados.

Exemplo de env (piloto):

```bash
# fail closed — omitir ou false = off
SUPPLY_CHAIN_INVENTORY_MODULE_ENABLED=true
SUPPLY_CHAIN_PURCHASES_MODULE_ENABLED=true
SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED=true
# SUPPLY_CHAIN_INDICATORS_ENABLED=true
# SUPPLY_CHAIN_SHADOW_PLANNING_ENABLED=true
```

---

## 7. Permissões

Permissão **≠** feature flag. Ambos são necessários para UI/API úteis.

### 7.1 Cascas SC (`operations.supply_chain.*`)

| Módulo | View (contrato) | Path UI |
|--------|-----------------|---------|
| Compras | `operations.supply_chain.purchases.view` | `/supply-chain/purchases` |
| Estoque | `operations.supply_chain.inventory.view` | `/supply-chain/inventory` |
| Recebimento | `operations.supply_chain.receiving.view` | `/supply-chain/receiving` |

Helpers: `src/lib/supply-chain/supplyChainAccess.ts`.

### 7.2 Compras (legado + contrato)

| Ação | Chaves típicas |
|------|----------------|
| Ver | `purchases.view`, `operations.purchases.view` |
| Criar / editar | `purchases.create` / `purchases.edit`, `operations.purchases.create` / `.update` |
| Aprovar / exceção de evidência | `purchases.approve`, `operations.purchases.approve` |
| Indicadores (legado) | `purchases.indicators.view` (catálogo; UI também gated por flag indicators) |

**Importante (OP-27):** `purchases.view` **não** concede approve nem exceção de evidência. Body `useException: true` **não** auto-autoriza — só `effectivePermissions` reais.

### 7.3 Estoque / recebimento

| Ação | Chaves |
|------|--------|
| Ver estoque | `inventory.view` |
| Almoxarifado / item | `inventory.warehouse.manage`, `inventory.item.manage` (+ `inventory.manage` onde aplicável) |
| Movimento / recebimento postando estoque | `inventory.movement.create`, `inventory.movements.create`, `operations.inventory.movements.create` |
| Saldo inicial / ajuste | `inventory.adjustment.create` (+ movement conforme serviço) |
| Auditoria | `inventory.audit.view` |
| Rebuild de saldos | permissões de manage/adjustment conforme rota |

### 7.4 Matriz de personas (referência)

`PURCHASING_PERSONA_MATRIX` em `src/lib/purchasing/purchasingSecurity.ts`:

| Persona | Approve | Exceção evidência | Confirmar/estornar recebimento c/ estoque |
|---------|---------|-------------------|-------------------------------------------|
| `viewer_compras` | não | não | não |
| `analista_compras` | não | não | não |
| `aprovador_compras` | sim | sim | **não** (falta movement.create) |
| `recebedor_estoque` | sim | sim | **sim** |
| `sem_compras` | não | não | não |

---

## 8. Criação de almoxarifado

1. Flag inventory / ACL de warehouse.
2. UI: `/inventory/warehouses` (ou casca `/supply-chain/inventory`).
3. API: prefixo `/api/inventory/warehouses` (+ locais `/api/inventory/locations`).
4. Hierarquia de locais: migration `…_inventory_locations_hierarchy`; regras em `inventoryLocationRules.ts`.
5. Definir políticas (permite reserva/bloqueio etc.) conforme cadastro do warehouse.

Não criar “estoque Nomus” como almoxarifado IndusCost.

---

## 9. Ativação de matérias-primas (vínculo logístico)

1. MP deve existir e estar **ativa** no cadastro oficial (`Material`).
2. UI: itens de estoque → vínculo oficial (`InventoryMaterialLinkSheet` / `/inventory/items`).
3. Regras: `assertOfficialMaterialEligibleForStock`, `assertNoActiveMaterialDuplicate` (`inventoryMaterialLinkRules.ts`).
4. Snapshots (`materialCodeSnapshot`, etc.) são **cópia histórica** — a fonte de verdade do cadastro continua oficial.
5. **Proibido:** criar segundo Material paralelo só para estoque.

API auxiliar: `/api/inventory/official-materials` (leitura).

---

## 10. Saldo inicial

1. UI: `/inventory/implantation`.
2. API: `POST /api/inventory/initial-balances` → `createInitialInventoryBalance`.
3. Sempre gera movimento `INITIAL_BALANCE` (não preenche saldo “na mão”).
4. Idempotência / escopo: `inventoryInitialBalance.ts` (`INITIAL_BALANCE_DUPLICATE`, `INITIAL_BALANCE_SCOPE_NOT_EMPTY`).
5. Relatório: `GET /api/inventory/initial-balances/report`.

---

## 11. Solicitação de compra

1. Flag purchases + `purchases.create` / view.
2. UI: `/purchases`, workstation `/purchases/workstation`.
3. Workflow puro: `purchaseRequestWorkflow.ts`  
   `RASCUNHO` → `SUBMIT` → `AGUARDANDO_APROVACAO` → `APPROVE` → `ABERTA` → `FORWARD_TO_QUOTATION` → `EM_COTACAO`.
4. Itens referenciam `materialId` oficial (sem cadastro paralelo).
5. Refs oficiais read-only: `/api/purchase-requests/official-refs/*`.

---

## 12. Cotação

1. Coleta SC (≠ MI): status `RASCUNHO` → `ENVIADA` → `EM_ANALISE` (`purchaseQuotationWorkflow.ts`).
2. APIs: `/api/purchase-quotations` (+ ofertas, comparison).
3. Oferta inicial congelada após início de negociação (`canEditInitialOffer`).

---

## 13. Negociação

1. Rodadas + ganho comparável: `negotiationSavingsEngine.ts` / migration `…_purchase_negotiation_rounds_savings`.
2. Custo comparável = itens + frete (se não CIF) + impostos não recuperáveis + despesas − descontos.
3. Prazo/pagamento/lote/garantia entram como **condition gains**, não como dinheiro inventado.
4. `costIncreased: true` quando o negociado fica pior que o inicial (cenário coberto na matriz OP-28).

---

## 14. Evidências

1. Upload: `uploadPurchaseEvidence` → `saveAppLocalFile` (`appLocalFileStorage.ts`).
2. Disco: `data/uploads/` ou `APP_UPLOADS_DIR`; namespaces por entidade (`purchase-requests`, `purchase-quotations`, `purchase-orders`, `purchase-receipts`, …).
3. Limite: `PURCHASE_EVIDENCE_MAX_BYTES` (15 MB).
4. Segurança (OP-27): MIME ∩ extensão obrigatórios; download anti-IDOR; soft-delete com motivo.
5. APIs: `/api/purchase-evidences` (+ download).
6. Adjudicação exige evidência ativa **ou** exceção com `purchases.approve` + justificativa (≥ 10 chars).

---

## 15. Aprovação (adjudicação)

1. Motor: `quotationAwardEngine.ts` / `validateAwardPackage`.
2. Status de cotação apto; rodada aberta bloqueia; duplicidade → `AWARD_EXISTS`.
3. Modo `SINGLE` ou `SPLIT`; fornecedor alternativo = alocar outro `offerId`.
4. Somente adjudicação **APROVADA** gera PO (`assertAwardApprovedForPo`).
5. Permissão: `purchases.approve` / `operations.purchases.approve`.

---

## 16. Pedido de compra

1. APIs: `/api/purchase-orders`.
2. Workflow: `purchaseOrderWorkflow.ts` — `RASCUNHO` → `APPROVE` → `SEND` → `CONFIRM` → recebimentos → `PARCIALMENTE_RECEBIDO` / `RECEBIDO`.
3. **Não** cria Contas a Pagar nem movimento de estoque na emissão do PO.
4. UI: `/purchases/orders`, savings `/purchases/orders/:orderId/savings`.

---

## 17. Recebimento

1. Flag receiving + permissões de approve/movimento conforme ação.
2. UI: `/purchases/receiving`, `/purchases/receiving/:orderId`.
3. APIs: `/api/purchase-receipts`, `/api/receiving-station`.
4. Fluxo serviço (`purchaseReceiptService.server.ts`):
   - Draft / conferência
   - `confirmPurchaseReceipt` → por linha aceita: `createInventoryMovementInTx(..., "PURCHASE_RECEIPT")`
   - Status receipt → `APROVADO`; PO → parcial/completo via `resolvePurchaseOrderReceiptStatus`
5. Quantidades: aceita + rejeitada ≤ recebida; aceita não pode exceder pendente.
6. **Não** escreve Nomus / AP / custo publicado.

---

## 18. Estorno

1. Receipt: `POST /api/purchase-receipts/:id/reverse` → `reversePurchaseReceipt`.
2. Ledger: `reverseInventoryMovementInTx` gera `REVERSAL` vinculado ao original (**não** apaga o fato).
3. Status do receipt → `ESTORNADO`.
4. Movimento avulso: `POST /api/inventory/movements/:id/reverse`.
5. Duplo estorno / estornar estorno: rejeitado pelas regras do ledger.

---

## 19. Reconstrução de saldos

1. Função: `rebuildInventoryBalancesFromLedger` (`inventoryBalanceRebuild.server.ts`).
2. API: `POST /api/inventory/balances/rebuild`  
   Body típico: `{ itemId?, warehouseId?, dryRun?, reason? }`.
3. Reconstrói a partir do ledger imutável (incluindo `REVERSAL`).
4. Preferir `dryRun: true` antes do apply em incidentes.
5. **Não** há CLI dedicado em `scripts/` para este rebuild (API-only nesta base).

---

## 20. Auditoria

| Camada | Onde |
|--------|------|
| UI estoque | `/inventory/audit` |
| API | `/api/inventory/audit` (e logs de movimento) |
| Histórico compras/recebimento | metaJson nos serviços (flags explícitas de não-write em oficiais) |
| Evidências | hash, storageKey, soft-delete com motivo |
| Barreira estática | `npm run test:supply-chain:official-boundary` |
| Matriz E2E | `npm run test:supply-chain:e2e` |

---

## 21. Indicadores

1. Flag: `SUPPLY_CHAIN_INDICATORS_ENABLED`.
2. API: `GET /api/supply-chain/indicators`.
3. UI: `/purchases/indicators` (`PurchaseIndicatorsDashboard`).
4. Motor: `supplyChainIndicatorsEngine.ts` — cards com base/grain declarados; dedupe monetário por `pipelineKey`; camadas de estoque **não** somadas de forma aditiva ingênua.
5. Planejamento sombra (relacionado, flag própria): `/purchases/shadow-planning`, `GET/POST /api/shadow-purchase-planning` — **não** altera BOM/OP/custo.

---

## 22. Troubleshooting

| Sintoma | Verificação |
|---------|-------------|
| Menu SC / API 404 | Env flag off ou typo; `GET /api/supply-chain/feature-status` |
| Menu some com flag on | Falta `operations.supply_chain.*.view` (flag ∧ permissão) |
| Não aprova / sem exceção evidência | Precisa `purchases.approve`; viewer/analista não bastam; body não concede |
| Confirma recebimento sem estoque | Persona sem `inventory.movement(s).create` |
| `EVIDENCE_REQUIRED` | Anexar evidência ou exceção autorizada + justificativa |
| `AWARD_EXISTS` / `OPEN_ROUND` | Já há adjudicação; fechar rodada e informar `finalRoundId` |
| `ACCEPTANCE_EXCEEDS_PENDING` | Aceite > pedida − já aceita confirmada |
| `MATERIAL_ALREADY_LINKED_ACTIVE` | Inativar vínculo anterior antes de novo item |
| Saldo divergente da UI | `POST /api/inventory/balances/rebuild` com `dryRun` depois apply |
| Upload evidência rejeitado | MIME ∩ extensão; tamanho ≤ 15 MB |
| Esperava AP / Nomus / custo após receipt | **Comportamento correto na fase 1** — não há retroalimentação |

Testes locais úteis:

```bash
npm run test:purchasing
npm run test:inventory
npm run test:supply-chain
npm run test:supply-chain:e2e
```

---

## 23. Rollback

| Camada | Ação | Efeito |
|--------|------|--------|
| **Flags** | Remover/desligar envs SC | UI/API novas → 404; **dados permanecem** |
| **Código** | Reverter release SC | Sem tocar migrations oficiais / motores protegidos |
| **Recebimento postado** | `reverse` → `REVERSAL` + `ESTORNADO` | Corrige saldo; **não** DELETE |
| **Schema** | **Não** DROP migrations aditivas em produção | Isolamento por flag; limpeza de dados só com autorização explícita |
| **Nomus / oficiais** | Nunca “desfazer sync” pela SC | Fora de escopo |
| **Integrações estoque** | Manter `INVENTORY_INTEGRATIONS_ENABLED = false` | Evita orquestrações cross-módulo |

Ordem recomendada de emergência:

1. Desligar `SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED` e `SUPPLY_CHAIN_PURCHASES_MODULE_ENABLED`.
2. Estornar recebimentos indevidos via API de reverse.
3. Rebuild de saldo se necessário (`dryRun` → apply).
4. Comunicar que AP/custo/BOM/Nomus **não** foram alterados pela SC (nada a “desfazer” lá).

---

## 24. Riscos residuais

1. Flags ligadas sem matriz de permissões correta → usuários veem 404 ou ações parciais.
2. Operador pode confundir estoque local com estoque Nomus / DocumentoSaida.
3. Evidências em disco (`APP_UPLOADS_DIR`) exigem backup de filesystem além do DB.
4. Rebuild de saldo mal filtrado em produção — sempre `dryRun` e escopo item/warehouse.
5. Suites npm amplas de precificação/pedidos podem ter asserts estáticos pré-existentes fora do SC (ver OP-28); não confundir com regressão SC.
6. `tsc` global do repositório pode falhar em `scripts/` / `tmp-audits/` legados — validar arquivos do escopo SC.
7. Shadow planning / indicadores são **informativos**; uso operacional sem treinamento pode gerar pedidos manuais inconsistentes (ainda assim sem write oficial).

---

## 25. Explicitamente fora do escopo (fase 1)

- Atualização automática de custo publicado, BOM, preço de venda, estoque Nomus ou Contas a Pagar
- Cadastro paralelo de Material / Product / fornecedor / CC financeiro / OP
- Integrações cross-módulo com `INVENTORY_INTEGRATIONS_ENABLED = true`
- Deploy / migrate / backfill em produção pelo Cursor
- Substituição do módulo de Inteligência de Mercado pela cotação SC
- Contabilidade fiscal / AP gerada pelo recebimento
- Kanban / fluxo comercial de pedidos de venda (domínio separado)
- Drop/rename de tabelas oficiais como “rollback”

---

## 26. Mapa rápido UI ↔ API

| Fluxo | UI | API (prefixo) |
|-------|----|---------------|
| Estoque | `/inventory/*` | `/api/inventory/*` |
| Saldo inicial | `/inventory/implantation` | `/api/inventory/initial-balances` |
| Rebuild saldo | (API / ops) | `POST /api/inventory/balances/rebuild` |
| Solicitações | `/purchases`, workstation | `/api/purchase-requests` |
| Cotação / award | `/purchases/quotations/*` | `/api/purchase-quotations` |
| Evidências | anexos nos módulos | `/api/purchase-evidences` |
| Pedidos | `/purchases/orders/*` | `/api/purchase-orders` |
| Recebimento | `/purchases/receiving/*` | `/api/purchase-receipts`, `/api/receiving-station` |
| Indicadores | `/purchases/indicators` | `/api/supply-chain/indicators` |
| Shadow | `/purchases/shadow-planning` | `/api/shadow-purchase-planning` |
| Cascas SC | `/supply-chain/{purchases,inventory,receiving}` | `/api/supply-chain/*` |
| Status flags | Settings / client | `/api/settings/system/supply-chain/status` |

---

## 27. Revisão contra o código real (checklist OP-29)

| Afirmação | Evidência |
|-----------|-----------|
| Flags fail closed + 5 envs | `supplyChainFeatureFlags.ts` |
| Sem write em oficiais | `officialEngineBoundary.ts`, testes `test:supply-chain:official-boundary` |
| Receipt → `PURCHASE_RECEIPT` (não AP/Nomus/custo) | `purchaseReceiptService.server.ts` |
| Estorno = `REVERSAL` | `inventoryService.server.ts`, `reversePurchaseReceipt` |
| Saldo inicial = movimento | `createInitialInventoryBalance` |
| Rebuild = API | `inventoryBalanceRebuild.server.ts`, `POST .../balances/rebuild` |
| Evidência local + MIME∩ext | `purchaseEvidenceService.server.ts`, `purchasingSecurity.ts` |
| Personas / approve | `PURCHASING_PERSONA_MATRIX` |
| Integrações off | `INVENTORY_INTEGRATIONS_ENABLED = false` |
| Rotas UI | `App.tsx` |
| Migrations listadas | pastas em `prisma/migrations/` (§5) |
| E2E fase 1 | `supplyChainParallelWorkflow.e2e.test.ts` |

Documento irmão de desenho (pode citar nomes históricos de flags/tipos): `parallel-domain-architecture.md`. Em conflito operacional, **prevalece este runbook** + código atual.

---

*Fim OP-29 — documentação operacional final da primeira fase da Cadeia de Suprimentos.*
