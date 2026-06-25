# Arquitetura — Módulo Estoque / Almoxarifado

**Data:** 2026-06-24  
**Status:** Fase 1 — MVP independente (sem integração real com outros módulos)  
**Projeto:** IndusCost / My Industry

---

## 1. Objetivo do módulo

Controlar, auditar e projetar **disponibilidade física** de itens da empresa — produtos acabados, semiacabados, componentes, matérias-primas, embalagens, suprimentos, EPIs, ferramentas e demais materiais — com rastreabilidade completa.

**Regra-mãe:** o saldo de estoque **nunca** é editado diretamente. Toda alteração ocorre por **movimentação rastreável**. Saldo é consequência; movimentação é o fato gerador.

O módulo nasce **independente** na Fase 1, com campos e contratos preparados para integrações futuras (compras, PV, produção, BOM, financeiro, qualidade, inteligência de MP).

---

## 2. Escopo MVP (Fase 1)

| # | Capacidade | Descrição |
|---|------------|-----------|
| 1 | Cadastro de itens | `InventoryItem` — catálogo unificado de itens físicos |
| 2 | Almoxarifados/locais | `InventoryWarehouse` (+ `InventoryLocation` opcional) |
| 3 | Movimentações básicas | Entrada, saída, transferência, ajuste, bloqueio, reserva |
| 4 | Saldos calculados | `InventoryBalance` materializado, atualizado só pelo serviço |
| 5 | Conferência física | `InventoryCountSession` + `InventoryCountLine` |
| 6 | Consulta de saldo | Por item, almoxarifado, disponível vs físico |
| 7 | Dashboard | KPIs operacionais (ruptura, crítico, bloqueado, conferências abertas) |
| 8 | Histórico/auditoria | `InventoryMovement` imutável + `InventoryAuditLog` |
| 9 | Reserva manual | `InventoryReservation` — reduz disponível, não físico |
| 10 | Bloqueio/desbloqueio | Saldo bloqueado/quarentena — reduz disponível, não físico |
| 11 | CC obrigatório | Saídas de ADMINISTRATIVE_SUPPLY, MAINTENANCE, PPE e similares exigem `costCenterId` |
| 12 | Campos de integração | IDs/códigos opcionais (PV, compra, OP, NFe, produto) — sem FK ativa a Nomus |

---

## 3. Fora do escopo da Fase 1

1. Integração real com compras (recebimento automático)
2. Integração real com pedidos de venda (baixa/reserva automática)
3. Integração real com BOM / explosão de necessidade
4. Integração real com produção / OP
5. Custo fiscal/contábil oficial
6. WMS avançado (endereçamento dinâmico, onda, cross-docking)
7. Código de barras, QR Code, coletor
8. Baixa automática por ordem de produção
9. Explosão real de necessidade por pedido de venda
10. Alteração de tabelas Nomus oficiais ou fluxo de sync Nomus

---

## 4. Entidades / tabelas propostas

### 4.1 `InventoryItem`

Cadastro unificado de itens de estoque (independente de `Product`, com vínculo opcional futuro).

| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID | PK |
| code | String unique | Código interno |
| description | String | Descrição |
| itemType | Enum | FINISHED_PRODUCT, SEMI_FINISHED, COMPONENT, RAW_MATERIAL, … |
| unit | String | UN, KG, M, etc. |
| family, group | String? | Classificação |
| status | Enum | ACTIVE, INACTIVE |
| controlsLot / Expiration / Location / Quality | Boolean | Flags operacionais |
| minimumStock, maximumStock, reorderPoint | Decimal? | Parâmetros de alerta |
| preferredSupplierName | String? | Informativo Fase 1 |
| averageCost, lastKnownCost | Decimal? | Referência; não custo fiscal |
| productId | UUID? FK Product | Integração futura engenharia |
| nomusProductCode, nomusProductId | String? | Referência Nomus (sem FK) |
| notes | String? | |
| createdAt, updatedAt | Timestamptz | |
| createdByUserId, updatedByUserId | String? | |

### 4.2 `InventoryWarehouse`

Almoxarifado principal (MP, PA, Manutenção, etc.).

