# OP-21 — Checklist de auditoria da tela de Ordens de Produção

Data da auditoria: 2026-07-16.

Escopo: menu, página, APIs locais de listagem/detalhe, filtros, status, grid,
drawer e integração de permissão. Nenhum dado de produção foi criado ou
alterado.

## Checklist funcional e técnico

| Requisito | Status | Evidência | Teste correspondente | Pendência real |
|---|---|---|---|---|
| Layout e espaçamentos | OK | Cabeçalho oficial fica somente no `ModulePageShell`; filtros compactos e drawer usam espaçamentos do Design System | `productionOrdersPage.test.ts` — página base e renderização das seções | Nenhuma |
| Tipografia | OK | Hierarquia de breadcrumb, título, metadados, cabeçalho e campos densos | Auditoria visual OP-21 com componentes reais | Nenhuma |
| Contraste | OK | Texto semântico e tons claros `emerald`, `sky`, `amber`, `rose`, `slate` | `badges representativos mantêm contraste suave` | Nenhuma |
| Badges | OK | Liberada, encerrada, cancelada, planejada, pendente e desconhecida têm fallback | `mapeia badges claros`; `badges representativos` | Nenhuma |
| Responsividade | OK | Filtros passam de 1 para 2/6 colunas; drawer usa grid responsivo | Auditoria visual desktop e viewport estreito | Nenhuma |
| Scroll horizontal | OK | Grid `min-w-[1280px]` e `overflow-x-auto`; vínculos usam `OverlayTable` rolável | `ProductionOrderGridTableRow`; auditoria visual | Nenhuma |
| Paginação | OK | `pageSize=50`, `skip/take`, total e correção automática de página fora do limite | `paginação, filtros, statusCounts e ausência de N+1`; teste de wiring UI | Paginação por offset é suficiente para milhares; reavaliar cursor somente com telemetria de páginas profundas |
| Debounce | OK | Busca/tipo/empresa usam 300 ms e resetam página no mesmo commit de estado | `polimento evita request na página antiga` | Nenhuma |
| Cancelamento | OK | Cada alteração aborta a requisição anterior com `AbortController` | `implementa debounce, URL, cancelamento` | Nenhuma |
| Loading da lista | OK | Primeiro carregamento tem estado completo; atualizações preservam as linhas e exibem indicador discreto com `role=status` | `polimento ... semântica acessível` | Nenhuma |
| Loading do drawer | OK | Estado próprio e requisição cancelável | `drawer usa overlay oficial ... loading` | Nenhuma |
| Estados vazios | OK | Diferencia catálogo vazio de filtros sem resultado | `página base contém estados obrigatórios` | Nenhuma |
| Erros | OK | Lista e drawer têm erro próprio; HTTP 500 não expõe mensagem interna do banco | `classifica erros`; `rota não expõe mensagem interna` | Nenhuma |
| Preservação dos filtros | OK | Filtros/página ficam na URL e o drawer usa estado local sobre o grid | `implementa debounce, URL...`; teste do drawer | Navegação externa para Pedido de Venda troca de rota por ação explícita |
| Acessibilidade | OK | Caption, nomes acessíveis, teclado Enter/Espaço, grupo de filtros, `aria-pressed`, alert/status e dialog rotulado | `polimento ... semântica acessível`; `drawer usa overlay oficial` | O Overlay oficial ainda não implementa focus trap completo; pendência transversal do Design System |
| Página com milhares de OPs | OK | Paginação server-side; somente 50 cabeçalhos e vínculos da página são materializados | `listProductionOrdersForGrid` | Busca `contains` em texto/relações pode exigir `pg_trgm` se o volume crescer muito |
| Índice da ordenação | OK | Índice composto `openedAt, externalId` | `schema possui índices compostos`; migration OP-21 | Aplicar migration no deploy |
| Índices de filtros | OK | Índices compostos para `status` e `tipo` com a ordenação padrão | Mesmo teste e migration | `companyName contains` não aproveita B-tree; monitorar antes de adicionar extensão/GIN |
| Período de abertura | OK | Datas civis cobrem 00:00:00–23:59:59.999 em `America/Sao_Paulo`; intervalo invertido é bloqueado na UI | `data civil cobre o dia inteiro`; helpers de UI | Nenhuma |
| Ausência de N+1 | OK | Cabeçalhos em uma consulta; links da página em uma consulta agregada; detalhe em uma consulta com include | `ausência de N+1`; `consulta única com includes` | Nenhuma |
| Seleção mínima | OK | Lista usa `PRODUCTION_ORDERS_GRID_SELECT`; detalhe carrega apenas relações necessárias | Testes de repository/API | O detalhe inclui o `rawJson` por requisito de auditoria |
| API local | OK | Browser chama apenas `/api/operations/production-orders` | `módulo não importa cliente Nomus` | Nenhuma |
| Ausência de mutações | OK | Rotas registram somente `GET`; services usam `findMany/count/groupBy/findUnique` | Testes das rotas e repositories | Nenhuma |
| Permissões | OK | Menu, rota e APIs usam `operations.production_orders`/`view` | `production orders navigation`; testes das rotas | Nenhuma |
| Navegação para Pedido de Venda | OK | Usa somente a rota confirmada `/sales-orders/:id` e impede ação dupla da linha | `um vínculo resolvido mostra ... rota oficial`; teste do grid | Nenhuma |
| Status reais | OK | Chips vêm de `statusCounts`; grid e drawer reutilizam o mesmo componente/tom; desconhecidos permanecem visíveis | `mapeia badges claros e preserva status desconhecido` | Registros com `status=null` aparecem como “Sem status”, mas não possuem chip filtrável no contrato atual |
| Busca por vínculos | OK | Cliente e Pedido de Venda pesquisam somente vínculos atuais, coerentes com o que o grid exibe | `monta OR de busca e filtros combinados` | Vínculos removidos continuam pesquisáveis apenas no drawer de auditoria |
| Datas nulas na ordenação | OK | `openedAt desc nulls last`; OPs sem abertura não ocultam as mais recentes | `ordenação mantém openedAt nulo no fim` | Nenhuma |
| Raw JSON isolado | OK | Accordion fechado, texto escapado e cópia do payload sanitizado | Testes `rawJson` e `copiar JSON` | Nenhuma |
| Vínculos históricos | OK | Removidos permanecem no detalhe e recebem badge próprio | `vários vínculos mantêm removido e pendente visíveis` | Nenhuma |
| Simplicidade/YAGNI | OK | Reutiliza Overlay, OverlayHeader, OverlaySection, OverlayBadge e OverlayTable; não cria DataTable genérica sem necessidade | Revisão de componentes OP-21 | Nenhuma |

