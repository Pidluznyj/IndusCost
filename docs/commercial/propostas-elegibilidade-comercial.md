# Propostas sem valor comercial importadas do Nomus — elegibilidade comercial (29/10/2026)

## Cenário (teste_bi, PostgreSQL 17)

1.823 propostas do Nomus; 70 com `totalNetValue <= 0`, nenhuma com item mapeado nem pedido de venda.
Ex.: CP 01818 a 01822 (JAIRO M AVELINO LTDA): `valorTotal=0`, `valorTotalNfe=42.900`, `totalItems=0`.
Elas apareciam no grid e entravam em contagens, ticket médio e conversão.

## Regra única — `src/lib/proposalCommercialEligibility.ts`

| Classe | Condição | Grid padrão | Indicadores |
|---|---|---|---|
| `EFFECTIVE` | líquido > 0 | visível | conta |
| `ZERO_WITH_SALES_ORDER` | líquido <= 0 com pedido vinculado | visível, marcada "revisar" | conta (o pedido existe) |
| `NOMUS_ZERO_WITH_ITEMS` | Nomus, líquido <= 0, com item mapeado, sem pedido | visível, marcada "revisar" | não conta |
| `NOMUS_WITHOUT_COMMERCIAL_VALUE` | Nomus, líquido <= 0, sem item mapeado, sem pedido | **oculta** | não conta |
| `LOCAL_WITHOUT_VALUE` | não Nomus, líquido <= 0, sem pedido (em elaboração) | visível, marcada | não conta |

- Predicados Prisma: `PROPOSAL_DEFAULT_GRID_VISIBILITY_WHERE` (grid), `PROPOSAL_COMMERCIAL_METRICS_WHERE`
  (indicadores: líquido > 0 OU pedido vinculado), `PROPOSAL_NOMUS_WITHOUT_COMMERCIAL_VALUE_WHERE` (as ocultas).
  A função pura `classifyProposalCommercialEligibility` dá a mesma resposta (teste cobre as 36 combinações).
- Visibilidade escrita de forma positiva: `NOT` sobre `sourceSystem` nulo descartaria propostas locais no SQL.
- Valor bruto (`valorTotalNfe` → `totalGrossValue`) nunca torna a proposta válida e nunca vira líquido.
- Nada é gravado: a classe é calculada na consulta. Nova sincronização reclassifica sozinha; não há script de limpeza.

## Onde a regra entra

- `GET /api/proposals` (`server.ts` → `src/lib/proposalListPage.server.ts`): visibilidade no `where` do `findMany` e do
  `count` (antes de ordenar e paginar); totalizadores na população comercial. Filtros compostos por `AND`
  (corrige dois desvios antigos: "convertidas" ignorava a busca porque `{ ...where, OR }` sobrescrevia o `OR` da
  busca; "em aberto" ignorava o status filtrado). Cada linha traz `commercialEligibility` (marca visual).
- Filtro administrativo "Exibir propostas sem valor comercial" (`includeWithoutCommercialValue=1`), desligado por
  padrão, só para quem tem `proposals.edit` (ACL oficial, conferida no servidor). Muda o grid, **não** os indicadores.
  A tela mostra quantas ficaram ocultas no filtro atual.
- Cards: propostas no ano/mês, em aberto, valor proposto, ticket médio, convertidas, taxa — mesma população.
- Gráfico de conversão YTD (`proposalConversionYtd.server.ts`): mesma população dos cards.
- CRM, "propostas em negociação" do cliente: mesma população.
- Detalhe por ID (`GET /api/proposals/:id`): sem filtro, para auditoria.
- Não alterado (fontes próprias): faturamento, pedidos de venda, vínculos Proposta × PV, funil (não lê propostas).
- Revisado e mantido: relógio de inatividade da carteira (POL-COM-001) usa proposta como evidência de contato
  histórico, não como indicador comercial — mudar exigiria decisão da política.

## Qualidade da integração (separada da conversão)

`GET /api/proposals/integration-quality` (`proposals.edit`, somente leitura) — Nomus com líquido <= 0:
sem itens na origem · itens na origem e nenhum mapeado (item sem `codigoProduto` é descartado pelo sincronizador) ·
líquido zero · bruto positivo e líquido zero · com pedido vinculado (revisar) · com itens mapeados e valor zero.
Lê `externalRawPayload.itensProposta`, `valorTotal` e `valorTotalNfe` sem alterar nada.

## Sincronização Nomus

`scripts/nomusProposalsSyncV1.ts` **não foi alterado**: continua importando propostas zeradas, sem mexer em código
externo, `externalRawPayload`, cliente, itens ou vínculos, e sem copiar `valorTotalNfe` para `totalNetValue`.

## Implantação

Sem migration, sem índice novo, sem seed. Os predicados usam colunas já indexadas (`sourceSystem`,
`commercialDate, number`) e `EXISTS` em `ProposalItem(proposalId)` e `SalesOrder(proposalId)` (ambos indexados/únicos).

```bash
induscost-deploy-homologacao
```

Conferência em homologação (somente leitura, recusa qualquer escrita):

```bash
npx tsx scripts/auditProposalCommercialEligibility.ts --code=01818 --code=01822 --code=01823
```

Esperado com os dados de 29/10: ocultas = 70; "Grid + ocultas = total? sim"; CP 01818–01822 OCULTA / fora dos
indicadores; CP 01823 VISÍVEL / nos indicadores; indicadores DEPOIS sem as 70.
