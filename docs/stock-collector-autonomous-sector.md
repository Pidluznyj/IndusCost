# Stock Collector — fluxo autônomo por setor

## Objetivo

Permitir que um tablet no tailnet inicie e conclua a contagem física de
**Matéria-prima** sem login humano falso: identidade = `DEVICE` + `deviceId`
do Device Registry (Tailscale StableID).

## Deep-link / QR de setor

- Path: `/collector/sector/raw-material`
- URL absoluta: `INVENTORY_COLLECTOR_PUBLIC_BASE_URL` (fallback `APP_URL`) + path
- Endpoint humano (login + `inventoryCounts.manage`):
  `GET /api/inventory/collector/sector-qr?sector=RAW_MATERIAL` → `{ sector, label, url }`

O QR de item × almoxarifado × endereço (`collectorQrContract`, tipo `inv-loc`)
permanece **legado** para o fluxo `/collector`.

## Capacidades do device (migration aditiva)

Em `InventoryCollectorDevice`:

- `canManageCountSessions` (default `true`) — criar/continuar/finalizar
- `canApplyCountAdjustments` (default `true`) — gerar ajustes canônicos

## API DEVICE (`deviceAuth`)

| Método | Rota | Notas |
|---|---|---|
| GET | `/api/inventory/collector/context?sector=RAW_MATERIAL` | device + warehouses + activeSession |
| GET | `/api/inventory/collector/count-sessions/active` | sessão COUNTING do warehouse |
| POST | `/api/inventory/collector/count-sessions` | create+start idempotente (`MP-YYYYMMDD-NNN`) |
| GET | `/api/inventory/collector/count-sessions/:id/items` | lista **cega** (sem systemQuantity) |
| POST | `/api/inventory/collector/count` | wrapper DEVICE → `recordInventoryCount` |
| POST | `/api/inventory/collector/count-sessions/:id/finalize` | `allowUncounted`; auto-justificativa DEVICE; auto-approve |
| POST | `/api/inventory/collector/count-sessions/:id/apply-adjustments` | `confirm` + `operationId`; idempotente |

Rotas legadas (resolve-qr / PATCH lines / list COUNTING) são preservadas.

## População RAW_MATERIAL

Batch (sem N+1):

1. Materials ACTIVE (diagnóstico)
2. InventoryItems ACTIVE com `materialId` + `RAW_MATERIAL` (saldos do warehouse + defaultWarehouse)
3. InventoryBalances do warehouse
4. Linhas com `systemQuantity` do físico; item sem saldo → linha com `0`

Idempotente se a sessão já tiver linhas. Não cria motor paralelo nem atualiza
`InventoryBalance` / `Material.quantity` diretamente.

## Contagem cega

DTO de itens **não** inclui `systemQuantity` / `expectedQuantity` /
`adjustmentDelta` antes da contagem. Divergências só aparecem após finalize.

## Ajustes

Sempre via `createInventoryMovement` / `generateInventoryCountAdjustments`.
`CreateInventoryMovementContext.userId` é opcional; `deviceId` vai nas notes.
DEVICE não inventa `AppUser`.

## Suprimentos (tablet)

`searchMaterialStockTablet`: se a MP tem InventoryItem vinculado, a quantidade
exibida é a soma de `InventoryBalance.physicalQuantity`. `Material.quantity`
fica só para legado não vinculado. Sem writes.
