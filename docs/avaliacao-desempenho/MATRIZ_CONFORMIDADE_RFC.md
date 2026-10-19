# Matriz de conformidade — 40 RFCs

Auditoria refeita no código em 16/10/2026 pelo Claude Code, no worktree `induscost-claude`, branch `feature/avaliacao-desempenho-claude` (origem `2824a790`). O status anterior (3 PASS / 36 PARTIAL / 1 BLOCKED) **não** foi copiado: cada linha foi conferida contra código, teste e navegador.

## Como ler

- **Status** é técnico: PASS = implementado, conectado à tela, protegido no backend, com teste automatizado e, quando há tela, percorrido no navegador. BLOCKED = a parte que falta depende de decisão ou infraestrutura externa. PARTIAL = há lacuna técnica conhecida. FAIL = não funciona.
- As outras três dimensões ficam separadas, como pede a missão: uma RFC tecnicamente completa não é rebaixada por falta de aprovação, mas a aprovação nunca é presumida.
  - **Impl.** = implementação técnica (Completa / Incompleta).
  - **Verif.** = verificação técnica (Aprovada / Reprovada).
  - **Regra** = homologação da regra empresarial (Pendente em todas: nenhuma regra foi aprovada pelo RH, direção ou jurídico).
  - **Lib.** = liberação operacional (Não autorizada em todas).
- Referências de teste: `svc` = `performanceService.test.ts`, `rotas` = `performanceRoutes.test.ts`, `pg` = `performancePrisma.integration.test.ts` (PostgreSQL local real), `dom` = `performanceDomain.test.ts`, `mig` = `performanceMigration.test.ts`, `pub` = `performancePublicSurface.test.ts`, `E2E nn` = passo do roteiro no Chrome real (ver [EVIDENCIAS_TESTES.md](EVIDENCIAS_TESTES.md)).

## Resultado

| Status | Quantidade |
| --- | ---: |
| PASS | 36 |
| PARTIAL | 0 |
| FAIL | 0 |
| BLOCKED | 4 (RFC-025, RFC-037, RFC-039, RFC-040) |
| Total | 40 |

## Matriz

