# Permissões específicas de RH e Central de acompanhamento

Branch `feat/performance-hr-roles`, criado sobre `feat/performance-leadership-180`. Desenvolvido e testado só localmente, em banco descartável com dados fictícios. Nada foi aplicado em homologação nem em produção.

## 1. Auditoria do controle de acesso anterior

| Achado | Efeito |
| --- | --- |
| Rotas protegidas por `requireResourceOrHrEditor`: quem tinha `employees.edit` (editor de RH) passava em todos os recursos do Desempenho, menos ocorrências | Permissão geral de RH abria calibração, relatórios com notas e a mesa com resultados |
| Alcance de toda a organização (escopo `ALL`) vinha só de `employees.edit` | Não havia como dar acompanhamento sem dar também acesso às notas |
| Com escopo `ALL`, `canActOnLeaderAssignment` liberava ler e escrever a avaliação de qualquer líder | O RH podia responder no lugar do líder |
| `admin.employees.performance:manage` cobria ciclos, modelos, participantes e devolutivas; homologar usava a permissão de calibrar | Sem separação entre preparar, consultar resultado, calibrar e homologar |
| `reportData` devolvia o resultado de todas as pessoas em qualquer documento, inclusive no consolidado | Relatório "agregado" levava resultado individual |

Os dados de autorização continuam no RBAC oficial: catálogo `src/lib/security/permissionContract/resources.ts`, chaves em `src/lib/permissionCatalog.ts`, perfis em `AccessProfile`. Não existe mecanismo paralelo de usuário ou permissão.

## 2. Permissões granulares

Recursos filhos de `admin.employees.performance`. Herança de pai para filho não existe no RBAC: cada uma é concedida à parte.

| Capacidade | Recurso : ação | Chave do perfil | Atalho do editor de RH |
| --- | --- | --- | --- |
| Entrar no módulo | `admin.employees.performance:view` | `employees.performance.view` | sim |
| Avaliar a própria equipe | `admin.employees.performance:update` | `employees.performance.evaluate` | sim |
| Acompanhar ciclos e participantes de toda a organização; situação de conclusão | `admin.employees.performance.tracking:view` | `employees.performance.tracking` | sim |
| Exportar relatório operacional (sem notas) | `admin.employees.performance.tracking:export` | `employees.performance.tracking.export` | sim |
| Criar e preparar ciclos (participantes, líderes, transições, lembretes) | `admin.employees.performance.cycles:manage` | `employees.performance.cycles.manage` | sim |
| Gerir modelos | `admin.employees.performance.models:manage` | `employees.performance.models.manage` | sim |
| Gerir convites e reenvios | `admin.employees.performance.invites:manage` | `employees.performance.invites` | sim |
| Acompanhar calibrações (situação, sem notas) | `admin.employees.performance.calibration:view` | `employees.performance.calibration.view` | **não** |
| Consultar resultados individuais | `admin.employees.performance.results:view` | `employees.performance.results` | **não** |
| Calibrar | `admin.employees.performance.calibration:manage` | `employees.performance.calibrate` | **não** |
| Homologar e reabrir resultado homologado | `admin.employees.performance.homologation:manage` | `employees.performance.homologate.manage` | **não** |
| Relatórios agregados | `admin.employees.performance.reports:view` | `employees.performance.report` | sim |
| Ocorrências confidenciais | `admin.employees.performance.conduct:manage` | `employees.performance.conduct` | **não** |

Por "atalho do editor de RH" entende-se o seguinte: quem tem `employees.edit` passa sem concessão própria. Quatro recursos ficam fora do atalho (`STRICT_PERFORMANCE_RESOURCES`): resultado, calibração, homologação e ocorrência. Para eles só vale a concessão explícita ou o SUPER_ADMIN. **Permissão geral de RH não abre dado confidencial.**

Compatibilidade: quem já tinha `employees.performance.manage` continua preparando ciclos, gerindo modelos e acompanhando. Não ganha resultado.

O código fica em `src/lib/hrPerformance/performancePermissions.ts`. `resolvePerformanceCaps` resolve as capacidades com o mesmo `can` dos guards, em que negação vence concessão. `canSeeResultOf` decide se o resultado de uma pessoa pode sair para quem pede.

