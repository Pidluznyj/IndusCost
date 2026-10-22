# Tendências de Mercado — diário de implementação

## Baseline

- Branch de origem: `main` em `14bf83f` (`feat(clientes): filtra o radar e bloqueia o grupo confirmado.`).
- Branch desta missão: `feat/market-global-indicators-history`.
- Worktree: `IndusCost-credito-grupo`. Outros worktrees de comissões, financeiro, estoque e RH não foram alterados.
- Sem commit e sem push.

## Objetivo

Painel **Tendências de Mercado** entre Indicadores Globais e Oportunidades, com séries diárias de PTAX compra/venda e Brent, lidas só de `PtaxSnapshot` e `CommoditySnapshot`.

## Decisões

- Períodos aceitos: `7d`, `30d` (padrão) e `90d`. Ausência do parâmetro vale `30d`. Qualquer outro valor responde `400`.
- Janela inclusive no dia civil de `America/Sao_Paulo`. `quoteDate` (`@db.Date`) permanece a data econômica, sem converter meia-noite UTC para o dia anterior.
- Um ponto por dia: último `SUCCESS` com preço positivo. Empate de `collectedAt` desempata pelo `id` maior.
- Variação diária usa a cotação válida anterior, mesmo fora da janela. Esse ponto anterior não entra no gráfico.
- Variação acumulada é da primeira à última observação **exibida** (`first_to_last_in_window`). Não se mistura com a variação diária.
- Brent é a última cotação registrada no dia, não fechamento oficial. `variationFromPrevious` do snapshot não entra na série.
- Dias sem cotação não são preenchidos. A linha do gráfico é linear, sem suavização que invente valores.
- `GET /api/market-intelligence/global-indicators/history` usa a mesma permissão de visualização da Inteligência de Mercado. Não coleta e não grava.
- O botão Atualizar continua no POST atual. Depois da resposta, um contexto React pede ao gráfico para reler os snapshots. Foco da aba também relê, sem coleta.
- Sem migration. Os índices de `quoteDate` já existem.

## Arquivos

Criados: motor puro, leitura Prisma, testes, painel, seção, contexto de revalidação e este diário.

Alterados: página de Inteligência de Mercado, seção dos cards (só notifica a revalidação), registro da rota e o smoke de autenticação.

Não alterados: `ptaxSnapshotJob.ts`, `brentCommodityJob.ts`, coletores, fontes BCB/Yahoo e o botão de coleta.

## Testes executados

- `npx tsx --test` do motor, da rota, do painel, dos indicadores, do ticker, da navegação de materiais, PTAX, Brent e do smoke de rotas.
- Motor, rota, painel, smoke e regressões de coleta/agenda passaram.
- `listRegisteredScheduledJobs` continua esperando 3 jobs e o código já devolve 4 (inclui a revisão semanal de CNPJ). Falha anterior a esta branch; as agendas `09:00/15:30` e `07:00/11:00/14:00/16:00` seguem nos testes que passaram.
- `npm run build` concluiu (Vite, cerca de 35 s). Avisos de chunk e ciclo do radar financeiro já existiam.
- `tsc --noEmit` com heap de 8 GB terminou com exit 2. Os arquivos novos não apareceram. O helper antigo `buildRefreshWarning` segue com dois erros de estreitamento de tipo; esta missão não mudou essas linhas.
- `git diff --check` sem apontamentos.
- localhost:3000 não respondeu. O servidor não foi iniciado, para não apontar a um banco desconhecido. Não houve inspeção visual no navegador nem consulta ao PostgreSQL.

## Próxima ação

Homologar em Suprimentos → Inteligência de Mercado com snapshots reais. Não há deploy.
