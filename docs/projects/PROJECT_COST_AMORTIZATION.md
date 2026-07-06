# Amortização de custos no projeto

## Conceito

Moldes e outros custos do projeto podem ser tratados como investimento separado e, ao mesmo tempo, **parcial ou totalmente repassados ao cliente** via amortização embutida no custo dos itens do projeto.

- **Valor repassado ao cliente**: entra no custo final dos itens (via custo unitário amortizado).
- **Valor absorvido internamente**: permanece como custo/investimento da empresa, sem duplicar no custo dos itens.

Projetos apenas agrupa, custeia e simula orçamento. Esta regra **não altera** cadastro oficial, BOM, simulações originais, Nomus ou Financeiro.

## Fórmulas

### Valor repassado e absorvido

```text
valorRepassado = custoTotal × percentualRepassado / 100
valorAbsorvidoInternamente = custoTotal - valorRepassado
```

### Alocação por item

```text
valorAlocadoAoItem = valorRepassado × percentualDistribuicaoDoItem / 100
custoUnitarioAmortizadoDoItem = valorAlocadoAoItem / quantidadeAmortizacaoDoItem
custoFinalUnitarioDoItem = custoBaseUnitarioDoItem + custoUnitarioAmortizadoDoItem
```

### Saldo de distribuição

```text
saldoDistribuicao = 100% - soma(percentualDistribuicaoDosItens)
```

Tolerância decimal: `99,9999%` até `100,0001%` é considerado **Distribuído 100%**.

## Exemplo 80/20 + 60/40

```text
Molde total: R$ 52.000,00
Percentual repassado: 80%
Valor repassado: R$ 41.600,00
Valor absorvido: R$ 10.400,00

Item A: 60% → R$ 24.960,00 / 20.000 = R$ 1,248 por peça
Item B: 40% → R$ 16.640,00 / 10.000 = R$ 1,664 por peça
```

## Onde configurar na UI

**Projetos → [projeto] → Custos do Projeto**

1. Resumo executivo (cards de custo base, moldes, repasse, absorção, custo final).
2. Tabela de custos amortizáveis (moldes e outros custos).
3. Botão **Configurar amortização** abre modal com percentual repassado e distribuição por item.
4. Tabela consolidada **Distribuição por item** após salvar.

## Validações

| Regra | Comportamento |
| --- | --- |
| Percentual repassado | Obrigatório, 0–100%, default 100% |
| Distribuição entre itens | Deve somar 100% para status OK |
| Distribuição &lt; 100% | Status *Distribuição incompleta* |
| Distribuição &gt; 100% | Bloqueia salvamento |
| Quantidade de amortização | Obrigatória e &gt; 0 quando % &gt; 0 |

## Remoção de item

Ao remover um item do projeto que recebia amortização:

1. As alocações vinculadas ao `targetItemId` são removidas.
2. O status da amortização é recalculado (geralmente *Distribuição incompleta*).
3. A aba Custos exibe alerta correspondente.

Ao remover molde ou lote de outro custo, a configuração de amortização da fonte é excluída.

## Persistência

Models Prisma:

- `ProjectCostAmortization` — configuração por fonte (`MOLD` | `OTHER_COST`)
- `ProjectCostAmortizationAllocation` — distribuição por item elegível

Identificadores de fonte:

- **MOLD**: `sourceId` = `ProjectMold.id` (UUID)
- **OTHER_COST**: `sourceId` = `batchId` do lote em `ProjectSimulatedItem.notes` (ex.: `other-cost-batch-{uuid}`), persistido em `sourceBatchId`

O campo `sourceId` é `TEXT` no banco para suportar o batch id de outros custos.

API:

- `GET /api/projects/:id/cost-amortizations`
- `PUT /api/projects/:id/cost-amortizations`
- `DELETE /api/projects/:id/cost-amortizations/:sourceType/:sourceId`

## Código principal

- `src/lib/projectsCostAmortization.ts` — cálculos puros
- `src/lib/projectsCostAmortizationService.ts` — persistência
- `src/components/projects/ProjectGuidedCostsTab.tsx` — UI da aba
- `src/components/projects/ProjectCostAmortizationModal.tsx` — modal de configuração

## Itens elegíveis

- Produto oficial importado (`engineering_clone`)
- Componente/produto legado no projeto
- Produto simulado vindo de Simulações (`simulation_ref`)

Não elegíveis: moldes, outros custos, matérias-primas sem custo unitário de produto acabado.
