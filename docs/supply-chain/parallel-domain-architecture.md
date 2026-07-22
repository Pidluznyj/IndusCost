# Arquitetura paralela — Cadeia de Suprimentos (OP-02)

**Data:** 2026-07-21  
**Status:** decisão arquitetural oficial (fase 1)  
**Cadeado:** `.cursor/rules/supply-chain-guardrails.mdc` (OP-00)  
**Fonte de estado atual:** `docs/supply-chain/current-state-audit.md` (OP-01)  
**Operação / deploy / rollback:** `docs/supply-chain/operations-and-rollback-runbook.md` (OP-29) — prevalece em conflito com nomes históricos deste desenho  
**Escopo deste documento:** desenho apenas — **sem migration**, sem alteração de schema/UI/API neste OP.

---

## 1. Princípio

A Cadeia de Suprimentos (SC) é um **domínio paralelo** que:

1. **Lê** motores oficiais (engenharia, MI, comercial, financeiro, Nomus) sem mutá-los.
2. **Escreve** somente nas estruturas de propriedade SC (almoxarifado local, solicitações, e — aditivamente — cotação SC, PO, recebimento, evidências, indicadores).
3. **Não** cria cadastros paralelos de Material, Product, BOM, fornecedor, CC financeiro ou OP.
4. **Não** atualiza automaticamente custo publicado, BOM, preço, estoque Nomus ou Contas a Pagar.

Saldo local **só** muda via `createInventoryMovement` (`src/lib/inventory/inventoryService.server.ts`). Integrações cross-módulo permanecem **desligadas** (`INVENTORY_INTEGRATIONS_ENABLED = false`).

---

## 2. Limites: domínio oficial × domínio SC

```text
┌─────────────────────────────────────────────────────────────┐
│  DOMÍNIO OFICIAL (read-only para SC fase 1)                 │
│  Material · Product · ProductBOM · MI quotes · SalesOrder   │
│  Comissões · AP · FinancialSupplier · FinancialCostCenter   │
│  Nomus syncs (stock docs, NFe, OP, products/BOM)            │
└──────────────────────────┬──────────────────────────────────┘
                           │ contratos read-only / IDs
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  DOMÍNIO SC (dono de escrita)                               │
│  CostCenter (ops) · PurchaseRequest*                        │
│  Inventory* (item/warehouse/location/balance/movement/…)    │
│  [novo aditivo] Cotação SC · PO · Recebimento · Anexos SC   │
│  Indicadores SC · eventos de integração (sem consumidores)  │
└─────────────────────────────────────────────────────────────┘
```

| Limite | Regra |
|--------|--------|
| Identidade de MP/produto | FK/ID oficial; `InventoryItem` e linhas de SC referenciam, não duplicam |
| Preço de mercado (MI) | Fora do fluxo de compra; SC não escreve `MaterialMarketQuote*` |
| Fornecedor | Sempre `FinancialSupplier.id` (e aliases Nomus se leitura auxiliar) |
| CC operacional compras/estoque | `CostCenter` (dono SC/ops) |
| CC financeiro / AP | `FinancialCostCenter` — só leitura/vínculo futuro; nunca confundir com `CostCenter` |
| Estoque Nomus / DocumentoSaida | Stage de auditoria; **não** é saldo de almoxarifado IndusCost |
| NF-e entrada Nomus | Leitura auxiliar; **não** substitui recebimento físico SC |
| Saldo físico local | Exclusivo de `InventoryBalance` + movimentos |

---

## 3. Matriz de leitura e escrita por entidade

Legenda: **R** = leitura permitida à SC · **W** = escrita dono SC · **—** = fora / proibido · **soft** = campo string/UUID sem FK rígida hoje.

