# OP-22 — Release candidate da tela de Ordens de Produção

Data: 2026-07-16
Escopo: consulta e auditoria **somente leitura** de Ordens de Produção.

## Visão funcional

A tela **Operações → Ordens de Produção** consulta exclusivamente o PostgreSQL
local. Ela oferece paginação server-side, busca, filtros, status reais, grid
compacto e drawer amplo de auditoria. Não cria, edita, libera, encerra, cancela,
requisita ou sincroniza Ordens de Produção.

## Rotas, permissões e APIs

| Item | Contrato |
|---|---|
| Página | `/production-orders` |
| Menu | Grupo `Operações`, item `Ordens de Produção` |
| Resource | `operations.production_orders` |
| Ação | `view` |
| Listagem | `GET /api/operations/production-orders` |
| Detalhe | `GET /api/operations/production-orders/:id` |
| Proteção de API | `requireAppAuth` + `requireResource(..., "view")` |
| SUPER_ADMIN | Mantém o bypass oficial do sistema |

Menu, rota e APIs usam a mesma decisão de acesso. Usuários sem `view` não veem
o item e recebem negação ao acessar a rota/API diretamente.

## Filtros e paginação

- busca geral: OP, código/descrição do produto, cliente e Pedido de Venda em
  vínculo atual;
- status: valores reais retornados em `statusCounts`;
- tipo;
- empresa;
- período inclusivo de `openedAt`, interpretando datas civis em
  `America/Sao_Paulo`;
- `pageSize=50`, máximo da API igual a 200;
- ordenação: `openedAt desc nulls last`, `externalId desc`;
- debounce de 300 ms e cancelamento da requisição anterior;
- filtros e página refletidos na URL.

## Colunas do grid

1. Ordem;
2. Tipo;
3. Empresa;
4. Produto;
5. Quantidade;
6. Prioridade;
7. Data de abertura;
8. Data planejada;
9. Status;
10. Pedido de Venda;
11. Última sincronização.

Quantidades são serializadas como string e formatadas sem perder decimais.
Datas são exibidas em pt-BR. Valores ausentes aparecem como `—`.

## Conteúdo do drawer

- cabeçalho com OP, status, tipo, ID Nomus, empresa e última sincronização;
- resumo;
- produto;
- datas;
- vínculos atuais, removidos e pendentes de Pedido de Venda;
- IDs externos e referências locais de pedido/item;
- primeira/última visualização e data de remoção de cada vínculo;
- auditoria interna e `payloadHash`;
- payload original sanitizado, escapado, fechado por padrão e copiável.

O deep link usa somente a rota existente `/sales-orders/:id`.

## Auditoria final dos requisitos

| # | Requisito | Status | Evidência |
|---:|---|---|---|
| 1 | Menu no local correto | OK | Grupo Operações validado em `productionOrdersPage.test.ts` |
| 2 | Rota protegida | OK | Rota mapeada e decisão de acesso testada |
| 3 | Resource permission correta | OK | `operations.production_orders` + `view` |
| 4 | API de listagem somente leitura | OK | Apenas `GET`; repository usa leitura |
| 5 | API de detalhe somente leitura | OK | Apenas `GET`; `findUnique` |
| 6 | Paginação server-side | OK | `skip/take`, total e pageSize limitado |
| 7 | Busca funcional | OK | OR case-insensitive e vínculos atuais |
| 8 | Filtro de status | OK | Igualdade pelo valor real |
| 9 | Filtro de tipo | OK | Igualdade em `tipo` |
| 10 | Filtro de empresa | OK | `contains` case-insensitive |
| 11 | Filtro de período | OK | `openedAt`, limites inclusivos e validação de intervalo |
| 12 | Status reais do banco | OK | `groupBy status`, sem enum inventado |
| 13 | Quantidades decimais corretas | OK | `15400` e `0.002925` cobertos |
| 14 | Datas em pt-BR | OK | Helpers e componente testados |
| 15 | Campos nulos tratados | OK | `null` preservado na API e `—` na UI |
| 16 | OP sem pedido | OK | Estado explícito testado |
| 17 | OP com vários pedidos | OK | Primeiro chip +N; drawer exibe todos |
| 18 | Vínculo atual | OK | Estado `current_resolved` |
| 19 | Vínculo removido | OK | Histórico visível, sem exclusão |
| 20 | Vínculo pendente | OK | Mensagem e badge explícitos |
| 21 | Drawer completo | OK | Seis seções, loading/erro e fechamento acessível |
| 22 | Raw JSON seguro | OK | Sanitização, escape e teste de cópia |
| 23 | Navegação para Pedido de Venda | OK | `/sales-orders/:id`, sem ação dupla da linha |
| 24 | Nenhuma chamada direta ao Nomus | OK | Cliente usa somente API local; import check verde |
| 25 | Nenhuma mutação | OK | Nenhum POST/PUT/PATCH/DELETE ou método Prisma de escrita |
| 26 | Nenhuma regra protegida alterada | OK | Escopo isolado; confirmação abaixo |
| 27 | Sem N+1 | OK | Cabeçalhos + um lote de vínculos; detalhe em uma consulta |
| 28 | Build de produção | OK | Vite build concluído |
| 29 | Testes direcionados | OK | OP, APIs, página e permissões verdes |
| 30 | Suíte geral aplicável | OK | 253/253 testes |

