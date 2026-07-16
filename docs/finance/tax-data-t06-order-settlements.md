# T06 — Recolhimentos e alocações no detalhe do Pedido

**Atualizado:** 2026-07-16  
**Depende de:** T04 (destacados NF), T05 (apuração/guias/alocação)

## Diferença entre camadas

| Label na tela | Camada | Fonte |
|---------------|--------|-------|
| Destacado na NF | A | XML / `NomusNfeTaxLine` HEADER |
| Apurado no período | B | `FiscalApuration*` / valores da guia no período |
| Efetivamente recolhido | C | Guia + baixa/comprovante / AP Nomus |
| Alocado gerencialmente ao pedido | D | `FiscalAllocation` (nunca = pagamento da NF) |

## DTO

`SalesOrderFiscalTaxesPayload.settlements` (`SalesOrderFiscalSettlementsBlock`):

- `taxMatrix` — consolidado por tributo
- `guides` — recolhimentos ligados via alocação
- `allocations` — parcelas gerenciais
- `history` — auditoria recente

## UI

Aba **Tributos** do detalhe do PV (e Auditoria 360º): blocos A–D com labels explícitos e estados vazios (“Sem informação de recolhimento”, “Apurado, pendente de recolhimento”, parcial com devido/pago/saldo).