| Entidade | SC R | SC W | Observação |
|----------|------|------|------------|
| `Material` | R | — | Via `PurchaseRequestItem.materialId` |
| `Product` / `ProductBOM` | R | — | Via `InventoryItem.productId` / explosão futura read-only |
| `MaterialMarketQuote*` | R* | — | *Só se UI de contexto; **não** é cotação SC |
| `SalesOrder*` | R | — | Soft refs em movimento/reserva futuras |
| `FinancialSupplier` | R | — | Identidade de fornecedor no PO/cotação |
| `FinancialCostCenter` / AP | R | — | Sem lançamento AP pela SC |
| `NomusStockDocument*` / `NomusNfe*` / OP | R | — | Cruzamento; não mutar sync |
| `CostCenter` | R | W | Cadastro ops compras/estoque |
| `PurchaseRequest` / `Item` | R | W | Demanda SC existente |
| `InventoryItem` | R | W | Catálogo logístico; link a Product |
| `InventoryWarehouse` / `Location` | R | W | Almoxarifado local |
| `InventoryBalance` | R | W** | **Somente via movimento |
| `InventoryMovement` | R | W*** | ***Append-only + estorno; sem update/delete de fato |
| `InventoryReservation` | R | W | API existe; completar UI |
| `InventoryCount*` / `AuditLog` | R | W | Já no módulo |
| **PurchaseQuotation*** (novo) | R | W | Cotação/rodada SC (≠ MI) |
| **PurchaseOrder*** (novo) | R | W | Formaliza `purchaseOrderId` soft |
| **GoodsReceipt*** (novo) | R | W | Único gerador autorizado de `PURCHASE_ENTRY` via integração SC |
| Anexos SC (novo, padrão MI) | R | W | `appLocalFileStorage` + `storageKey` |

\* Nomes lógicos; schema definitivo em OP de modelo aditivo.

---

## 4. Fontes oficiais

| Necessidade | Fonte oficial | Consumo SC |
|-------------|---------------|------------|
| MP / engenharia | `Material`, `Product` | Read / FK |
| Estrutura | `ProductBOM` (+ stage Nomus para auditoria) | Read |
| Fornecedor | `FinancialSupplier` (+ aliases) | Read / link |
| CC financeiro | `FinancialCostCenter` | Read (futuro) |
| CC operacional | `CostCenter` | R/W no escopo SC |
| Doc. estoque Nomus | `NomusStockDocument` | Read (tipo default saída) |
| NF-e | `NomusNfe` | Read; não = recebimento |
| OP | `NomusProductionOrder` | Read |
| AP | `NomusAccountsPayable` | Read |
| Saldo local | `InventoryBalance` | Dono SC |
| Demanda compra | `PurchaseRequest*` | Dono SC |
| Cotação mercado | `MaterialMarketQuote*` | Fora do fluxo SC |

---

## 5. Contratos read-only necessários

Contratos a extrair/manter **sem write** nos oficiais (libs tipadas; sem Prisma write nos handlers SC):

| Contrato | Propósito | Base atual |
|----------|-----------|------------|
| `OfficialMaterialReader` | Lookup MP por id/código | queries materials existentes |
| `OfficialProductBomReader` | Produto + componentes BOM | products/BOM APIs |
| `OfficialSupplierReader` | Fornecedor financeiro + aliases | `financeSuppliersRoutes` / repo |
| `OfficialCostCenterOpsReader` | Lista `CostCenter` ativos | purchases cost-centers |
| `OfficialNomusStockDocReader` | Cruzar documento Nomus (auditoria) | stage `NomusStockDocument` |
| `OfficialNomusNfeReader` | Cruzar NF-e (número, fornecedor) | `NomusNfe` |
| `OfficialProductionOrderReader` | Contexto OP para reserva futura | production-orders API |
| `InventoryMovementIntegrationContract` | Payload tipado para movimentos | já em `inventoryIntegrationTypes.ts` |
| `InventoryDemandProjection` | Demanda planejada (conceitual) | `inventoryDemandProjectionTypes.ts` |

Regras dos contratos:

- Retornam DTOs imutáveis (snapshot no momento da leitura).
- Não expõem `prisma.*.update/create/delete` de entidades protegidas.
- Snapshots históricos de SC (PO/recebimento) **copiam** campos denormalizados necessários à auditoria; a fonte de verdade do cadastro continua oficial.

---

## 6. Reaproveitar vs criar

### 6.1 Reaproveitar (obrigatório — evitar tabela paralela)