| RFC | Status | Impl. | Verif. | Regra | Lib. | O que existe (arquivos) | Evidência | Risco residual / pendência |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 001 Cadastro oficial de Pessoas | PASS | Completa | Aprovada | Pendente | Não | Busca no `Employee` por nome, nome social, cargo e setor (`server.ts` `searchEmployees`); snapshot no participante; FK só para `Employee` | svc "classifica, não duplica…"; pg (FK real, sem órfãos); E2E 07 | O cadastro **não tem matrícula**: a busca por matrícula não existe porque o dado não existe. Snapshot guarda `registration = null` |
| 002 Hierarquia e responsáveis | PASS | Completa | Aprovada | Pendente | Não | Líder do cadastro; exceção do RH por seletor + motivo (`reassignLeader`, `LeaderDialog`); congelado na abertura; troca depois da abertura preserva a tarefa anterior | svc "devolução… troca de líder preserva a enviada"; E2E 08, 18b | — |
| 003 Capacidades e autorização | PASS | Completa | Aprovada | Pendente | Não | Recursos `admin.employees.performance[.calibration/.reports/.invites/.conduct]`; `/me` com a mesma decisão do guard; escopo ALL obrigatório para ação de RH no serviço | rotas "capacidades…", "deny vence"; svc "líder não executa ação de RH"; E2E 38 (403 x4), 40 (usuário desativado → 401) | Perfis de acesso reais precisam ser configurados pelo administrador |
| 004 Visões na ficha do colaborador | PASS | Completa | Aprovada | Pendente | Não | `PeoplePerformanceHistorySection` na aba Avaliações da ficha (mesmo registro); só resultado homologado; conduta fora | E2E 39 (ficha real); svc histórico com escopo | — |
| 005 Três pilares | PASS | Completa | Aprovada | Pendente | Não | `PILLARS`, 4 por pilar validado na publicação, sem nota total | dom; svc "nasce com 12 perguntas, 4 por pilar"; E2E 03 | — |
| 006 Questionário de 12 perguntas | PASS | Completa | Aprovada | **Pendente** | Não | Textos do modelo inicial pedido (Qualidade… Desenvolvimento), 2ª pessoa / 3ª pessoa, editor completo | svc; E2E 03–05, 14 | Redação precisa de aprovação do RH e de teste de leitura com operadores |
| 007 Escala e não observável | PASS | Completa | Aprovada | Pendente | Não | 4 níveis + "Não sei responder / Não tive oportunidade"; nada pré-selecionado; N/O não vira 0 | dom; svc "não sei não vira zero"; E2E 14 (pré-selecionadas = 0) | — |
| 008 Exemplos por função | PASS | Completa | Aprovada | **Pendente** | Não | `roleExamples` por pergunta (versionado), editor "Exemplos por cargo", líder vê só o exemplo do cargo da pessoa | svc "o líder vê só o exemplo do cargo da pessoa"; E2E 04, 20c | Conteúdo dos exemplos é do RH; casamento por nome do cargo do snapshot |
| 009 Versionamento e publicação | PASS | Completa | Aprovada | Pendente | Não | Rascunho/publicado/inativo; publicada imutável; duplicar cria v+1; histórico de versões no editor | svc; rotas `MODEL_LOCKED`; E2E 05 | — |
| 010 Ciclo de vida | PASS | Completa | Aprovada | Pendente | Não | 7 estados com guardas; voltar exige motivo; abertura exige aceite de piloto | svc; E2E 06, 09, 10, 23, 27, 32 | — |
| 011 Elegibilidade e exceções | PASS | Completa | Aprovada | **Pendente** (90 dias) | Não | Afastamento real (`HrAbsence`) e mudança de função/setor (`HrEmployeeHistory`) no período; exceção justificada na tela; 3 estados | svc; pg (afastamento real → insuficiente); E2E 07 | — |
| 012 Distribuição de tarefas | PASS | Completa | Aprovada | Pendente | Não | Índice único parcial de tarefa ativa; reabrir tela não duplica; troca de avaliador preserva versão | pg (sem duplicidade de ativa); svc | — |
| 013 Painel e prazos | PASS | Completa | Aprovada | Pendente | Não | Contadores com numerador/denominador, filtros por setor/cargo/líder, prazo alterado auditado com valor anterior | svc "painel concilia…"; E2E 33 | Lembrete fica com a RFC-039 |
| 014 Convite por QR | PASS | Completa | Aprovada | Pendente | Não | Token 32 bytes, só digest no banco, URL em fragmento; lote, individual, reemissão, revogação, cópia de link, validade ≤ prazo | svc; rotas; E2E 11, 11b, 12, 17c | — |
| 015 Confirmação de identidade | PASS | Completa | Aprovada | **Pendente** | Não | Código de 6 dígitos separado do QR, falado pelo RH, nunca impresso; 5 erros bloqueiam; expiração | svc; E2E 11b (folha sem código), 13 | Forma de entrega do código precisa de aprovação |
| 016 Portal mobile | PASS | Completa | Aprovada | Pendente | Não | Bundle público próprio (`avaliacao.html`), uma pergunta por tela, alvos de 56 px, progresso, revisão | E2E 12–17 (390, 360, 320 px sem rolagem lateral) | Meta de 8–10 min e compreensão só se medem com operadores reais |
| 017 Rascunho e retomada | PASS | Completa | Aprovada | Pendente | Não | Salvamento a cada toque, fila de reenvio sem internet, conflito de versão recarrega, sessão expirada avisada, envio idempotente | svc "salva por resposta…"; E2E 14c (offline → reenvio), 15–16 | Retenção do rascunho fica com a RFC-037 |
| 018 Preenchimento assistido | PASS | Completa | Aprovada | Pendente | Não | Motivo obrigatório, token de abertura de uso único, sessão de 30 min, confirmação da pessoa, autoria preservada, sessão encerrada no fim | svc "modo assistido…"; E2E 17d | — |
| 019 Fila do líder | PASS | Completa | Aprovada | Pendente | Não | Só tarefas atribuídas ao líder, filtros de situação e ciclo, prazo e atraso | svc; rotas IDOR; E2E 18b, 18c | — |
| 020 Formulário do líder e evidências | PASS | Completa | Aprovada | **Pendente** (exemplo nas notas 1 e 4) | Não | 3ª pessoa, exemplo obrigatório configurável, rascunho, retomada, envio com confirmação, autoavaliação só depois | svc; E2E 19–21 | — |
| 021 Divergências e revisão | PASS | Completa | Aprovada | **Pendente** (limiar 2) | Não | Comparação só após os dois envios; devolução com motivo cria nova versão; líder vê o motivo | svc; E2E 24b, 25 | — |
| 022 Cálculo por pilar | PASS | Completa | Aprovada | **Pendente** (mínimo 3/4) | Não | Média sem arredondar o corte, regras gravadas no resultado (`ruleSnapshot`) | dom (fronteiras 2,499/2,5/3,499/3,5); pg | — |
| 023 Validação técnica | PASS | Completa | Aprovada | Pendente | Não | Etapa de validação com critério escrito; sem evidência não valida | svc; E2E 26 | — |
| 024 Valores culturais | PASS | Completa | Aprovada | **Pendente** | Não | Cultura = 4 comportamentos com descrição e exemplos positivo/negativo, versionados no modelo; faixa própria; fora da Nine-Box | svc "cultura fica fora da Nine-Box"; E2E 28 | Valores oficiais e Código de Conduta precisam de aprovação da direção |
| 025 Ocorrências restritas | **BLOCKED** | Incompleta | — | Pendente | Não | Registro restrito (`recordConduct`, permissão `.conduct` estrita) que não altera resultado e não aparece em painel, histórico comum nem PDF | svc "ocorrência não muda resultado"; svc PDF sem ocorrência | Fluxo registro→triagem→apuração→conclusão **sem tela de propósito**: depende de processo de RH e parecer jurídico (sigilo, não retaliação) |
| 026 Nine-Box | PASS | Completa | Aprovada | **Pendente** (cortes) | Não | X desempenho validado, Y potencial; sem evidência fica fora; oficial só após homologação | dom; svc; E2E 28 | — |
| 027 Fila de calibração | PASS | Completa | Aprovada | Pendente | Não | Perspectivas lado a lado, N/O, divergências com competência, exemplos do líder, filtro por setor | svc; rotas (líder → 403); E2E 24 | — |
| 028 Homologação versionada | PASS | Completa | Aprovada | Pendente | Não | Ajuste com justificativa cria versão; original preservada; homologar e reabrir exigem permissão de calibração; quem participa não homologa | svc "validação e ajuste…", "reabrir homologado exige…"; E2E 26–27 | — |
| 029 Devolutiva e ciência | PASS | Completa | Aprovada | Pendente | Não | Ponto forte, desenvolvimento, ação; ciência ≠ concordância; contestação com fato; registro presencial; PDF com assinatura | svc; E2E 29, 36 | Operadores sem login veem a devolutiva impressa, não no celular |
| 030 PDI | PASS | Completa | Aprovada | Pendente | Não | Uma prioritária, extras justificadas, competência, prazo, situação, conclusão preservada | svc; E2E 30, 36 | Responsável é texto livre, não usuário |
| 031 Acompanhamento do PDI | PASS | Completa | Aprovada | **Pendente** (cadência) | Não | Check-in breve, filtros vencidas/30 dias, histórico com autor e data | svc; E2E 30, 37 | Aviso automático fica com a RFC-039 |
| 032 Painel do RH | PASS | Completa | Aprovada | Pendente | Não | KPIs com numerador/denominador, cultura, PDI, evolução por ciclo | svc; E2E 33 | — |
| 033 Nine-Box interativa | PASS | Completa | Aprovada | Pendente | Não | Filtros por setor, cargo e líder; oficial × preliminar; detalhe; alerta de baixa amostra; sem ranking | E2E 28 | — |
| 034 Histórico comparável | PASS | Completa | Aprovada | Pendente | Não | Snapshot de cargo/setor/líder, só homologado, sinal de metodologia diferente | svc; E2E 34, 39 | — |
| 035 PDF e exportações | PASS | Completa | Aprovada | Pendente | Não | `PrintDocumentShell` + `PrintHeader`; 6 tipos; código `DCP-…` e versão registrados; RBAC; CSV no escopo, neutralizado e auditado | svc "emite documento…"; rotas; E2E 31 (6 PDFs reais renderizados) | — |
| 036 Segurança do portal | PASS | Completa | Aprovada | Pendente | **Não** | Bundle separado sem rotas internas, guard de host com allowlist, CSP, cookie `HttpOnly`/`SameSite=Strict`/caminho restrito, limite de tentativas, só JSON | pub; rotas (415, 429, cookie); build (bundle sem `/api/hr/`) | Exposição fora da LAN (Cloudflare/Tailscale) não foi feita nem testada: exige autorização de infraestrutura |
| 037 LGPD | **BLOCKED** | Incompleta | — | Pendente | Não | Dados mínimos (portal mostra só o primeiro nome), logs sem conteúdo, conduta segregada, sem CPF/data como senha | rotas (500 sem dado sensível); svc | Base legal, aviso, retenção e expurgo dependem do jurídico |
| 038 Auditoria e integridade | PASS | Completa | Aprovada | Pendente | Não | Evento por convite, resposta, revisão, calibração, publicação, emissão e exportação; gravação recusa apagar ou reescrever auditoria | rotas "concorrência", "gravação que apagaria histórico"; pg | — |
| 039 Lembretes | **BLOCKED** | Incompleta | — | Pendente | Não | Planejamento de lembrete gravado; disparo recusado (`REMINDERS_DISABLED`) | svc | Não há canal aprovado (SMS, e-mail, WhatsApp) |
| 040 Piloto e gates | **BLOCKED** | Incompleta | — | Pendente | Não | Gates técnicos executados: testes, integração, navegador, build, bundle, migrations | [EVIDENCIAS_TESTES.md](EVIDENCIAS_TESTES.md) | Piloto com 8–12 pessoas reais exige autorização; nenhum deploy |

## O que mudou desde a auditoria anterior

- PARTIAL → PASS: 33 RFCs, com implementação nova ou verificação no navegador.
- Mantidas BLOCKED: 037 (LGPD).
- Novas BLOCKED: 025, 039, 040 — antes estavam como PARTIAL, mas a parte que falta é externa (processo jurídico, canal de mensagem, piloto autorizado). A parte técnica que não depende disso está feita e testada.