## 3. Perfis funcionais (configuráveis)

Dois perfis de sistema, criados na tela de perfis de acesso como os demais (`SYSTEM_ACCESS_PROFILE_SEEDS`). Podem ser copiados e ajustados. As capacidades são independentes.

| Perfil | Permissões |
| --- | --- |
| **RH Operacional — Desempenho** | ver, acompanhar, exportar operacional, ciclos, convites, acompanhar calibração |
| **RH Gestor — Desempenho** | tudo do operacional + modelos, resultados, relatórios, calibrar, homologar |

Ocorrência confidencial não está em nenhum dos dois: é concessão excepcional, dada à parte. O SUPER_ADMIN deixa de ser requisito para administrar avaliações. O ciclo de vida (classificar como teste, inativar, reativar, excluir ciclo de teste) continua só SUPER_ADMIN, por decisão anterior.

## 4. Central de acompanhamento (aba "Acompanhamento")

`GET /api/hr/performance/cycles/:id/tracking` (`performanceTracking.ts`). Por participante, a situação de cada obrigação:

| Obrigação | Quem responde | Prazo |
| --- | --- | --- |
| Autoavaliação individual | a pessoa | autoavaliação |
| Avaliação individual pelo líder | o líder efetivo | líder |
| Avaliação ascendente (do próprio líder) | a pessoa | autoavaliação |
| Autoavaliação de liderança | o líder | autoavaliação |
| Avaliação de liderança pelo superior | o superior | líder |
| Calibração individual | RH (calibração) | — |
| Calibração de liderança | superior (ou RH, no topo) | — |
| Homologação | RH (homologação) | — |
| Devolutiva | líder; ciência pela pessoa | da devolutiva |

Situações: **não se aplica**, **pendente**, **iniciada**, **enviada**, **vencida** (prazo passado sem envio, ou coleta encerrada sem envio) e **concluída**. O motivo da pendência é operacional: convite não emitido, emitido e não acessado, acessado sem envio, revogado (com o motivo), bloqueado ou vencido; devolvida para revisão; sem líder; aguardando encerramento da coleta; aguardando validação técnica.

**Indicadores:** elegíveis; convites gerados; convites acessados com código; pesquisas iniciadas e concluídas (jornada inteira); participantes pendentes; avaliações de líderes pendentes; calibrações pendentes; obrigações vencidas; homologados; devolutivas concluídas; cobertura por setor e por diretoria.

**Convites entregues:** não há confirmação confiável de entrega, porque o QR é impresso e entregue em mãos. O indicador aparece como "—", e não como um número inventado. O dado confiável disponível é "acessado com código".

**Filtros:** ciclo, setor, diretoria (pelo organograma), líder responsável, modalidade (individual, liderança, calibração, homologação e devolutiva) e situação. Nenhum filtro é por nota.

**Ações:** reemitir convite (o anterior deixa de valer), revogar convite comprometido (com motivo) e exportar o relatório operacional em CSV (`GET …/tracking/export`, auditado como `CSV_OPERACIONAL`, protegido contra fórmula em planilha). As exceções continuam nos fluxos formais já existentes, todos com motivo e auditoria:
- elegibilidade e troca de líder, na aba Ciclos;
- calibração sem avaliação do líder, na Calibração;
- exceção de fonte na liderança.

## 5. Confidencialidade

- **Metadado × conteúdo.** O quadro da central não lê respostas: não toca em nota, comentário, evidência, quadrante, faixa ou índice. As leituras de toda a organização passam por corte por pessoa (`performanceDisclosure.ts`):
  - **Mesa do ciclo:** o resultado vira situação ("homologado", "calibrado", "preliminar · resultado restrito"). Devolutiva e PDI viram datas e situação, e as divergências somem.
  - **Painel:** a Nine-Box nominal fica fechada. Distribuições (cultura, PDI, média de liderança) só aparecem com relatório ou resultado e com pelo menos 5 pessoas no recorte, para que um filtro não isole alguém.
  - **Calibração:** quem só acompanha vê a situação. Médias, divergências e evidências do líder ficam com quem calibra ou consulta resultados.
  - **Liderança:** a lista sai sem o índice calibrado para quem só acompanha. O comparativo exige calibrar ou consultar resultados (ou ser o superior).
  - **CSV com quadrante e cultura:** exige consultar resultados.
  - **Documentos:** cada pessoa sem permissão de resultado sai sem resultado, inclusive no consolidado. Documento pessoal e Nine-Box nominal usam o escopo de resultado.
  - **Histórico do colaborador, devolutiva e PDI:** escopo de resultado. Sem `results`, só a própria equipe.