| Estrutura | Motivo |
|-----------|--------|
| Stack `Inventory*` completa | Schema + API + UI + testes; soft refs PO/NFe/OP já no movimento |
| `InventoryReservation` | Backend pronto; UI `comingSoon` — completar, não duplicar |
| `PurchaseRequest*` + enums PT | Porta de demanda; estender status só se necessário e aditivo |
| `CostCenter` (ops) | Já ligado a SC e movimentos |
| Soft refs `purchaseOrderId`, `nfeId`, … | Preencher quando PO/recebimento existirem |
| `FinancialSupplier` (ID) | Sem cadastro fornecedor SC |
| Padrão anexos MI + `appLocalFileStorage` | Template de evidências |
| `INVENTORY_INTEGRATIONS_ENABLED` | Gate até orquestração madura |
| Flag pattern `salesOrderFlowFeatureFlags.ts` | Env fail-closed + 404 + nav ∩ permissão |

### 6.2 Criar (aditivo — só o que não existe)

| Entidade lógica | Por quê não reusar outra |
|-----------------|--------------------------|
| Cotação / rodada SC + itens + ofertas | `MaterialMarketQuote*` é MI/preço, governança distinta |
| Pedido de compra (PO) + itens | Soft `purchaseOrderId` sem modelo formal (OP-01) |
| Recebimento / conferência + linhas | Não há goods receipt; NFe entrada ≠ conferência física |
| Anexo SC (polimórfico ou por entidade) | Não existe namespace SC; copiar padrão MI |

### 6.3 Não reutilizar como dono SC

`MaterialMarketQuote*` como RFQ · `ProductBOM_backup_*` · mutação Material/Product/BOM · billing/NFe entrada como recebimento · `FinancialCostCenter` como se fosse `CostCenter` · DocumentoSaida como entrada · fleet attachments.

---

## 7. Estados de ciclo de vida

### 7.1 Solicitações (`PurchaseRequest` — existente)

| Status | Significado | Transições típicas |
|--------|-------------|--------------------|
| `RASCUNHO` | Edição | → `ABERTA`, `CANCELADA` |
| `ABERTA` | Demanda válida | → cotação/PO (futuro), `ENCERRADA`, `CANCELADA` |
| `CANCELADA` | Terminal | — |
| `ENCERRADA` | Atendida/fechada | — |

Linha (`PurchaseItemLineStatus`): `ABERTA` | `CANCELADA`.  
Prioridade: `BAIXA` | `NORMAL` | `ALTA` | `URGENTE`.  
Tipo linha: `MATERIA_PRIMA` | `INDIRETO`.

**Extensão futura (aditiva, se necessária):** status intermediários (`EM_COTACAO`, `PEDIDO_PARCIAL`) via enum Prisma aditivo — sem remover valores atuais.

### 7.2 Cotações SC (novo — proposto)

| Status | Significado |
|--------|-------------|
| `RASCUNHO` | Montagem da rodada |
| `ENVIADA` | Em coleta de ofertas |
| `EM_ANALISE` | Comparação |
| `ADJUDICADA` | Fornecedor/itens escolhidos |
| `CANCELADA` | Terminal |
| `EXPIRADA` | Terminal por prazo |

Oferta por fornecedor: `RECEBIDA` | `DESCARTADA` | `VENCEDORA`.

### 7.3 Pedidos de compra (novo — proposto)

| Status | Significado |
|--------|-------------|
| `RASCUNHO` | Pré-emissão |
| `EMITIDO` | Enviado ao fornecedor |
| `CONFIRMADO` | Aceite fornecedor |
| `PARCIALMENTE_RECEBIDO` | Recebimento parcial |
| `RECEBIDO` | Quantidade completa |
| `CANCELADO` | Terminal |
| `ENCERRADO` | Fechamento administrativo |

**Invariante:** PO aprovado/emitido **não** aumenta estoque (doc. integrações L16–17).

### 7.4 Recebimentos (novo — proposto)

| Status | Significado |
|--------|-------------|
| `RASCUNHO` | Pré-conferência |
| `EM_CONFERENCIA` | Contagem física |
| `DIVERGENTE` | Aguarda decisão (falta/sobra/qualidade) |
| `APROVADO` | Conferência OK |
| `ESTORNADO` | Estorno do recebimento (gera REVERSAL do movimento) |
| `CANCELADO` | Terminal sem entrada |

**Invariante:** somente recebimento **aprovado** dispara `PURCHASE_ENTRY` via `createInventoryMovement` (quando integração SC→estoque estiver habilitada no orquestrador).