## Casos representativos auditados

| Caso | Status | Evidência | Teste correspondente | Pendência real |
|---|---|---|---|---|
| OP 30347 / OP 05800 - 003 | OK | Fixture oficial e harness visual | `renderiza colunas...`; testes do drawer | Disponibilidade no banco local depende do ambiente |
| Pedido 2530 / item 11324 / PD 02534 | OK | IDs oficiais e deep link local no grid/drawer | `um vínculo resolvido mostra pedido, item local e rota oficial` | Nenhuma |
| OP sem pedido | OK | Célula `—` e estado explícito no drawer | `OP sem vínculo exibe estado explícito` | Nenhuma |
| OP com um pedido | OK | Chip/código oficial e dados mínimos do item | Testes do grid e drawer | Nenhuma |
| OP com vários pedidos | OK | Primeiro chip +N no grid; linhas completas no drawer | `mostra primeiro pedido e +N`; teste de vários vínculos | Nenhuma |
| OP liberada | OK | Badge azul suave | `badges representativos` | Nenhuma |
| OP encerrada | OK | Badge verde claro | `badges representativos` | Nenhuma |
| OP cancelada | OK | Badge vermelho claro | `badges representativos` | Nenhuma |
| Quantidade inteira | OK | `15400.000000` → `15.400`, sem casas inúteis | `renderiza ... quantidade inteira` | Nenhuma |
| Decimal pequeno | OK | `0.002925` → `0,002925`, sem arredondamento | `preserva decimal pequeno` | Nenhuma |
| Datas ausentes | OK | Exibição `—`, sem data inventada | `campos nulos aparecem como travessão` | Nenhuma |
| Vínculo pendente | OK | Texto explícito no grid e badge âmbar no drawer | Testes de vínculo pendente | Nenhuma |
| Vínculo removido | OK | Linha histórica preservada no drawer | `vários vínculos mantêm removido e pendente visíveis` | Nenhuma |

## Resultado da auditoria visual

- **Desktop:** grid denso, mas legível; código e descrição mantêm hierarquia;
  badges têm contraste suave; quantidade, datas e chips não colidem.
- **Viewport estreito (390 × 844):** grid preserva a largura mínima e usa scroll
  horizontal, sem comprimir o conteúdo; drawer passa os campos para uma coluna,
  mantém título/fechamento legíveis e não corta as seções.
- **Drawer:** seções permanecem visualmente separadas; vínculos usam tabela
  rolável; payload técnico fica fechado por padrão.
- **Casos usados:** fixture OP 05800 - 003 e variações de teste para sem pedido,
  múltiplos pedidos, liberada, encerrada, cancelada, decimal pequeno, data
  ausente, vínculo pendente e vínculo removido. O harness foi temporário e não
  gravou dados na aplicação ou no banco.

## Decisões de performance

1. Mantida a paginação por offset por ser simples, compatível com o contrato
   existente e adequada ao volume de milhares de registros.
2. Adicionados apenas os índices compostos que atendem à ordenação e aos filtros
   exatos comprovados. Não foi adicionada extensão `pg_trgm` sem métrica real.
3. `statusCounts` continua em consulta agregada paralela; nenhuma linha completa
   ou `rawJson` é carregada na listagem.
4. A consulta de vínculos permanece uma única busca limitada aos IDs da página.

## Validações

- `npx prisma format`
- `npx prisma validate`
- `npm run test:production-orders-page`
- `npm run test:production-orders-api`
- `npm run test:nomus:production-orders`
- `npm test`
- `npm run build`
