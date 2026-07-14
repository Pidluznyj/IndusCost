# Encerramento / Termo de Distrato — Prestação de Serviços PJ

## Objetivo

Módulo **civil/contratual** para calcular o acerto e emitir o

**TERMO DE DISTRATO, ACERTO FINANCEIRO E QUITAÇÃO DE CONTRATO DE PRESTAÇÃO DE SERVIÇOS**.

Não é rescisão CLT. Destinado exclusivamente a prestadores PJ.

**Local na UI:** Financeiro → Fornecedores → **Encerramento de prestação**.

## Separação tela × documento

| Camada | Conteúdo |
|--------|----------|
| Tela — parâmetros internos | Valor mensal, dias médios/mês, horas/dia, horas/mês, valor hora/dia, proporção, dias adicionais — **não impressos** |
| Documento impresso / PDF | Partes, cláusulas, quadro com nomes civis, comissões, pagamento, quitação, assinaturas |

## Fórmulas (preservadas)

Padrão: `restDaysPerYear = 20`, `averageWorkedDaysPerMonth = 30`, `hoursPerDay = 8`.

```
proportionalRestDays = (restDaysPerYear / 12) * workedMonths   # ou * workedDays/365
dailyServiceAmount = monthly / averageWorkedDaysPerMonth
hourlyServiceAmount = monthly / monthlyHours
proportionalRestAmount = daily * proportionalRestDays
extraWorkedAmount = daily * extraWorkedDays
total = rest + extra + noticePenalty + commission + credits - discounts
```

A comissão **nunca** é recalculada neste módulo (apenas vínculo/leitura + lançamento manual).

## Nomes impressos

| Interno | Impresso |
|---------|----------|
| Descanso remunerado proporcional | Compensação contratual proporcional |
| Dias a mais trabalhados | Saldo adicional de serviços prestados |
| Multa sem aviso 30 dias | Compensação contratual pelo encerramento sem antecedência **ou** Valor negociado para encerramento contratual |
| Comissões | Comissões comerciais apuradas |
| Outros créditos | Outros valores devidos ao prestador |
| Outros descontos | Compensações e deduções contratualmente autorizadas |
| Total a pagar | VALOR LÍQUIDO DO ACERTO CONTRATUAL |

## Status

| Status | Significado |
|--------|-------------|
| `DRAFT` | Prévia / minuta (marca d’água) |
| `AWAITING_SIGNATURE` | Aguardando assinatura |
| `SIGNED_AWAITING_PAYMENT` | Assinado — quitação pendente de pagamento |
| `PAID_AND_SETTLED` | Pago e quitado (snapshot imutável) |
| `CANCELED` | Cancelado (histórico preservado; pode gerar nova versão) |

`FINALIZED` legado é migrado para `SIGNED_AWAITING_PAYMENT` (sem quitação automática).

## APIs

- CRUD + preview existentes
- `POST .../:id/status` — transição com validações
- `POST .../:id/finalize` — alias → `AWAITING_SIGNATURE`
- `POST .../:id/new-version` — nova DRAFT a partir de cancelado/quitado
- `GET .../:id/pdf` | `xlsx` | rota print HTML

## Migrations

- `20260722160000_supplier_service_termination_distrato_enums`
- `20260722161000_supplier_service_termination_distrato_fields`

Aplicar no servidor pelo fluxo normal do projeto (não fazem parte do commit de código do agente de deploy).

## Testes

```
npx tsx --test src/lib/suppliers/supplierServiceTerminationDistrato.test.ts
npx tsx scripts/qaSupplierServiceTermination.ts
```