---

## 8. Invariantes de estoque

Alinhados ao código (`inventoryBalanceMath.ts`, `inventoryMovementRules.ts`, `inventoryService.server.ts`, `docs/inventory-future-integrations.md`):

1. Saldo **nunca** é editado diretamente — só via `createInventoryMovement`.
2. Quantidade de movimento `> 0`.
3. Físico não fica negativo (salvo contexto explícito `allowNegativeStock`).
4. `UNBLOCK` ≤ `blockedQuantity`; `CANCEL_RESERVATION` ≤ `reservedQuantity`.
5. Saídas de tipos que exigem CC (`ADMINISTRATIVE_SUPPLY`, etc.) → `costCenterId` obrigatório.
6. Transferência exige origem ≠ destino (warehouse/location).
7. `REVERSAL` só a partir do movimento original (`resolveReversalImpact`).
8. PO / PV / OP / BOM **não** movimentam sozinhos; qualidade bloqueia sem alterar físico diretamente.
9. `assertBalanceFormula` deve sempre passar após normalização.

---

## 9. Movimentações imutáveis e estornos

| Regra | Detalhe |
|-------|---------|
| Append-only | `InventoryMovement` não tem `updatedAt` de negócio; fato não é “corrigido” in-place |
| Snapshots no movimento | Campos `previous*Balance` / `next*Balance` (físico, reservado, bloqueado, quarentena, disponível) |
| Estorno | Novo movimento `REVERSAL` ligado por `reversedMovementId`; impacto = inverso do original |
| Duplo estorno | Proibido estornar movimento já estornado (garantir no serviço) |
| Recebimento estornado | Status `ESTORNADO` + `REVERSAL` do `PURCHASE_ENTRY` correspondente |
| Contagem | Ajustes via `POSITIVE_ADJUSTMENT` / `NEGATIVE_ADJUSTMENT`, nunca patch de saldo |

---

## 10. Saldos: físico, reservado, bloqueado, disponível

Campos em `InventoryBalance` (schema L5345–5370):

| Campo | Papel |
|-------|--------|
| `physicalQuantity` | Quantidade física |
| `reservedQuantity` | Comprometida por reserva ativa |
| `blockedQuantity` | Bloqueio (ex.: qualidade) |
| `quarantineQuantity` | Quarentena (campo já existe; movimento dedicado futuro) |
| `availableQuantity` | Derivado |

**Fórmula oficial** (`calculateAvailableBalance` em `inventoryTypes.ts`):

```text
available = physical − reserved − blocked − quarantine
```

Impactos por tipo (`resolveMovementImpact`):

| Tipo | Físico | Reservado | Bloqueado |
|------|--------|-----------|-----------|
| Entradas (`MANUAL_ENTRY`, `PURCHASE_ENTRY`, `PRODUCTION_ENTRY`, `RETURN`, `POSITIVE_ADJUSTMENT`) | + | — | — |
| Saídas / perda / scrap / ajuste − | − | — | — |
| `TRANSFER` (origem) | − | — | — |
| `BLOCK` / `UNBLOCK` | — | — | + / − |
| `RESERVE` / `CANCEL_RESERVATION` | — | + / − | — |
| `REVERSAL` | inverso do original | | |

---

## 11. Snapshots históricos

| Onde | O quê | Por quê |
|------|-------|---------|
| `InventoryMovement` | Saldos before/after | Auditoria imutável do fato |
| Cabeçalho/itens de PO e recebimento (futuro) | Código/descrição/unidade/preço/fornecedor **copiados** no momento | Documento logístico não muda se cadastro oficial mudar depois |
| Cotação adjudicado | Snapshot da oferta vencedora | Rastreio de decisão |
| Não fazer | Segunda tabela “Material2” / “Product2” | Viola OP-00 §4 |

Snapshots **não** são fonte de verdade do cadastro — só do fato SC.

---

## 12. Feature flags

Padrão IndusCost (espelhar `salesOrderFlowFeatureFlags.ts`): **fail-closed**, env server-side, rota 404 se off, nav = flag ∧ permissão. Permissão ≠ flag.