| Campo | Tipo |
|-------|------|
| id, code (unique), name, description | |
| status | ACTIVE, INACTIVE |
| allowsMovements | Boolean |
| createdAt, updatedAt | |

Almoxarifados padrão sugeridos (seed futuro, não automático): MP, COMPONENTES, PA, EMBALAGEM, PRODUCAO, QUALIDADE, MANUTENCAO, ADMINISTRATIVO, EXPEDICAO, SUCATA.

### 4.3 `InventoryLocation` (opcional na operação)

Subdivisão dentro do almoxarifado (corredor, prateleira, bin).

**Decisão Fase 1:** modelo existe no schema; operação MVP pode usar **apenas warehouse** com `locationId = null` e `balanceKey = {warehouseId}`. Quando `controlsLocation = true` no item, exigir location nas movimentações.

### 4.4 `InventoryMovement`

Registro **imutável** de cada fato gerador.

Campos obrigatórios de auditoria: usuário, data, item, quantidade, tipo, motivo, saldos anterior/posterior (físico, reservado, bloqueado, quarentena, disponível).

Campos de integração futura (opcionais, sem FK Nomus): `purchaseOrderId`, `salesOrderId`, `productionOrderId`, `productId`, `nfeId`, `nfeNumber`, `documentNumber`, `originType`, `originId`, `costCenterId`.

`reversedMovementId` — vínculo para estorno (`REVERSAL`).

### 4.5 `InventoryBalance`

Saldo materializado por **item + escopo** (`balanceKey` = `warehouseId` ou `warehouseId:locationId`).

| Campo | Descrição |
|-------|-----------|
| physicalQuantity | Saldo físico |
| reservedQuantity | Reservado |
| blockedQuantity | Bloqueado |
| quarantineQuantity | Quarentena |
| availableQuantity | Calculado e persistido para consulta rápida |
| averageCost, totalValue | Referência gerencial |
| lastMovementAt, updatedAt | |

**Regra:** nenhuma rota/UI edita esta tabela diretamente — apenas `inventoryService.server.ts`.

Índice único: `@@unique([itemId, balanceKey])`.

### 4.6 `InventoryReservation`

Reserva manual com tipo (SALES_ORDER, PRODUCTION_ORDER, INTERNAL_REQUISITION, MAINTENANCE, QUALITY, MANUAL) e status (ACTIVE, CANCELED, CONSUMED).

### 4.7 `InventoryCountSession` + `InventoryCountLine`

Conferência física com fluxo: OPEN → COUNTING → WAITING_APPROVAL → APPROVED → ADJUSTED / CANCELED.

Divergência gera movimento de ajuste (`POSITIVE_ADJUSTMENT` / `NEGATIVE_ADJUSTMENT`) via serviço — **nunca** substitui saldo diretamente.

### 4.8 `InventoryAuditLog`

Padrão Fleet/Finance: `entityType`, `entityId`, `action`, `beforeJson`, `afterJson`, `userId`, `reason`, `createdAt`.

Complementa (não substitui) os snapshots em `InventoryMovement`.

---

## 5. Relacionamentos

```mermaid
erDiagram
  InventoryItem ||--o{ InventoryMovement : item
  InventoryItem ||--o{ InventoryBalance : item
  InventoryItem ||--o{ InventoryReservation : item
  InventoryWarehouse ||--o{ InventoryBalance : warehouse
  InventoryWarehouse ||--o{ InventoryLocation : locations
  InventoryLocation ||--o{ InventoryBalance : location
  InventoryWarehouse ||--o{ InventoryCountSession : session
  InventoryCountSession ||--o{ InventoryCountLine : lines
  InventoryCountLine }o--o| InventoryMovement : adjustment
  InventoryMovement }o--o| InventoryMovement : reversal
  InventoryMovement }o--o| CostCenter : costCenter
  InventoryItem }o--o| Product : productId
  InventoryReservation }o--|| InventoryMovement : reserve/cancel
```

---

## 6. Rotas / API propostas

Prefixo: `/api/inventory`  
Registro: `registerInventoryRoutes(app, auth)` em `server.ts` (padrão Fleet/Projects).

