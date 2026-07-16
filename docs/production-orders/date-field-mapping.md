# Mapeamento oficial de datas — Ordens de Produção (OP-14.1)

Fonte: `GET /rest/ordens` (Nomus). Parser: `parseNomusProductionOrderDateTime` (`America/Sao_Paulo`).

## Mapeamento final

| Campo Nomus (oficial) | Coluna local | Significado | Cobertura observada (prod) |
|-----------------------|--------------|-------------|----------------------------|
| `dataHoraCriacao` | `openedAt` | Criação / abertura da OP | 21.382 / 21.382 |
| `dataHoraLiberacao` | `releasedAt` | Liberação da OP | 21.330 / 21.382 |
| `dataHoraInicialPlanejada` | `plannedAt` | Início planejado | 21.382 / 21.382 |
| `dataHoraEntrega` | `deliveryAt` | Entrega planejada/prometida | 21.382 / 21.382 |
| `dataHoraEdicao` | `nomusUpdatedAt` | Última edição no Nomus | 21.357 / 21.382 |
| *(ausente / inequívoco)* | `closedAt` | Encerramento oficial | **permanece null** na base atual |

## Aliases legados (fallback apenas)

Usados **somente** se o nome oficial estiver ausente e forem semanticamente equivalentes:

| Coluna | Fallback (ordem) |
|--------|------------------|
| `openedAt` | `dataAbertura`, `dataInicio`, `dataCriacao` |
| `releasedAt` | `dataLiberacao` |
| `plannedAt` | `dataPrevista`, `dataPrevisao`, `dataEntregaPrevista` |
| `deliveryAt` | `dataEntrega` |
| `nomusUpdatedAt` | `dataAlteracao`, `dataAtualizacao` |
| `closedAt` | `dataHoraEncerramento`, `dataEncerramento`, `dataFim`, `dataConclusao` |

## Campos que **não** devem ser confundidos

| Campo | Não usar como |
|-------|----------------|
| `dataHoraEntrega` | `closedAt` / encerramento |
| `dataHoraEdicao` | `closedAt` / encerramento |
| `status = Encerrada` | timestamp de encerramento (não há evidência de campo de data) |
| Campo ausente / inválido | `Date.now()` ou data inventada |

## Por que `closedAt` permanece nulo

1. Em produção, o payload real **não** traz um timestamp inequívoco de encerramento.
2. `dataHoraEntrega` é data de **entrega**, inclusive futura em OPs Liberadas — não é fechamento.
3. `dataHoraEdicao` é edição do registro, não conclusão do processo.
4. Status textual (`Encerrada` / `Cancelada`) **não** autoriza inferir instante de fechamento.

`closedAt` só é preenchido se existir campo oficial de encerramento (`dataHoraEncerramento` ou aliases de encerramento listados acima).

## Regras do parser

- Formato: `dd/MM/yyyy[ HH:mm[:ss]]`
- Timezone de parede: `America/Sao_Paulo` → Instant UTC
- Ausência / string vazia → `null` (sem erro)
- Formato inválido → `null` + `fieldErrors` controlado
- **Proibido** substituir ausência por data atual

## Reparo da base (21.382 OPs)

É possível reparar **somente** a partir do `rawJson` já armazenado, sem nova consulta Nomus.

```bash
# Preview
npm run sync:nomus:production-orders:repair-dates:preview -- --only-null-dates --limit=50

# Apply
npm run sync:nomus:production-orders:repair-dates:apply -- --only-null-dates
```

Durante o reparo **não** se altera:

- `rawJson`, `payloadHash`
- `firstSeenAt`, `lastSeenAt`, `lastChangedAt`, `syncedAt`
- vínculos `NomusProductionOrderSalesLink`
- Pedido de Venda, NF-e, Documento de Saída, AR/AP, Fluxo de Caixa, Comissões, Precificação, BOM, Relatório Presidencial

## Amostra oficial — OP 05800 - 003

| Campo | Valor Nomus | Instant UTC |
|-------|-------------|-------------|
| status | Encerrada | — |
| dataHoraCriacao | 23/06/2026 00:00:00 | `2026-06-23T03:00:00.000Z` |
| dataHoraLiberacao | 23/06/2026 10:55:11 | `2026-06-23T13:55:11.000Z` |
| dataHoraInicialPlanejada | 24/06/2026 17:00:00 | `2026-06-24T20:00:00.000Z` |
| dataHoraEntrega | 08/07/2026 17:00:00 | `2026-07-08T20:00:00.000Z` |
| dataHoraEdicao | 14/07/2026 00:00:00 | `2026-07-14T03:00:00.000Z` |
| closedAt | — | `null` |

## Arquivos

- Mapper: `src/lib/nomusProductionOrdersMapper.ts`
- Parser: `src/lib/nomusProductionOrdersParsers.ts`
- Reparo: `src/lib/nomusProductionOrdersDateRepair.ts` + `.server.ts`
- Script: `scripts/nomusProductionOrdersRepairDates.ts`
- Fixture: `src/lib/fixtures/nomusProductionOrderOp05800.ts`
- Migration: `prisma/migrations/20260730120000_nomus_production_orders_op14_dates`