| Flag (proposta) | Env (proposta) | Controla | Default |
|-----------------|----------------|----------|---------|
| (existente) Integrações estoque | `INVENTORY_INTEGRATIONS_ENABLED` const `false` | Orquestração cross-módulo | **off** |
| SC cotação UI/API | `SUPPLY_CHAIN_QUOTATION_ENABLED` | Rotas/menu cotação | **off** |
| SC pedido de compra | `SUPPLY_CHAIN_PURCHASE_ORDER_ENABLED` | Rotas/menu PO | **off** |
| SC recebimento | `SUPPLY_CHAIN_RECEIVING_ENABLED` | Rotas/menu recebimento | **off** |
| SC → estoque (orquestrador) | flag dedicada **além** da const inventory | Só o adaptador compras→`PURCHASE_ENTRY` | **off** até piloto estável |

Ativar `INVENTORY_INTEGRATIONS_ENABLED` **somente** no orquestrador, após recebimento testado — nunca no core de saldo.

---

## 13. Permissões

Base existente (`permissionsClient.ts`):

- `operations.purchases`
- `operations.inventory` (+ `.items`, `.warehouses`, `.movements`, `.counts`)
- `finance.suppliers` (leitura fornecedor)
- Recursos suprimentos/MI/produtos **não** ganham write pela SC

**Extensão aditiva proposta** (catalog + contract, sem remover chaves):

| Chave | Uso |
|-------|-----|
| `operations.purchases.requests` | SC (já coberto pelo pai se granularidade não existir) |
| `operations.purchases.quotations` | Cotação SC |
| `operations.purchases.orders` | PO |
| `operations.purchases.receipts` | Recebimento |
| `operations.inventory.reservations` | UI reservas (API já existe) |

Regra: feature flag off ⇒ 404; flag on + sem permissão ⇒ 403.

---

## 14. Eventos futuros de integração (sem consumidores)

Emitir (ou preparar envelope) **sem** subscribers na fase 1 — contratos tipados / outbox opcional depois:

| Evento | Quando | Payload mínimo |
|--------|--------|----------------|
| `sc.purchase_request.opened` | SC → `ABERTA` | requestId, number |
| `sc.quotation.awarded` | Cotação adjudicada | quotationId, supplierId, lines[] |
| `sc.purchase_order.issued` | PO emitido | poId, code, supplierId |
| `sc.purchase_order.cancelled` | PO cancelado | poId |
| `sc.goods_receipt.approved` | Recebimento aprovado | receiptId, poId, lines[] |
| `sc.goods_receipt.reversed` | Estorno | receiptId, reversalMovementId |
| `sc.inventory.purchase_entry.posted` | Após `PURCHASE_ENTRY` | movementId, itemId, qty |
| `sc.inventory.purchase_entry.reversed` | Após `REVERSAL` | movementId, originalId |

**Não** consumir para: atualizar custo/BOM/preço/AP/Nomus stock (OP-00 §5).

Consumidores futuros possíveis (fora do escopo agora): indicadores SC, MI (só leitura de disponibilidade), finanças (export read-only).

---

## 15. Rollout por piloto

1. **Flags off** em todos os ambientes não-piloto.
2. Piloto: 1 almoxarifado + 1 CC ops + usuários com permissões granulares + fornecedores já em `FinancialSupplier`.
3. Ordem de liberação no piloto:  
   (a) UI reservas/auditoria inventory (zero schema) →  
   (b) cotação SC →  
   (c) PO →  
   (d) recebimento **manual** sem postar estoque →  
   (e) postar `PURCHASE_ENTRY` com flag orquestrador on **só no piloto**.
4. Critérios de saída do piloto: invariantes de saldo verdes nos testes; zero writes em módulos protegidos (diff + testes de proteção); estorno de recebimento validado.
5. Expandir almoxarifados/usuários; só então considerar outros ambientes.

---

## 16. Estratégia de rollback

| Camada | Rollback |
|--------|----------|
| Feature flags | Desligar env ⇒ UI/API novas somem (404); dados permanecem |
| Orquestrador estoque | Flag off ⇒ novos recebimentos não postam; saldo intacto |
| Recebimento já postado | Estorno oficial (`REVERSAL` + status `ESTORNADO`) — **não** DELETE |
| Migration aditiva | Não reverter drop; feature off isola; limpeza de dados só com autorização explícita |
| Código | Reverter PR/commit do módulo SC; **não** tocar migrations oficiais nem motores protegidos |
| Nomus / oficiais | Nunca “desfazer” sync pela SC |