| Método | Rota | Permissão | Descrição |
|--------|------|-----------|-----------|
| GET | `/api/inventory/dashboard` | `inventory.view` | KPIs |
| GET/POST | `/api/inventory/items` | view / manage | CRUD itens |
| GET/PATCH | `/api/inventory/items/:id` | view / manage | Detalhe item |
| GET/POST | `/api/inventory/warehouses` | view / manage | CRUD almoxarifados |
| GET/POST | `/api/inventory/locations` | view / manage | CRUD locais |
| GET | `/api/inventory/balances` | view | Consulta saldos (filtros) |
| GET | `/api/inventory/balances/:itemId` | view | Saldo por item |
| POST | `/api/inventory/movements` | `inventory.movements.create` | Registrar movimento |
| GET | `/api/inventory/movements` | view | Histórico paginado |
| GET | `/api/inventory/movements/:id` | view | Detalhe movimento |
| POST | `/api/inventory/reservations` | `inventory.reservations.manage` | Criar reserva |
| PATCH | `/api/inventory/reservations/:id/cancel` | reservations.manage | Cancelar |
| POST | `/api/inventory/count-sessions` | `inventory.count.manage` | Abrir conferência |
| PATCH | `/api/inventory/count-sessions/:id/...` | count.manage | Contar, aprovar, ajustar |
| GET | `/api/inventory/audit` | `inventory.audit.view` | Log complementar |
| GET | `/api/inventory/export/balances.csv` | `inventory.export` | Exportação interna |

**Não expor:** PATCH/PUT em `InventoryBalance`; PUT/PATCH/DELETE em `InventoryMovement`.

---

## 7. Componentes / telas propostas

| Rota UI | Componente | Descrição |
|---------|------------|-----------|
| `/inventory` | `InventoryModule.tsx` | Shell com navegação por abas |
| `/inventory` (default) | `InventoryDashboard.tsx` | KPIs + alertas |
| `/inventory/items` | `InventoryItemsPage.tsx` | Lista/cadastro itens |
| `/inventory/warehouses` | `InventoryWarehousesPage.tsx` | Almoxarifados e locais |
| `/inventory/balances` | `InventoryBalancesPage.tsx` | Consulta saldos |
| `/inventory/movements` | `InventoryMovementsPage.tsx` | Histórico + nova movimentação |
| `/inventory/reservations` | `InventoryReservationsPage.tsx` | Reservas ativas |
| `/inventory/counts` | `InventoryCountSessionsPage.tsx` | Conferências físicas |
| `/inventory/audit` | `InventoryAuditPage.tsx` | Trilha de auditoria |

Padrões UI: `ModulePageShell`, `indus-kpi-grid`, `MetricCard`, sheets/drawers como Fleet e Finance.

Sidebar: item "Estoque" gated por `inventory.view` em `modulePermissions.ts`.

---

## 8. Permissões propostas

Grupo novo no `permissionCatalog.ts`: **Estoque** (`INV`).

| Chave | Tipo | Descrição |
|-------|------|-----------|
| `inventory.view` | menu | Acesso ao módulo e leitura |
| `inventory.manage` | action | CRUD itens, almoxarifados, locais |
| `inventory.movements.create` | action | Registrar movimentações manuais |
| `inventory.movements.override` | action | Saída acima do disponível (com justificativa) |
| `inventory.adjustments.approve` | action | Aprovar ajustes e conferências |
| `inventory.reservations.manage` | action | Reservas manuais |
| `inventory.count.manage` | action | Conferência física |
| `inventory.block.manage` | action | Bloqueio/desbloqueio |
| `inventory.audit.view` | action | Ver auditoria detalhada |
| `inventory.export` | action | Exportações CSV/XLSX |

Templates em `permissionCatalogUtils.ts`: perfil `inventory_operator`, `inventory_supervisor`.

---

## 9. Regras de negócio críticas