## Domínios protegidos

O release candidate da tela não altera regras, cálculos, estados ou persistência
de:

- Pedido de Venda;
- NF-e;
- Documento de Saída;
- Contas a Receber;
- Contas a Pagar;
- Fluxo de Caixa;
- Comissões;
- Precificação;
- BOM;
- Relatório Presidencial;
- sincronização oficial de Ordens de Produção.

A interface apenas lê as tabelas locais. Os scripts oficiais de sincronização,
backfill, incremental, lookup, reconciliação e reparo permanecem fora do fluxo
do browser. A suíte completa de OP valida a baseline atual desses scripts.

## Evidências de validação

| Comando | Resultado |
|---|---|
| `npx prisma format` | OK |
| `npx prisma validate` | OK |
| `npm run test:nomus:production-orders` | OK — 236/236 |
| `npm run test:production-orders-api` | OK — 39/39 |
| `npm run test:production-orders-page` | OK — 33/33 |
| `npm run test:resource-navigation` | OK — 47/47 |
| `npm run test:operations-admin-permissions` | OK — 11/11 |
| `npm run test:permission-contract` | OK — 51/51 |
| `npm test` | OK — 253/253 |
| `npm run check:frontend-server-imports` | OK — 700 arquivos |
| `npm run check:server-imports` | OK |
| `npm run build` | OK |
| `npm run check:browser-bundle` | OK — dist sem Prisma |

## Limitações e riscos residuais

1. `status=null` é exibido como “Sem status”, mas não possui chip específico.
2. Paginação por offset é adequada ao volume atual de milhares de OPs; páginas
   muito profundas devem ser monitoradas antes de considerar cursor.
3. Busca e empresa usam `contains`; se o volume crescer significativamente,
   medir com `EXPLAIN ANALYZE` antes de adotar `pg_trgm`.
4. O Overlay oficial ainda não possui focus trap completo; teclado, Escape,
   rótulos e foco inicial seguem o padrão existente.
5. O build mantém o aviso global já conhecido de chunk principal acima de
   500 kB; não é regressão da tela.
6. O PostgreSQL local de validação (`localhost:5432`) estava indisponível
   (`P1001`), portanto `prisma migrate status` não pôde confirmar o estado real
   do banco. `prisma format`, `prisma validate`, migration e testes estáticos
   ficaram verdes.

## Instruções de deploy

1. Confirmar backup e janela de deploy.
2. Confirmar `DATABASE_URL` do ambiente correto.
3. Executar `npx prisma migrate status`.
4. Executar `npx prisma migrate deploy`.
5. Validar o catálogo de permissões com
   `npm run permissions:seed:contract:dry`.
6. Se o preview estiver correto, executar
   `npm run permissions:seed:contract:apply`.
7. Garantir `view` em `operations.production_orders` apenas para os perfis
   autorizados; SUPER_ADMIN não exige override.
8. Executar `npm ci` e `npm run build`, ou publicar o artefato já validado.
9. Reiniciar o serviço conforme o procedimento operacional do ambiente.
10. Executar o smoke test abaixo antes de liberar aos usuários.

Nenhum backfill ou sincronização Nomus precisa ser iniciado pelo deploy da UI.

## Smoke test de produção

1. Usuário autorizado vê `Operações → Ordens de Produção`.
2. Usuário sem permissão não vê o item e recebe 403 na API.
3. A página abre sem chamada de rede para domínio Nomus.
4. A listagem retorna 200, total, status e paginação.
5. Busca e cada filtro retornam resultado coerente.
6. Data final inclui todo o dia selecionado.
7. Quantidade inteira e decimal pequena não são arredondadas incorretamente.
8. OP sem pedido mostra `—`.
9. OP com vários pedidos mostra primeiro pedido e `+N`.
10. Drawer abre/fecha, mantém filtros e exibe vínculos atuais, removidos e
    pendentes.
11. Pedido local abre em `/sales-orders/:id`.
12. Payload técnico fica fechado, sanitizado e copiável.
13. Quando disponível, validar OP `30347` / `OP 05800 - 003`, pedido `2530`,
    item `11324` e `PD 02534`.
14. Confirmar ausência de POST/PUT/PATCH/DELETE no Network.
15. Confirmar ausência de erro novo nos logs do servidor.

## Estratégia de rollback

1. Reimplantar o artefato/commit anterior da aplicação.
2. Reiniciar o serviço e repetir o smoke básico de autenticação e módulos
   protegidos.
3. Não apagar OPs, vínculos, Pedidos de Venda ou payloads locais.
4. As migrations da UI são aditivas (recursos/índices) e podem permanecer sem
   efeito funcional no artefato anterior.
5. Somente se houver exigência operacional comprovada, remover os três índices
   OP-21 em janela controlada; isso não é necessário para rollback da aplicação.
6. Reverter grants de `operations.production_orders` apenas se a tela precisar
   ser ocultada antes da troca do artefato.

## Decisão

**Release candidate aprovado para deploy**, condicionado à execução de
`prisma migrate status/deploy` contra o banco real e ao smoke test no ambiente
de produção.
