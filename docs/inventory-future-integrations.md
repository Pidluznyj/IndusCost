# Integrações futuras — Estoque / Almoxarifado

Documento de preparação técnica. **Nenhuma integração real está ativa** (`INVENTORY_INTEGRATIONS_ENABLED = false`).

O módulo de estoque permanece **independente**: saldo só muda via `createInventoryMovement()`. Módulos externos (compras, vendas, produção, etc.) **não** alteram estoque automaticamente nesta fase.

Contratos TypeScript:

- `src/lib/inventory/inventoryIntegrationTypes.ts`
- `src/lib/inventory/inventoryDemandProjectionTypes.ts`

---

## 1. Compras → estoque (futuro)

**Regra:** pedido de compra aprovado **não** aumenta estoque. Somente **recebimento/conferência** gera movimento.

| Etapa futura | Comportamento |
|--------------|---------------|
| PO aprovada | Opcional: criar demanda de entrada planejada (não implementada) |
| Recebimento físico | `PURCHASE_ENTRY` via `createInventoryMovement` |
| Origem | `integrationOrigin: PURCHASE_ORDER` → `originType: PURCHASE` |
| Campos | `purchaseOrderId`, `purchaseOrderCode`, `nfeId`, `nfeNumber`, `documentNumber` |

---

## 2. Pedidos de venda → demanda / reserva (futuro)

**Regra:** pedido de venda **não** baixa estoque automaticamente. Pode gerar **demanda** ou **reserva** futura.

| Etapa futura | Comportamento |
|--------------|---------------|
| PV confirmado | `InventoryDemandProjection` tipo `SALES_ORDER_DEMAND` (conceitual) |
| Separação | `RESERVE` com `InventoryReservationType.SALES_ORDER` |
| Expedição | `MANUAL_EXIT` ou `REQUISITION_EXIT` com `salesOrderId` |
| Campos | `salesOrderId`, `salesOrderCode`, `originId` |

---

## 3. BOM → necessidade (futuro)

**Regra:** BOM **não** movimenta estoque sozinha. Calcula necessidade (explosão) para produção/compras.

| Etapa futura | Comportamento |
|--------------|---------------|
| Explosão BOM | Gera lista de `PRODUCTION_DEMAND` por componente |
| Consumo real | Movimento `PRODUCTION_EXIT` na OP |
| Campos | `bomId`, `productId`, `productionOrderId` |

---

## 4. Produção → reservar / baixar / retornar (futuro)

**Regra:** OP **não** baixa estoque na criação. Pode **reservar**; baixa no **consumo real**; retorno via `PRODUCTION_ENTRY` ou `RETURN`.

| Etapa futura | Movimento |
|--------------|-----------|
| Planejamento OP | Demanda `PRODUCTION_DEMAND` |
| Reserva MP | `RESERVE` + `productionOrderId` |
| Consumo | `PRODUCTION_EXIT` |
| Entrada PA / retorno | `PRODUCTION_ENTRY`, `RETURN` |
| Origem | `PRODUCTION_ORDER` ou `BOM` → `originType: PRODUCTION_ORDER` |

---

## 5. Qualidade → bloqueio / quarentena (futuro)

**Regra:** qualidade pode **bloquear** ou **quarentenar**, reduzindo saldo **disponível** sem alterar físico diretamente.

| Ação | Movimento / saldo |
|------|-------------------|
| Bloqueio | `BLOCK` — aumenta `blockedQuantity` |
| Desbloqueio | `UNBLOCK` |
| Quarentena | Campo `quarantineQuantity` em `InventoryBalance` (futuro: movimento dedicado) |
| Origem | `integrationOrigin: QUALITY` |

---

## 6. Centro de custo (já parcialmente implementado)

Saídas de suprimentos administrativos, manutenção, EPI, material de produção e `OTHER` exigem `costCenterId` (FK `CostCenter`).

Campos: `costCenterId`, `financialCostCenterId` (valorização gerencial futura).

---

## 7. Financeiro → valor gerencial (futuro)

| Dado | Fonte |
|------|-------|
| Valor em estoque | `InventoryBalance.totalValue`, `averageCost` |
| Movimento valorizado | `financialCostCenterId` + custo médio |
| Integração | Export/API read-only — **sem** lançamento contábil automático nesta fase |

---

## 8. Inteligência de matéria-prima (futuro)

Usará:

- Saldo **disponível** atual (`availableQuantity`)
- Demandas abertas (`PLANNED` / `RESERVED`) via `computeProjectedAvailable()` (contrato)
- Ponto de reposição / mínimo em `InventoryItem`

**Não** confundir com módulo de demanda comercial existente fora do estoque.

---

## 9. Campos já preparados no schema

### `InventoryMovement`

| Campo | Uso futuro |
|-------|------------|
| `originType`, `originId` | Rastreio genérico |
| `purchaseOrderId`, `purchaseOrderCode` | Compras |
| `salesOrderId`, `salesOrderCode` | Vendas |
| `productionOrderId`, `productionOrderCode` | Produção |
| `bomId`, `productId` | BOM / catálogo |
| `nfeId`, `nfeNumber` | NF-e recebimento |
| `costCenterId`, `financialCostCenterId` | CC operacional / financeiro |
| `documentNumber` | Documento fiscal/interno |
| `reservationId` | Vínculo reserva → baixa |

### `InventoryItem`

| Campo | Uso futuro |
|-------|------------|
| `productId` | Vínculo Product/BOM |
| `nomusProductCode`, `nomusProductId` | Referência integração Nomus (sem FK) |

### `InventoryReservation`

| Campo | Uso futuro |
|-------|------------|
| `reservationType` | SALES_ORDER, PRODUCTION_ORDER, etc. |
| `originType`, `originId` | Documento gerador |

### `InventoryBalance`

| Campo | Uso futuro |
|-------|------------|
| `reservedQuantity` | Reservas ativas |
| `blockedQuantity` | Qualidade / bloqueio |
| `quarantineQuantity` | Quarentena |
| `availableQuantity` | Disponível para venda/produção |

---

## 10. O que ainda não foi implementado

- [ ] Webhooks / jobs de compras → recebimento automático
- [ ] Reserva automática por PV ou OP
- [ ] Explosão de BOM
- [ ] Tabela `InventoryDemand` (apenas tipos em `inventoryDemandProjectionTypes.ts`)
- [ ] API pública cross-módulo além de `POST /api/inventory/movements`
- [ ] Sincronização Nomus bidirecional
- [ ] Lançamentos financeiros automáticos
- [ ] UI de demanda projetada

---

## Regras de ouro (futuro)

1. **Pedido de compra aprovado não aumenta estoque.**
2. **Pedido de venda não baixa estoque automaticamente.**
3. **OP não baixa estoque na criação.**
4. **BOM não movimenta estoque sozinha.**
5. **Qualidade bloqueia/quarentena — reduz disponível.**
6. **Toda alteração de saldo = movimentação rastreável.**

---

## Ativação futura

1. Definir `INVENTORY_INTEGRATIONS_ENABLED = true` apenas no módulo orquestrador (não no core).
2. Implementar adaptadores por domínio (compras, vendas, produção).
3. Chamar sempre `createInventoryMovement(prisma, payload, context)` — nunca `inventoryBalance.update`.
4. Adicionar migration para `InventoryDemand` se persistência for necessária.