1. **Saldo não editável** — UI e API não expõem update direto em `InventoryBalance`.
2. **Movimentação completa** — registra usuário, data, item, local, quantidade, motivo, tipo, saldos anterior/posterior.
3. **Escopo de saldo** — item + almoxarifado (+ local quando aplicável).
4. **Disponível** = físico − reservado − bloqueado − quarentena.
5. **Reserva** reduz disponível; **não** reduz físico.
6. **Bloqueio/quarentena** reduz disponível; **não** reduz físico.
7. **Saída > disponível** — bloqueada; override só com `inventory.movements.override` + justificativa auditada.
8. **Conferência** — divergência → movimento de ajuste rastreável.
9. **Imutabilidade** — movimentos não são apagados; correção via `REVERSAL`, ajuste ou nova movimentação.
10. **Centro de custo** — obrigatório em saídas de ADMINISTRATIVE_SUPPLY, MAINTENANCE, PPE, PRODUCTION_SUPPLY (configurável por `itemType`).
11. **Quantidade** — deve ser > 0.
12. **Transferência** — origem ≠ destino.
13. **Motivo** — obrigatório em movimentos manuais e ajustes.

---

## 10. Estratégia de saldo

### Camadas

| Camada | Arquivo | Papel |
|--------|---------|-------|
| Motor puro | `inventoryBalanceMath.ts` | Fórmulas e impacto por tipo |
| Regras | `inventoryMovementRules.ts` | Validação de request |
| Serviço | `inventoryService.server.ts` | Transação, persistência, auditoria |
| Materializado | `InventoryBalance` | Performance de consulta |

### Fórmula

```text
availableQuantity = physicalQuantity - reservedQuantity - blockedQuantity - quarantineQuantity
```

Recalculada no motor a cada movimento; persistida em `InventoryBalance.availableQuantity` para listagens.

### Concorrência

- `prisma.$transaction` com isolation level default ou `Serializable` quando necessário
- Lock pessimista: `findUnique` + `update` dentro da transação; opcional `$queryRaw` `FOR UPDATE` em evolução
- Update condicional: falha se saldo mudou entre leitura e escrita (retry ou erro amigável)

### Transferência (decisão)

**Abordagem escolhida:** 1 registro `InventoryMovement` tipo `TRANSFER` com `sourceWarehouseId` + `destinationWarehouseId`, atualizando **dois** `InventoryBalance` na mesma transação.

Alternativa descartada na Fase 1: par saída+entrada — mais rastreável para integrações, porém duplica volume; pode ser adotada na integração com produção.

---

## 11. Estratégia de auditoria

| Evento | Onde |
|--------|------|
| Toda movimentação | Campos before/after em `InventoryMovement` |
| CRUD item/warehouse | `InventoryAuditLog` + JSON before/after |
| Override de saldo | `InventoryAuditLog` action `MOVEMENT_OVERRIDE` |
| Aprovação conferência | `InventoryAuditLog` + movimento de ajuste |
| Reserva/bloqueio | Movimento + log complementar |

Padrão de escrita: `writeInventoryAuditLog()` em `inventoryAudit.server.ts` (espelho `writeFleetAuditLog`).

Logs críticos também via `console`/logger estruturado se o projeto adicionar helper de módulo.

---

## 12. Estratégia para futuras integrações

| Módulo | Contrato preparado | Integração Fase 2+ |
|--------|-------------------|-------------------|
| Compras | `originType=PURCHASE`, `purchaseOrderId`, `PURCHASE_ENTRY` | Recebimento gera movimento |
| Pedidos de Venda | `salesOrderId`, reserva tipo SALES_ORDER | Reserva/baixa automática |
| Produção | `productionOrderId`, PRODUCTION_ENTRY/EXIT | Consumo MP / entrada PA |
| BOM / Product | `productId` em InventoryItem | Sincronizar catálogo |
| Financeiro | `financialCostCenterId` opcional | Valorização gerencial |
| CC Compras | `costCenterId` FK `CostCenter` | Saídas internas |
| Qualidade | `quarantineQuantity`, movimento BLOCK | Quarentena de lote |
| Inteligência MP | API de saldo disponível | Substituir estimativas de demanda |

**Princípio:** integrações **sempre** chamam `createInventoryMovement()` — nunca escrevem saldo direto.

