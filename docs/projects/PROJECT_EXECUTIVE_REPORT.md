# Relatório Gerencial Executivo de Projetos

## Objetivo

O relatório gerencial executivo apresenta, em formato adequado para impressão ou PDF pelo navegador, a visão consolidada de um projeto para aprovação da diretoria: investimentos, amortização, custos finais, riscos e decisão solicitada.

A tela operacional do projeto continua servindo para editar e configurar. O relatório serve para **apresentar, justificar investimento, demonstrar custos, explicar amortização e facilitar decisão/aprovação**.

## Onde acessar

- Botão **Gerar relatório gerencial** no cabeçalho do projeto
- Botão **Gerar relatório gerencial** na aba **Custos do Projeto**
- Rota dedicada: `/projects/:projectId/report`

Permissões: `projects.view` ou `projects.manage`.

## Seções do relatório

1. Cabeçalho (projeto, cliente, status, responsáveis, versão)
2. Objetivo / escopo
3. Resumo executivo financeiro
4. Decisão solicitada (texto gerado + checkboxes)
5. Itens do projeto (somente itens raiz elegíveis)
6. Moldes
7. Outros custos (lotes `other-cost-batch-{uuid}`)
8. Memória de amortização
9. Resultado econômico / comercial (quando houver preço)
10. Riscos e observações (alertas automáticos)
11. Aprovação / assinaturas

O **anexo técnico** (BOM detalhada, árvore, histórico) está preparado na UI, porém desabilitado nesta versão.

## Origem dos dados

Montagem centralizada em `src/lib/projectsExecutiveReport.ts`, reutilizando:

- `buildProjectCostAmortizationSummary` — mesmos números da aba Custos do Projeto
- `computeProjectGuidedCosts` — custo total do projeto e itens pendentes
- `buildProjectAmortizationTargets` — itens raiz (produto oficial, componente, simulado, legado)
- `listAmortizableCostSources` / `resolveOtherCostItemLineTotal` — moldes e outros custos

Não há endpoint dedicado: o frontend carrega `GET /api/projects/:id` e monta o relatório localmente.

## Fórmulas usadas

| Conceito | Fórmula / origem |
|----------|------------------|
| Custo base dos itens | Soma dos custos unitários base dos itens elegíveis (`baseItemsUnitCost`) |
| Investimento em moldes | Soma dos moldes (`totalMoldsCost`) |
| Outros custos | Soma dos lotes (`totalOtherCosts`), linha = quantidade × valor unitário |
| Investimento total | Moldes + outros custos |
| Valor repassado via amortização | Soma dos `passThroughAmount` configurados |
| Valor absorvido internamente | Soma dos `absorbedAmount` |
| Custo final dos itens | Soma dos custos unitários finais com amortização alocada |
| Custo total do projeto | `computeProjectGuidedCosts().totalProjectCost` (legado + investimentos, sem duplicar amortização nos moldes) |
| Margem estimada | `((Preço de venda - Custo final) / Preço de venda) × 100` quando houver preço sugerido |

## Relação com a aba Custos do Projeto

Os campos do resumo executivo financeiro do relatório correspondem diretamente aos cards da aba **Custos do Projeto**. Se a aba exibir um valor, o relatório deve exibir o mesmo valor, pois ambos usam `buildProjectCostAmortizationSummary` (ou `detail.costAmortizationSummary` persistido pela API).

## Como imprimir / salvar PDF

1. Abra `/projects/:projectId/report`
2. Clique em **Imprimir / Salvar PDF**
3. No diálogo do navegador, escolha destino **Salvar como PDF**
4. Desative **Cabeçalhos e rodapés** nas opções de impressão para layout mais limpo

A impressão usa CSS `@media print` em `src/project-executive-report-print.css`, ocultando botões de ação e aplicando layout A4.

## Como validar os números

1. Abra o projeto na aba **Custos do Projeto**
2. Anote: custo base, moldes, outros custos, repassado, absorvido, custo final dos itens, custo total
3. Gere o relatório gerencial
4. Compare seção a seção — os valores devem coincidir

Testes automatizados: `npm run test:projects` (`projectsExecutiveReport.test.ts`).

## Limitações atuais

- Anexo técnico desabilitado (próxima versão)
- Sem geração de PDF no backend
- Resultado comercial depende de `costBreakdown.suggestedPrice`; se ausente, exibe análise pendente
- Custo total do projeto segue visão legada do fluxo guiado (`unitCost + moldes + outros custos`)

## Arquivos principais

- `src/lib/projectsExecutiveReport.ts`
- `src/components/projects/ProjectExecutiveReportPage.tsx`
- `src/components/projects/ProjectExecutiveReport.tsx`
- `src/components/projects/ProjectExecutiveReportButton.tsx`
- `src/project-executive-report-print.css`
