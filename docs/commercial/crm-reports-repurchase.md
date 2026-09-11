# CRM > Relatórios — recompra, listas operacionais e construtor

Documento de referência da aba **CRM > Relatórios**: o que ela mostra, de onde
vêm os números, como a recompra é calculada, quem vê o quê, como conferir e o
que falta. O contrato detalhado dos endpoints (JSON de request/response) está
em [crm-reports-repurchase-engine.md](./crm-reports-repurchase-engine.md).

## Objetivo

Dar ao comercial uma leitura operacional da carteira a partir da **única
autoridade de compra do sistema — o Pedido de Venda**:

- quem comprou nos últimos 60 dias;
- o ciclo de recompra de cada cliente e quem deve comprar nos próximos 15 dias;
- quem está atrasado para recomprar (com contato e follow-up);
- um construtor de relatórios sob demanda (vendas por cliente, responsável,
  vendedor do pedido, mês/ano, cidade/UF; situação de recompra).

Nenhum número da aba nasce de regra própria: tudo é consumo do canônico.

## Fontes

| Eixo | Fonte | Uso |
|---|---|---|
| Compra | `SalesOrder` pela população canônica `crmCanonicalSalesOrderWhere` → `buildSalesOrderListWhere(…, { excludeEconomicGroupCustomers: true })` — a mesma da tela Pedidos de Venda | quantidade, valor, datas, recompra |
| Data da compra | `SalesOrder.issueDate`, dia civil local do servidor | janelas, ocasiões |
| Carteira | `CrmCustomerCommercialOwner` ativo (Responsável Comercial) | escopo e filtro "Responsável Comercial" |
| Vendedor Nomus | `SalesOrder.externalSellerId` do último pedido | coluna/filtro "Vendedor do último pedido" (auditoria) |
| Relacionamento | `CommercialActivity` | último contato, próximo follow-up (só lista de atrasados) |
| Cliente | `Customer` ativo, fora do grupo econômico | universo |

**Não criam compra:** NF, proposta, atividade comercial, comissão, títulos
(liquidação/recebimento/vencimento). Status: só `CANCELLED` fica fora — `ERROR`
entra, porque a tela oficial conta.

## Data lineage

```
Customer (ativo, fora do grupo)  ──┐
CrmCustomerCommercialOwner ativo ──┼─► universo autorizado (escopo global | carteira própria)
                                   │     └─► filtros de inclusão (cliente, responsável, cidade, UF,
                                   │         vendedor do último pedido) → matchedBeforeExclusions
                                   │           └─► seleção analítica EXCLUDE / ONLY → analyzedCustomers
SalesOrder canônico (lotes de 1.000 clientes, histórico inteiro) ──► pedidos por cliente
                                   │
                                   ▼
             dia civil de issueDate → ocasiões (dias distintos) → motor de recompra
                                   │
         ┌─────────────────────────┼──────────────────────────┬─────────────────────┐
         ▼                         ▼                          ▼                     ▼
   5 indicadores            3 listas paginadas        relatório personalizado   CSV / XLSX
   (cards)                  (+ responsável, vendedor, (mesmo universo, agrega  (mesmo corpo, lista
                            follow-up em lote)         pedidos/fatos)            inteira + metadados)
```

Um pipeline só (`runCrmReportsAnalysis`) alimenta cards, listas, construtor e
exportação — o guard estático falha se alguém consultar pedido por fora.

## Regra de ocasião

- **Ocasião de compra = dia civil distinto** de `issueDate` (fuso do servidor,
  o mesmo do filtro "Emissão" de Pedidos de Venda).
- 3 pedidos no mesmo dia = 3 pedidos em quantidade/valor e **1 ocasião** na recompra.
- Pedido com emissão **depois de hoje** fica fora das janelas e da cadência e
  é contado em `sourceInfo.futureDatedOrdersIgnored` (aviso visível).
- Janelas: 60d = hoje + 59 dias anteriores; 12m = (hoje − 12 meses) + 1 dia … hoje.

## Últimas 6 ocasiões (`LAST_6_DISTINCT_PURCHASE_DAYS_MEAN_V1`)

1. Ordena as ocasiões do **histórico inteiro** e usa as **últimas 6** (no máximo 5 intervalos).
2. Intervalos = dias de calendário entre ocasiões consecutivas (nunca ms/24h).
3. Média aritmética simples; arredonda (meio para cima) **só** para achar a data.
4. `próxima compra esperada = última ocasião + round(média)`.
5. `delta = hoje − esperada` (positivo = atrasado).

