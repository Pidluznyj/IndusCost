# Progresso — prompts 00 a 12

Branch `feat/desempenho-cultura-potencial`. HEAD do `main` de origem: `9d833ade4547cecd1871d26067aff141a375ca87`. Nenhum commit desta entrega.

Flags no `.env.example`, todas em `0`: `PERFORMANCE_CYCLE_ENABLED`, `PERFORMANCE_OFFICIAL_PUBLICATION`, `PERFORMANCE_IDENTITY_OTP`, `PERFORMANCE_REMINDERS_ENABLED`.

A migration `prisma/migrations/20261016180000_hr_performance_cycle/migration.sql` foi escrita e revisada. Não foi aplicada a banco nenhum. `prisma generate` já tinha sido executado antes; não houve `migrate`.

| Prompt | Situação | Nota |
| --- | --- | --- |
| 00 | Feito como documentação posterior à leitura do código | Contratos em `UI_CONTRACT.md`, `DECISOES_PENDENTES.md` e nesta pasta. A implementação começou no mesmo ciclo de trabalho, não num commit separado. |
| 01 | Parcial | Tabelas novas, FK só para `Employee`, RBAC `employees.performance.*`, escopo de pessoas reutilizado. Sem cadastro paralelo. |
| 02 | Parcial | 12 perguntas propostas, três pilares, publicação imutável testada. Editor de texto/reordenação não está na tela. |
| 03 | Parcial | Máquina de estados e elegibilidade testadas. A tela cria e prepara ciclo. Não há seleção de pessoas na tela. Abrir o ciclo fica bloqueado com a flag de publicação desligada. |
| 04 | Parcial | Token só como digest, URL em fragmento, OTP com limite de tentativas, portal 404 com a flag desligada. Não há imagem de QR nem canal de entrega. |
| 05 | Parcial | Portal de uma pergunta, rascunho com versão, revisão e envio único. Modo assistido só na API. Sem teste de navegador. |
| 06 | Parcial | Fila exclui o próprio líder. Formulário com evidência nas notas 1 e 4. Autoavaliação só depois do envio. Sem teste de navegador. |
| 07 | Parcial | Médias, cultura e “não observável ≠ 0” testados. Cultura não entra no eixo. |
| 08 | Parcial | Cortes 2,499 / 2,5 / 3,499 / 3,5 testados. Homologação e veto de auto-homologação no serviço. Sem fila de calibração na tela. |
| 09 | Parcial | Devolutiva, ciência distinta de concordância e PDI no serviço, com teste. Sem tela. |
| 10 | Parcial | Contagens e grade 3×3 no painel. CSV com neutralização de fórmula. Sem PDF. Lembrete não dispara. |
| 11 | Parcial | Flags desligadas, sem Nomus, sem job, sem banco real. Piloto com pessoas fictícias na operação não foi executado na interface. |
| 12 | Feito | `RELATORIO_VALIDACAO_FINAL.md`. Veredito: não apto para piloto operacional. |

Na continuação do mesmo dia a tela passou a operar o ciclo (pessoas, QR, assistido, calibração, devolutiva, PDI e PDF). A gravação concorrente diverge por revisão do grafo. O veredito segue não apto para piloto com operadores: falta navegador, editor das 12 perguntas e o PDF no layout institucional.

Testes do módulo em 16/10/2026, comando:

`npx tsx --test src/lib/hrPerformance/performanceDomain.test.ts src/lib/hrPerformance/performanceService.test.ts src/lib/hrPerformance/performanceRoutes.test.ts src/lib/hrPerformance/performanceMigration.test.ts`

Resultado: 18 testes, 18 passaram, 0 falharam.

A auditoria de navegação (`runNavigationGroupingAudit`) fica `OK` depois de incluir `performance-cycle` no baseline. O teste “baseline versionado contém todos os módulos com path canônico” continua falhando em `commercial-policy`, item que já tinha `requiredPermissions: []` antes deste módulo.
