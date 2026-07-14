# Encerramento de Prestação de Serviço

## Objetivo

Módulo gerencial/contratual interno para calcular o valor a pagar no **encerramento de prestação de serviço** de um prestador vinculado a um fornecedor.

Não é rescisão CLT nem cálculo trabalhista. Termos oficiais:

- encerramento de prestação de serviço
- prestador / fornecedor
- descanso remunerado contratual
- valor proporcional de encerramento

**Local na UI:** Financeiro → Fornecedores → botão **Encerramento de prestação** (listagem e detalhe do fornecedor).

## Cálculo do descanso proporcional

Padrão: `restDaysPerYear = 20`.

### Modo por meses trabalhados (padrão)

```
proportionalRestDays = (restDaysPerYear / 12) * workedMonths
```

Exemplo (4 meses, descanso anual 20):

- dias proporcionais = `20 / 12 * 4` = **6,6667** (exibição: **6,67 dias**)
- valor dia = `monthlyServiceAmount / 30`
- valor descanso = `dailyServiceAmount * proportionalRestDays` (usa o valor cru dos dias antes do arredondamento de exibição)

Com mensal **R$ 6.000,00**:

- valor dia = **R$ 200,00**
- valor descanso proporcional = **R$ 1.333,33**

### Modo por dias corridos

```
proportionalRestDays = restDaysPerYear * workedDays / 365
```

### Valor hora (informativo)

```
hourlyServiceAmount = monthlyServiceAmount / monthlyHours
```

Aparece na tela e no relatório; **não** entra sozinho no total.

## Total do encerramento

```
totalTerminationAmount =
  proportionalRestAmount
  + commissionReportTotal
  + otherCredits
  - otherDiscounts
```

Comissão e descanso remunerado são blocos separados. A comissão **nunca** é recalculada neste módulo.

## Vínculo com relatório de comissão

O encerramento apenas **consulta e vincula** relatórios oficiais do módulo de Comissões (ledger / pessoa canônica / aliases), via:

`GET /api/suppliers/service-terminations/commission-reports/search?searchName=...`

Não altera cálculo de comissão, comissão paga, fechamento, base comissionável nem liberação por recebimento.

## Status

| Status     | Significado                                      |
|------------|--------------------------------------------------|
| `DRAFT`    | Prévia editável                                  |
| `FINALIZED`| Snapshot travado (não recalcula automaticamente) |
| `CANCELED` | Cancelado                                        |

## Permissões

Chaves canônicas e aliases:

- `finance.suppliers.service_termination.view` / `suppliers.serviceTermination.view`
- `...create` / `...update` / `...finalize` / `...export` / `...cancel`

`SUPER_ADMIN` / `ADMIN` e quem tem `finance.suppliers.manage` têm acesso operacional amplo. O backend valida permissão (403); o frontend só esconde ações.

## Relatório final

- **PDF** — `GET /api/suppliers/:supplierId/service-terminations/:id/pdf`
- **XLSX** — `GET /api/suppliers/:supplierId/service-terminations/:id/xlsx`

Seções: identificação, base de cálculo, proporcional, comissões vinculadas, ajustes, totalização.

Rodapé: documento IndusCost; cálculo gerencial/contratual de encerramento de prestação de serviço.

## APIs principais

- `GET/POST /api/suppliers/:supplierId/service-terminations`
- `GET/PUT .../:id`
- `POST .../preview` — calcula sem persistir definitivo
- `POST .../:id/finalize` — trava snapshot
- `POST .../:id/cancel`
- `GET .../commission-reports/search`

## Observação

Este documento descreve um **cálculo gerencial/contratual** de encerramento de prestação de serviço. Não substitui assessoria jurídica trabalhista nem folha de pagamento CLT.