## Confiança

| Ocasiões usadas | Confiança | Rótulo |
|---|---|---|
| 0 ou 1 | `NONE` | Sem histórico |
| 2 | `LOW` | Baixa |
| 3 ou 4 | `MEDIUM` | Média |
| 5 ou 6 | `HIGH` | Alta |

## Status

| Situação | Status | Texto na tela |
|---|---|---|
| nenhuma compra | `NO_HISTORY` | Sem histórico |
| 1 ocasião | `INSUFFICIENT_HISTORY` | Sem cadência suficiente (sem previsão) |
| delta < −15 | `ON_TIME` | Em dia · recompra em N dias |
| −15 ≤ delta ≤ 0 | `DUE_SOON` | Recompra em N dias / prevista para hoje |
| 1 ≤ delta ≤ 30 | `OVERDUE` | Atrasado · N dias |
| delta > 30 | `SEVERELY_OVERDUE` | Muito atrasado · N dias |

Os cards reconciliam com as listas **por construção**: "Compraram nos últimos
60 dias" = lista 1; "Recompra nos próximos 15 dias" = lista 2 filtrada em
`DUE_SOON`; "Recompra atrasada" = lista 3; "Atrasados > 30 dias" = lista 3 em
`SEVERE`; "Sem cadência suficiente" = lista 2 em `INSUFFICIENT_HISTORY`.

## Filtros

| Filtro | Eixo | Observação |
|---|---|---|
| Cliente | inclusão | busca escopada por nome, fantasia ou CNPJ (≥ 2 caracteres, debounce 300 ms) |
| Responsável Comercial | carteira | só no escopo global; no escopo próprio é ignorado (carteira forçada) |
| Vendedor do último pedido | auditoria Nomus | filtra dentro do universo já autorizado — nunca amplia acesso; a cadência usa todas as compras |
| Cidade / UF | cadastro do cliente | igualdade sem caixa/acento |

Visões das listas (cards e chips) só selecionam/ordenam o resultado do motor:
situação na lista 2; recorte > 30 dias e ordenação "maior venda 12m" na lista 3.

## Exclusões

"Ocultar clientes" é um recorte **analítico enviado ao backend**
(`filters.customerSelection`): `ALL` · `EXCLUDE` (tira os clientes) · `ONLY`
(mantém só os clientes). Vale igual para universo, cards, listas, construtor e
exportação. Não altera cadastro nem carteira. ID fora do universo é ignorado e
contado (`selection.idsOutsideUniverse`). Marcação por linha → "Ocultar
selecionados" / "Mostrar somente selecionados".

## Permissões

- Aba: recurso `comercial.crm.tab.relatorios` (contrato `commercial.crm.reports:view`, alias legado `crm.reports.view`).
- Presets de papel: ADMIN, COMMERCIAL_MANAGER e SELLER veem; VIEWER não. **Perfis de Acesso** precisam marcar "CRM — Relatórios".
- Dados: escopo comercial do CRM (`requireCrmCommercialDataScope`) — global, carteira própria (Responsável Comercial do usuário) ou nenhum (403).
- Ações por linha só aparecem com a permissão da tela de destino: Cliente 360 (`CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS`), pedido (`commercial.sales_orders.detail:view`), contato (`commercial.crm.activities:create`).

## Endpoints

| Rota | Uso |
|---|---|
| `POST /api/crm/reports/operational` | universo, cards, 1 página de cada lista (abertura e cada mudança) |
| `GET /api/crm/reports/filter-options` | opções agregadas dos filtros (1× na abertura) |
| `GET /api/crm/reports/customer-options` | busca escopada de clientes |
| `POST /api/crm/reports/custom` | relatório personalizado — só no clique "Gerar relatório" |
| `POST /api/crm/reports/operational/export` | lista 1/2/3 inteira em CSV/XLSX |
| `POST /api/crm/reports/custom/export` | relatório personalizado inteiro em CSV/XLSX |

Todas: sessão → `commercial.crm.reports:view` → escopo CRM; nenhuma escreve.
Erros explícitos: 400 (filtro/spec inválido), 403 (sem escopo), **422** quando
passa do teto (400.000 pedidos no universo ou 50.000 linhas no personalizado) —
nunca devolve número truncado.

## Reconciliação

