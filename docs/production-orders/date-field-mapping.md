# Mapeamento oficial de datas e empresa — Ordens de Produção (OP-14.1)

Fonte: `GET /rest/ordens` (Nomus). Parser: `parseNomusProductionOrderDateTime` (`America/Sao_Paulo`).

## Mapeamento final de datas

| Campo Nomus (oficial) | Coluna local | Significado | Cobertura observada (prod) |
|-----------------------|--------------|-------------|----------------------------|
| `dataHoraCriacao` | `openedAt` | Criação / abertura da OP | 21.382 / 21.382 |
| `dataHoraLiberacao` | `releasedAt` | Liberação da OP | 21.330 / 21.382 |
| `dataHoraInicialPlanejada` | `plannedAt` | Início planejado | 21.382 / 21.382 |
| `dataHoraEntrega` | `deliveryAt` | Entrega planejada/prometida | 21.382 / 21.382 |
| `dataHoraEdicao` | `nomusUpdatedAt` | Última edição no Nomus | 21.357 / 21.382 |
| *(ausente / inequívoco)* | `closedAt` | Encerramento oficial | **permanece null** na base atual |

## Empresa (campo real do payload)

| Campo Nomus | Coluna local | Observação |
|-------------|--------------|------------|
| `empresa` (string, ex.: `"02 - KOPPETEL"`) | `companyName` | Texto exibido; preserva o rótulo original |
| `idEmpresa` (ou prefixo numérico de `empresa` / `empresa.id`) | `externalCompanyId` | Não inferir por produto, pedido ou cliente |

Aliases de nome (só se `empresa` string/objeto não trouxer nome): `empresaNome`, `nomeEmpresa`, `descricaoEmpresa`, `empresaDescricao`, `companyName`, ou `empresa.{nome,razaoSocial,descricao,codigoNome}`.

**Proibido:** derivar empresa a partir de produto, Pedido de Venda ou cliente.

## Aliases legados de data (fallback apenas)

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

## Contrato API / grid

A listagem e o detalhe leem **somente** colunas normalizadas (não hidratam datas/empresa a partir do `rawJson` no frontend nem no serializer de exibição).

Grid Operações → Ordens de Produção:

| Coluna UI | Campo API |
|-----------|-----------|
| Data de abertura | `openedAt` |
| Data planejada | `plannedAt` |
| Data de entrega | `deliveryAt` |
| Empresa | `companyName` |

## Reparo da base (OP-14.2)

É possível reparar **somente** a partir do `rawJson` já armazenado, sem nova consulta Nomus.

Atualiza: `openedAt`, `releasedAt`, `plannedAt`, `deliveryAt`, `nomusUpdatedAt`, `externalCompanyId`, `companyName`.

**Não** altera: `closedAt`, `rawJson`, `payloadHash`, `firstSeenAt`, `lastSeenAt`, `lastChangedAt`, `syncedAt`, vínculos.

Runbook: [`date-repair-runbook.md`](./date-repair-runbook.md).

```bash
npm run repair:nomus:production-orders:dates:preview -- --only-null-dates --limit=50
npm run repair:nomus:production-orders:dates:apply -- --only-null-dates
npm run sync:nomus:production-orders:probe-selector
```

### Incremental — seletor RSQL

Preferencial no payload: `dataHoraEdicao` → `nomusUpdatedAt`.
**Não assumir** que o campo do payload é aceito na query; homologar com o probe (`ACCEPTED` / `REJECTED` / `INCONCLUSIVE`).
Env: `NOMUS_PRODUCTION_ORDERS_INCREMENTAL_SELECTOR_HOMOLOGATION`.
`dataAlteracao` é legado (não preferencial).
Não avançar estado incremental em rejeição ou execução incompleta.

## Amostra oficial — OP 05800 - 003

| Campo | Valor Nomus | Instant UTC |
|-------|-------------|-------------|
| status | Encerrada | — |
| empresa | 02 - KOPPETEL | — |
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
- Fixtures: `src/lib/fixtures/nomusProductionOrderOp05800.ts`, `nomusProductionOrderOp05967.ts`
