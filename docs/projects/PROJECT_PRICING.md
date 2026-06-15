# Precificação comercial no módulo Projetos

## Objetivo

A seção **Precificação comercial** na aba **Custos do Projeto** calcula o preço sugerido de venda dos itens simulados do projeto, reutilizando a mesma regra da **Calculadora de Preço de Venda** (Formação de Preço).

## Onde fica

```text
Projetos → [projeto] → Custos do Projeto → Precificação comercial
```

## Como funciona

1. O sistema lista apenas **itens simulados** (referências de Simulações) elegíveis.
2. Para cada item, usa o **custo final unitário** já calculado na aba Custos (base + amortização).
3. Aplica a **regra fiscal** selecionada (mesma tabela `TaxRule` do sistema).
4. Aplica a **margem desejada** (padrão = margem do projeto, editável por item).
5. Calcula o **preço sugerido** e grava no projeto (`ProjectPricingConfig` + `ProjectPricingItem`).

## Fórmula

Mesma regra da Calculadora de Preço de Venda (versão simplificada para projeto: imposto + margem):

```text
Preço sugerido = custo final / (1 - imposto% - margem%)
Valor impostos = preço × imposto%
Valor margem = preço × margem%
```

A margem é **sobre o preço de venda**, não markup.

Não usar:

```text
Preço = custo × (1 + margem)  ← incorreto
```

## Origem do custo

```text
custoParaPrecificar = custoFinalUnitarioComAmortizacao
```

Vem de `buildProjectCostAmortizationSummary().itemRollups` — o mesmo motor da aba Custos.

Moldes e outros custos **não** entram como itens precificáveis; só via amortização já embutida no custo final.

## Regra fiscal

Carregada de `TaxRule` + `TaxComponent` (mesma fonte de Formação de Preço).

O endpoint `GET /api/projects/:id/pricing` retorna as regras fiscais ativas para o select, sem exigir permissão `taxes.view` no frontend.

## Persistência

| Tabela | Conteúdo |
|--------|----------|
| `ProjectPricingConfig` | Regra fiscal padrão, margem padrão |
| `ProjectPricingItem` | Snapshot por item simulado: custos, impostos, margem, preço |

Não altera produto oficial, simulação original, Formação de Preço nem cadastro mestre.

## API

- `GET /api/projects/:id/pricing` — `projects.view`
- `PUT /api/projects/:id/pricing` — `projects.manage`

## Relatório gerencial

Quando há precificação salva, o relatório executivo exibe preço, regra fiscal, impostos, margem e composição por item.

Sem precificação salva:

```text
Análise comercial pendente de definição de preço e margem.
```

## Arquivos principais

- `src/lib/pricingCalculations.ts` — fórmula pura
- `src/lib/projectsPricing.ts` — montagem da view
- `src/lib/projectsPricingService.ts` — persistência
- `src/components/projects/ProjectPricingSection.tsx` — UI

## Limitações (v1)

- Somente itens `SIMULATION` (referência de Simulações)
- Não inclui comissão, frete nem outras variáveis da formação de preço completa (apenas imposto + margem, conforme escopo do projeto)
- Requer migration `20260622120000_project_pricing`