- **RH Operacional** sabe quem concluiu cada tarefa, quem responde e o prazo, mas não recebe nota, posição, evidência nem comentário em nenhuma rota.
- **RH Gestor** vê resultados individuais só com `results`. Calibrar, homologar e tratar ocorrência são concessões separadas.
- **Avaliação ascendente identificada:** nenhum perfil a abre, nem o SUPER_ADMIN. Ela continua só agregada, com 5 ou mais respostas, nas APIs, no CSV e no PDF (decisão da 180°).
- **Ninguém responde em nome de outra pessoa.** A avaliação do líder e a do superior só são gravadas pelo avaliador atribuído, e isso vale também para o SUPER_ADMIN. Os caminhos formais são trocar o líder com motivo, calibrar com exceção registrada ou o preenchimento assistido já previsto para a autoavaliação, em que a própria pessoa confirma.

## 6. Mudanças de comportamento a comunicar antes de implantar

1. Usuário com `employees.edit` que não é SUPER_ADMIN **perde** calibrar, homologar, consultar resultados e ocorrências pelo atalho. Para manter, atribua o perfil **RH Gestor — Desempenho** ou conceda as chaves.
2. Quem tinha `employees.performance.calibrate` não homologa mais só com isso. Homologar exige `employees.performance.homologate.manage`.
3. O RH e o SUPER_ADMIN não gravam mais a avaliação no lugar do líder.
4. A aba Nine-Box e "Devolutivas e PDI" aparecem só para quem avalia a equipe ou consulta resultados.

Nada disso exige migration. As chaves novas entram pelo código, e os perfis de sistema são criados ao abrir a tela de perfis de acesso.

## 7. Testes

| Suíte | Cobertura |
| --- | --- |
| `performancePermissions.test.ts` (12) | catálogo oficial; recursos estritos; capacidades por perfil; regra de resultado; central sem conteúdo; matriz de 16 endpoints × 6 perfis (RH Operacional, RH Gestor, líder, colaborador, sem permissão, SUPER_ADMIN); varredura de vazamento; ninguém responde pelo líder; auditoria de convites e do CSV |
| `accessProfiles.test.ts` | perfis de sistema e ausência de resultado, calibração, homologação e ocorrência no operacional |
| Módulo (`src/lib/hrPerformance/*.test.ts`) | 105/105 |
| Navegador, parte 10 (`part10-hr-roles.mjs`) | 10/10, estável em 4 rodadas seguidas |

Como repetir no navegador (só banco local): rodar a parte 9 e depois `npx tsx scripts/performance-e2e/seedHrRoles.mts` e `node scripts/performance-e2e/part10-hr-roles.mjs`.

## 8. Validação em homologação (a fazer, com dados sintéticos)

1. Implantar o branch. Não há migration nova além das já listadas na prontidão de release.
2. Abrir a tela de perfis de acesso uma vez, para que os dois perfis de sistema sejam criados.
3. Criar dois usuários de teste sem `employees.edit`, um com cada perfil.
4. Num ciclo de teste com dados sintéticos:
   - repetir a parte 10;
   - conferir os 403 do operacional nas rotas de resultado;
   - conferir que nenhuma tela do operacional mostra posição ou nota.
5. Revisar quem hoje calibra e homologa em homologação e atribuir o perfil Gestor antes do piloto (item 6).

## 9. Pendências

- RH: confirmar a divisão dos dois perfis (o operacional prepara ciclos? acompanha calibração?). As capacidades são independentes, então dá para ajustar sem código.
- RH/LGPD: registrar quem recebe `results` e `conduct` e por quê; revisar periodicamente.
- Entrega de convite: só existe "acessado com código". A confirmação de entrega exigiria um registro de entrega pelo RH, que não existe hoje.