Critério por cliente e no total do universo: **quantidade delta 0 · dinheiro
delta R$ 0,00 · data igual** para pedidos 60d, valor 60d, última compra,
pedidos 12m e valor 12m, contra `buildSalesOrderListWhere` agregado no banco
(o lado oficial da tela Pedidos de Venda, com os mesmos limites de dia civil
`T00:00:00`/`T23:59:59.999`). Cliente INATIVO com pedido é aviso (regra de
elegibilidade), não divergência. Se divergir: corrige-se o Relatórios, nunca o
canônico.

A conferência da recompra é refeita **à mão** por uma implementação
independente (`crmRepurchaseManualAudit.ts`: agrupa por dia, últimas 6
ocasiões, aritmética inteira de calendário) e comparada campo a campo com a
resposta do endpoint; nos testes, as duas concordam em 2.000 históricos
aleatórios.

## Performance

- Abertura da aba: 2 requests (`filter-options` + `operational`); o construtor não consulta nada até "Gerar".
- Pedidos em lotes de 1.000 clientes (nº de consultas = ⌈clientes/1.000⌉, nunca uma por cliente); responsável, vendedor e follow-up em lote só das linhas das páginas.
- Mudança de filtro/visão/página = 1 request; o anterior é cancelado. Sem cache persistente: cada request refaz a análise (teto explícito 422).
- Aba em chunk próprio carregado sob demanda (~80 KB); SheetJS só no servidor.
- Índices: nenhuma migration nesta entrega. O filtro de pedidos por lote de `customerId` usa `SalesOrder(customerId)` / `(customerId, issueDate)`; índice novo só com EXPLAIN real provando necessidade.

## Testes

| Suíte | O que prova |
|---|---|
| `npm run test:crm-reports` | motor, núcleo, serviço (where canônico real sobre fixtures), personalizado, exportação, rotas, guard, UI, verificador, conta manual (propriedade 2.000 casos) e evidências |
| `npm run test:customers` | suíte CRM inteira (outras abas não quebram) |
| guard `crmReportsSourceGuard.test.ts` | nenhuma regra própria: status/SQL/NF/proposta/comissão/datas erradas, vendedor Nomus como carteira, `rows.length` como total, conta de data na UI, papel fixo, consulta paralela de pedido, auditoria dentro do runtime |

## Como auditar (homologação — somente leitura)

No servidor da homologação, depois do deploy oficial (`induscost-deploy-homologacao`),
na pasta da app, com o `DATABASE_URL` já existente:

```bash
npm run verify:crm-reports                 # universo inteiro × Pedidos de Venda (sai 1 se divergir)
npm run verify:crm-reports -- --customer=<uuid>[,<uuid>…]
npm run evidence:crm-reports               # relatório completo de evidências em tmp/*.md
npm run evidence:crm-reports -- --user=<email> --user=<email> --runs=5
npm run explain:crm-reports                # EXPLAIN (ANALYZE, BUFFERS) do SQL exato do Prisma
```

As três ferramentas abrem **uma** conexão em sessão
`default_transaction_read_only` com `statement_timeout` (conferida antes e
depois) — qualquer escrita seria recusada pelo PostgreSQL. As evidências
cobrem: reconciliação (universo + amostra: muitos/poucos pedidos, vários no
mesmo dia, ERROR, CANCELLED, com/sem responsável, vendedor ≠ responsável),
recompra à mão × endpoint (alta frequência, esporádico, atrasado, uma compra,
vários pedidos no mesmo dia), EXCLUDE/ONLY (universo, cards, listas, arquivo),
escopo por usuário real, desempenho (p50/máx, payload, round-trips, consultas
SQL) e construtor (totais e subtotais). Na interface, conferir no DevTools que a
abertura só chama `filter-options` e `operational`.

## Limitações

- Sem cache: cada mudança refaz a análise do universo (proteção: teto 422).
- Construtor V1 sem margem, recebimento, propostas e produtos.
- Cidade/UF de seleção única na tela (o contrato aceita listas).
- Lista 3 (16 colunas) rola na horizontal em telas ≤ 1600 px (Ações fixas).
- Sem remoção de outliers na média de recompra.
- "Hoje" = dia civil do fuso do servidor.
- Perfis de Acesso existentes não ganham a aba sozinhos (marcar "CRM — Relatórios").

## Estado da homologação (11/09/2026)

Código validado localmente e no resultado do merge com `origin/main` (testes,
guards, build, typecheck). A homologação `induscost-homolog` (`:3001`) ainda
servia `f3369eeb` (sem a aba). O deploy oficial roda no servidor e implanta
`origin/main`; o banco não é acessível fora do servidor — as evidências acima
ficam pendentes até o deploy e a execução dos comandos no servidor.