---

## 17. Sequência técnica de implementação

Ordem obrigatória (cada passo: checklist OP-00 §8 → testes focados → typecheck → diff protegidos limpo):

| # | Entrega | Migration? |
|---|---------|------------|
| 0 | OP-00 cadeado + OP-01 auditoria + **este** OP-02 | Não |
| 1 | Contratos read-only oficiais (libs) + testes “SC não escreve protegidos” | Não |
| 2 | Feature flags SC (env) + stubs de rota 404 + nav gate | Não |
| 3 | Completar UI reservas/auditoria inventory (reuso) | Não |
| 4 | Modelo aditivo cotação SC (+ anexos padrão MI) | **Sim (aditiva)** — OP futuro |
| 5 | Modelo aditivo PO; preencher soft `purchaseOrderId` | **Sim (aditiva)** |
| 6 | Modelo aditivo recebimento; status sem postar estoque | **Sim (aditiva)** |
| 7 | Adaptador SC→`createInventoryMovement` (`PURCHASE_ENTRY`) atrás de flag | Não (ou mínima se outbox) |
| 8 | Estorno recebimento → `REVERSAL` | Não |
| 9 | Eventos tipados sem consumidores + indicadores SC read | Opcional |
| 10 | Avaliar `INVENTORY_INTEGRATIONS_ENABLED` / demanda persistida | Só com autorização |

**Este OP para em #0.** Não criar migration aqui.

---

## 18. Diagrama de fluxo (fase alvo)

```text
PurchaseRequest (ABERTA)
        │
        ▼
  Cotação SC ──► adjudicação ──► PurchaseOrder (EMITIDO/CONFIRMADO)
                                        │
                                        ▼
                               GoodsReceipt (conferência)
                                        │ aprovado + flag on
                                        ▼
                         createInventoryMovement(PURCHASE_RECEIPT)
                                        │
                                        ▼
                              InventoryBalance (fórmula disponível)
```

Leitura lateral (nunca write): Material / Product / FinancialSupplier / Nomus NFe·stock·OP.

---

## 19. Revisão contra o código real (checklist OP-02)

| Afirmação arquitetural | Evidência |
|------------------------|-----------|
| Stack inventory reutilizável | `prisma/schema.prisma` L5111+; `inventoryRoutes.ts`; migration `20260627120000_inventory_module_base` |
| SC solicitações existentes | `PurchaseRequest*` L1450–1496; enums L1941–1963 |
| Integrações off | `inventoryIntegrationTypes.ts` L10; `docs/inventory-future-integrations.md` |
| Fórmula disponível | `inventoryTypes.ts` `calculateAvailableBalance` |
| Tipos movimento incl. compra/estorno | `InventoryMovementType` L5142–5160; `reversedMovementId` L5318 |
| Soft PO/NFe no movimento | L5298–5307 |
| Dois CCs | `CostCenter` L1436 vs `FinancialCostCenter` |
| MI ≠ cotação SC | `MaterialMarketQuote*` L318+; OP-01 §12 |
| Flag pattern projeto | `salesOrderFlowFeatureFlags.ts` |
| Permissões compras/estoque | `permissionsClient.ts` L104–109 |
| Nav grupo SC | `navigationGroups.ts` materials/purchases/inventory |
| Reservas UI coming soon | `inventoryNavigation.ts` (OP-01) |

---

## 20. Decisão final

A arquitetura oficial da Cadeia de Suprimentos é **paralela e aditiva**: almoxarifado e solicitações **já existentes** são o núcleo; cotação SC, PO e recebimento nascem como entidades **novas** apenas onde o schema atual não cobre; motores oficiais entram **somente por contratos de leitura**; estoque local permanece o único saldo físico IndusCost, com movimentos imutáveis e estornos; flags desligadas por padrão; piloto antes de qualquer orquestração com `PURCHASE_ENTRY`.

**Próximo OP sugerido:** modelo de dados aditivo (cotação / PO / recebimento / anexos) + flags/permissões — ainda sem ligar escrita em módulos protegidos e sem ativar integrações de estoque.