Campos Nomus (`nomusProductCode`, `nfeNumber`) são referência textual — **sem FK** a tabelas Nomus.

---

## 13. Ordem recomendada de implementação

| Fase | Entrega |
|------|---------|
| **0** | Este documento ✓ |
| **1** | Schema Prisma + migration + testes de schema |
| **2** | Motor puro (`inventoryBalanceMath`, `inventoryMovementRules`) + testes |
| **3** | Serviço backend (`inventoryService.server`) + testes transacionais |
| **4** | Permissões + rotas API + registro server.ts |
| **5** | UI shell + dashboard + CRUD itens/almoxarifados |
| **6** | Telas movimentação, saldos, reservas |
| **7** | Conferência física + ajustes |
| **8** | Exportações + auditoria UI |
| **9** | Seed opcional almoxarifados padrão |
| **10** | Integrações (compras, PV, produção) — módulos separados |

---

## 14. Riscos técnicos

| Risco | Mitigação |
|-------|-----------|
| Condição de corrida em saldo | Transação + lock; testes de concorrência futuros |
| UNIQUE com `locationId` null | Campo `balanceKey` explícito |
| Duplicação de catálogo Product vs InventoryItem | Vínculo opcional `productId`; sync assíncrono futuro |
| Dois modelos de CC (Compras vs Financeiro) | Fase 1 usa `CostCenter` (Compras) para saídas operacionais |
| Performance histórico movimentos | Índices `(itemId, movementDate)`, paginação, arquivo futuro |
| Confusão saldo vs demanda MP | Disclaimers UI; módulo demanda existente não é estoque |
| Custo médio inconsistente | Fase 1: referência; Fase 2: política de valorização documentada |

---

## 15. Decisões a validar com negócio

1. **Vínculo Product ↔ InventoryItem** — sync automático ou cadastro independente?
2. **Centro de custo** — `CostCenter` (Compras) vs `FinancialCostCenter` para saídas internas?
3. **Granularidade de local** — MVP só warehouse ou exigir location desde o dia 1?
4. **Custo médio** — recalcular a cada entrada ou manter `lastKnownCost` manual?
5. **Quarentena** — saldo separado desde Fase 1 ou só bloqueio?
6. **Transferência** — um movimento vs par entrada/saída para integrações?
7. **Almoxarifados padrão** — seed automático na instalação?
8. **Override saldo negativo** — quem aprova e qual trilha?
9. **Unidade de medida** — validar conversão entre UN/KG na transferência entre locais?
10. **Itens sem código Nomus** — política de código interno vs importação futura?

---

## Referências de padrão no projeto

| Aspecto | Referência |
|---------|------------|
| Módulo completo | Fleet (`fleetRoutes.ts`, `FleetAuditLog`, `FleetModule.tsx`) |
| Permissões | `permissionCatalog.ts`, `modulePermissions.ts` |
| CC operacional | `CostCenter` (Compras) |
| CC gerencial | `FinancialCostCenter` (Financeiro) |
| Demanda (não estoque) | `materialDemand*.ts`, disclaimers em dashboards |
| Testes | `tsx --test src/lib/*.test.ts` |
| KPIs | `indus-kpi-grid.css`, `FinanceBiKpiCard` |
| Export | `fleetCsv.ts`, `*Export.ts` + rota `.csv`/`.xlsx` |

---

## Arquivos previstos (implementação)

```text
prisma/schema.prisma                    → modelos Inventory*
src/lib/inventory/inventoryTypes.ts
src/lib/inventory/inventoryBalanceMath.ts
src/lib/inventory/inventoryMovementRules.ts
src/lib/inventory/inventoryStatus.ts
src/lib/inventory/inventoryService.server.ts
src/lib/inventory/inventoryRepository.server.ts
src/lib/inventory/inventoryAudit.server.ts
src/lib/inventory/inventoryPermissions.ts
src/lib/inventory/inventoryRoutes.ts
src/lib/inventory/inventorySchema.test.ts
src/lib/inventory/*.test.ts
src/types/inventory.ts
src/components/InventoryModule.tsx
src/components/inventory/*
docs/inventory-module-architecture.md   → este documento
```
