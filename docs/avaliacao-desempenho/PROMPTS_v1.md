# IndusCost — Plano de execução incremental no Cursor

**Versão 1.0 · 16/10/2026**  
**Documento de origem:** `IndusCost_RFCs_Avaliacao_Desempenho_Cultura_Potencial_v1.md` (40 RFCs).  
**Objetivo:** implementar no código local, de forma incremental e rastreável, o módulo de Gestão de Desempenho, Cultura e Potencial, preservando padrões existentes do IndusCost.

> **Uso recomendado:** disponibilize o catálogo das 40 RFCs no workspace do Cursor e envie o **PROMPT 00**, depois os prompts numerados, na ordem. Caso utilize execução autônoma/encadeada, cada etapa deverá cumprir todos os gates da etapa anterior. **Não autorizar SSH, deploy, acesso a banco real, sincronização Nomus, commit, push ou merge.** O último prompt é uma auditoria de conformidade, não uma autorização para produção.

## Contrato operacional obrigatório — prepend em todos os prompts

Você é o engenheiro de software sênior responsável por implementar o módulo **Gestão de Desempenho, Cultura e Potencial** no repositório local do IndusCost, com foco em segurança, simplicidade para colaboradores fabris e aderência à arquitetura existente.

### Limites operacionais absolutos
- Atue apenas no **workspace local** aberto no Cursor. Não use SSH, SCP, VPN, túneis, serviços AWS, banco de homologação, banco de produção, endpoints do Nomus, crons externos nem integrações remotas. Não altere servidores.
- Não faça deploy, não rode migrations contra bancos reais, não execute scripts de backfill em ambiente real, não modifique serviços systemd. Para validar schema use banco descartável/local explicitamente identificado, ou apenas validação estática quando banco isolado não existir.
- Não faça `commit`, `push`, `merge`, `rebase`, `reset --hard`, `git clean`, `stash`, nem force operations sem autorização expressa. Não apague nem sobrescreva modificações preexistentes, não misture arquivos de outros projetos.
- Inspecione `git status --short`, branch, remoto, `HEAD` e alterações preexistentes antes de começar. Em caso de conflitos ou working tree sujo, trabalhe conservadoramente, isolando apenas arquivos novos/necessários; se impossível, pare a mudança conflitante e documente.
- Prefira implementar reutilizando Prisma, backend, frontend, design system, autenticação/RBAC, serviços RH, relatórios PDF, logging, auditoria e padrão de testes já existentes. **Não crie arquitetura concorrente.** Descubra antes de nomear arquivos, endpoints, libs ou modelos.
- Para novas dependências, justifique, verifique compatibilidade com o lockfile e evite instalar pacotes por conveniência. Nunca exponha segredos nos artefatos, logs, URL, console ou respostas.
- Não afirme que teste passou sem sua saída, que mudança foi deployada ou que regra gerencial foi aprovada. Diferencie `IMPLEMENTADO`, `TESTADO`, `BLOQUEADO`, `PENDENTE DE HOMOLOGAÇÃO`.
- Quando encontrar decisões de negócio não aprovadas, implemente **configuração desligada/draft ou contrato extensível sem ativação**, identifique pendência e prossiga com entregas independentes. Nunca invente regra de RH para fechar tarefa.

### Padrões de engenharia e UX
- Aplicação nativa ao IndusCost: navegação consistente, espaçamentos/tokens tipográficos/cores/ícones/tabelas/modais/filtros/toasts/estados vazios/erros/validação padrão existentes. Não copie visual de outro produto, não invente tema. Responsividade mobile-first no portal; área gerencial otimizada para notebook.
- Simplicidade: 12 perguntas-base, uma pergunta por tela no celular, linguagem clara, botões com alvo de toque amplo (referência 44×44 CSS px), progresso, Voltar/Próxima, opção `Não sei / Não tive oportunidade` sem nota, revisão antes de envio, salvar e retomar, erros compreensíveis. Compatibilidade com teclado e leitor de tela; usar semântica HTML e WCAG 2.2 AA como referência onde viável.
- Não confundir autoavaliação, avaliação do gestor e feedback 360º completo. No MVP: autoavaliação + gestor; visões adicionais opcionais e não obrigatórias.
- Três pilares independentes: técnico, cultura e potencial; cultura **não compõe artificialmente** os dois eixos da Nine-Box. Nine-Box X = desempenho, Y = potencial, sempre como resultado preliminar até calibração/homologação autorizada.
- A escala `1 Nunca ou quase nunca`, `2 Às vezes`, `3 Na maioria das vezes`, `4 Sempre ou quase sempre`, `Não sei/Não tive oportunidade` mede frequência observada. Não chame `4` de desempenho excepcional por equivalência automática. O desempenho técnico requer validação baseada em evidências/critério da função.
- Dados: evitar registros duplicados; usar chaves oficiais, FKs, constraints e transações. Ciclo e modelo versionados com snapshot; contexto histórico de cargo/setor/gestor congelado; avaliações finalizadas imutáveis salvo revisão versionada; audit log seguro sem dados sensíveis desnecessários.
- Segurança: escopo por usuário e hierarquia validado **no backend** em cada leitura, escrita e exportação; deny > allow; token não é sessão administrativa; sem QR público coletivo; tokens aleatórios de alta entropia com digest em repouso, validade e revogação, rate limiting e prevenção de enumeração; dados privados segregados; LGPD.
- Roteiros de testes: happy path, negações de permissão, casos extremos, concorrência, regressões e limites. Tests não devem acessar Nomus ou bases reais.

### Protocolo obrigatório em cada etapa
1. Ler catálogo RFC, documentos existentes e saídas das etapas anteriores em `docs/avaliacao-desempenho/` (crie pasta apenas se não existir equivalente melhor no projeto).
2. Inventariar implementação existente; identificar o que reutilizar, o que está parcial e o que falta; confirmar contratos atuais do projeto.
3. Escrever miniplano da etapa e critérios PASS/FAIL; implementar apenas o escopo deste prompt e dependências necessárias.
4. Validar lint/format/typecheck/build/testes com comandos **reais** descobertos em `package.json` e ferramentas do projeto. Quando scripts não existirem, relatar honestamente; não criar falso gate.
5. Inspecionar diff; confirmar ausência de segredos, dados pessoais reais, acessos remotos, regressões e arquivos gerados indevidos.
6. Atualizar um `docs/avaliacao-desempenho/PROGRESSO.md` (ou documento equivalente existente), com RFC, arquivos, decisões, testes/saídas, riscos, pendências, status e próxima etapa.
7. No resumo, indicar: concluído, não concluído, bloqueado, controles implementados, testes executados e próximo prompt. **Não prossiga automaticamente se gate crítico falhou.**

---

## PROMPT 00 — Auditoria inicial, plano e contratos (não implementar telas de negócio)

**Missão:** mapear o IndusCost real e criar o plano de implementação das 40 RFCs do documento-fonte. Esta etapa é investigativa e documental, salvo ajustes mínimos de scaffolding sem efeitos operacionais.

1. Identificar stack, layouts principais, rotas, navegação RH, schema Prisma/modelos de colaboradores, status/gestores/departamentos/cargos, middleware de auth, controle de permissões, patterns de controller/service/repository, testes, PDFs, auditoria, jobs e error handling.
2. Localizar qualquer avaliação 360º, matriz de competências, ficha, PDI, rotas públicas controladas, QR Code, 9-box ou funcionalidades correlatas já existentes; não presumir inexistência.
3. Construir matriz `RFC → status (EXISTE/PARCIAL/AUSENTE) → artefatos existentes → gaps → dependências → riscos → prioridade → testes` para RFC-001...040.
4. Descrever contratos reais de integração com Pessoas/RH, links de líder, hierarquia, RBAC (inclusive uso do escopo de competências caso exista), PDF e controle de desativação.
5. Definir desenho lógico: entidades, relacionamentos, snapshots, lifecycle de avaliações/ciclos, invariantes e endpoints propostos **sem criar rota externa ainda**. Identificar como preservar histórico em mudanças de gestor ou cargo.
6. Inventariar design system e publicar `UI_CONTRACT.md`: layout administrativo, breadcrumbs, listas, cards, modais, formulário mobile, estados loading/erro/sucesso/empty, cores tokens e acessibilidade; incluir mock textual de fluxos.
7. Criar `DECISOES_PENDENTES.md` com: confirmação da escala (limitação de frequência para técnico); 12 perguntas definitivas; bandas Nine-Box 2,5/3,5; `3 de 4` respostas mínimas; 90 dias de elegibilidade; autenticação do convite; política de LGPD; níveis culturais; condutas; limiares de divergência; período dos ciclos. Tratar todos como PROPOSTA, não como política aprovada.
8. Criar plano incremental de 12 etapas abaixo e estratégias de testes. **Não tocar produção e não ativar endpoints públicos.**

**Aceite:** documentos existem, refletem caminhos e nomes encontrados no código, 40 RFCs mapeadas, principais riscos explicitados, working tree inventariado e nenhuma mudança funcional indevida.

---

## PROMPT 01 — Integração RH, RBAC e fundação de dados
**RFCs:** 001, 002, 003, 004, fundamentos de 037 e 038.

**História:** Como RH, quero avaliar Pessoas oficiais do IndusCost usando os vínculos organizacionais atuais, sem criar novos cadastros nem expor dados de outras pessoas.

**Fazer:**
- Implementar as entidades mínimas e contratos persistentes com migrations **geradas e revisadas**, nunca aplicadas a banco real. Alocar conforme arquitetura atual; incluir constraints, índices de ciclos/colaborador, unique de atribuição, chaves oficiais, timestamps, autor e revisionamento. Se o design existente já resolver isso, apenas evoluir.
- Reusar endpoint/serviço oficial para `employee`, cargo, departamento, situação e relação líder/equipe; criar snapshot por ciclo sem reescrever base de Pessoas.
- Definir capacidades granulares para ler própria avaliação, responder, avaliar liderados, criar ciclos, configurar modelos, calibrar, publicar relatórios e gerir convites; integrar ao mecanismo RBAC real; `deny` sempre vence.
- Separar papel de colaborador/avaliador do acesso administrativo; impedir líder de obter a própria avaliação ou a de superior/pares por privilégio de gestão, sem bloquear seu acesso como titular a informações permitidas.
- Testar cases de superior/pares/outro departamento, mudança de hierarquia, funcionário inativo, usuário sem permissão e IDOR com IDs adulterados.

**Aceite:** sem duplicar Pessoas, nenhum endpoint apresenta acesso lateral, snapshots versionáveis, migrations reversíveis em ambiente descartável ou revisadas estaticamente se indisponível; testes RBAC passam.

---

## PROMPT 02 — Metodologia e editor de modelos versionados
**RFCs:** 005–009.

**História:** Como RH, quero configurar um questionário simples, publicar uma versão e preservar exatamente o que foi perguntado em cada ciclo.

**Fazer:**
- Modelar três pilares independentes (`Técnico`, `Cultura`, `Potencial`), 12 perguntas-base (4 por pilar) conforme catálogo RFC, ordenação, texto auto/gestor, dica contextual por posto/função e opção não observável.
- Usar escala única visível: `Nunca ou quase nunca`, `Às vezes`, `Na maioria das vezes`, `Sempre ou quase sempre`, `Não sei/Não tive oportunidade`; valor `notObserved` distinto de `0` e `null` ainda não respondido.
- Editor RH seguindo componentes nativos: grid de modelos (nome, status draft/publicado/arquivado, versão, data), modal/criação/duplicação, reordenação, prévia mobile e desktop, validação de perguntas duplicadas/sem texto e publicação com confirmação.
- Alteração em modelo publicado → nova versão draft; publicação mantém histórico e snapshot; não permitir alteração in-place de configuração já usada.
- Marcar modelo inicial como `DRAFT/EM VALIDAÇÃO` até aprovação explícita. Não habilitar automaticamente cálculo oficial baseado em cortes propostos.
- Escrever testes de publicação concorrente, snapshots, rascunho, permissão e integridade das 12 perguntas.

**Aceite:** questionário legível, versão imutável, nunca altera avaliação histórica, modelo inicial configurável e não declarado homologado.

---

## PROMPT 03 — Ciclos, elegibilidade, atribuições e dashboard operacional básico
**RFCs:** 010–013, base de 039.

**História:** Como RH, quero abrir um ciclo, selecionar pessoas e acompanhar quem precisa responder.

**Fazer:**
- UI nativa de ciclos com estados RASCUNHO→PREPARADO→ABERTO→CONSOLIDAÇÃO→CALIBRAÇÃO→HOMOLOGADO→ENCERRADO; reversão e correções somente com autorização e auditoria.
- Cadastro: nome, referência temporal, prazo auto, prazo gestor, modelo/version, responsável, participantes e avaliador responsável por participante; seleções/filtros por setor/cargo e preview de elegíveis.
- Analisar admissão recente, afastamento, mudança de função, falta de gestor e desligamento; usar configuração draft para mínimo de 90 dias (proposta não aprovada); permitir exceção justificada RH e marcar não elegível versus pendente.
- Congelar gestor/cargo/setor/matrícula e modelo do momento da abertura; realocação de avaliador via RH mantendo auditoria.
- Criar atribuições separadas para autoavaliação e avaliação do líder; proibir duplicação por clique duplo, ação repetida ou concorrência.
- Painel com contagens derivadas do banco: elegíveis, convidados, iniciados, concluídos, pendentes, prazo, atrasados. Não confundir não elegível com pendente.
- Se configuração essencial de negócio não estiver aprovada, permitir preparar em draft e simular localmente, mas bloquear publicação operacional por feature flag/estado de governança.

**Aceite:** ciclo reproduzível, sem tarefas duplicadas, contadores corretos, transições validadas no backend e nenhuma publicação por engano.

---

## PROMPT 04 — Segurança do convite QR e acesso restrito mobile
**RFCs:** 014, 015, 036 e requisitos de 037–038 relativos ao convite.

**História:** Como colaborador, quero acessar meu formulário pelo celular sem usuário administrativo, mas sem permitir que terceiros respondam apenas tendo a foto do QR.

**Fazer:**
- Auditar infra de rotas externas, reverse proxy, Cloudflare Access/Tailscale, autenticação e middleware. Criar endpoints **no código local**, com feature flag desabilitada por padrão; NÃO publicar nem tocar Cloudflare, DNS ou firewall.
- Serviço para emitir token randômico de alta entropia por atribuição/ciclo; armazenar somente digest, expiração, estado, revogação, data de emissão/uso, tentativas e vínculo oficial. Nunca gravar token cru em logs/telemetria.
- Gerar QR em formato seguro compatível com o padrão de PDF existente; prévia/impressão individual e em lote apenas para RH autorizado; não expor lista pública de QR e nomes.
- Concepção em duas etapas: convite + prova adicional de posse/identidade (OTP individual separado ou fluxo assistido controlado). Implementar interface de verificação extensível e simulação local; modalidade de verificação requer decisão RH/TI, não usar CPF, nascimento ou matrícula como senha. Sem validação adicional, não liberar respostas reais.
- Evitar referrer leakage de token, cache compartilhado, enumeração de links, replay, sessões fixadas; limitar tentativas, duração da sessão, escopo exclusivo de questionário, bloqueio após conclusão/revogação; mensagens de erro neutras.
- Testes: convite expirado/revogado, QR copiado, replay, concorrência, brute force/rate-limit, pessoa errada, usuário desativado, envio duplicado e acesso a recursos administrativos.

**Aceite:** nenhum token confere permissão administrativa, QR sozinho não basta para efetuar resposta, flag off por padrão, suite security com falhas de autorização passa.

---

## PROMPT 05 — Portal mobile, resposta progressiva e atendimento assistido
**RFCs:** 016–018.

**História:** Como operador, quero responder sozinho em celular simples ou receber ajuda sem perder privacidade e sem instalar aplicativo.

**Fazer:**
- Layout mobile-first consistente com marca/tokens IndusCost, mas leve; largura fluida, 1 pergunta por tela, indicador `Pergunta 3 de 12`, título do pilar, pergunta legível, 4 respostas grandes + `Não sei`, botões Voltar/Próxima e salvar automático com indicação discreta.
- Na introdução: nome confirmado, finalidade, referência temporal, tempo aproximado testável, orientação `Pense em como você age no trabalho, na maioria dos dias`, aviso de privacidade em linguagem simples. Não prometer anonimato para autoavaliação identificada.
- Rascunho seguro server-side; `null` pendente diferente de `notObserved`; debounce + idempotência e controle de versões para múltiplas abas e perdas de rede; não afirmar salvo sem resposta bem-sucedida.
- Tela final de revisão com todos os 12 itens e confirmação explícita; submissão transacional e bloqueio posterior de edição sem workflow autorizado; confirmação acessível.
- Modo assistido no fluxo autenticado do RH, com registro de auxiliar, titular, data e modalidade; apoio não deve transformar assistente em respondente nem abrir resultados administrativos no dispositivo do colaborador; limpar sessão ao final.
- Design: mobile de 320 px em diante sem overflow, legibilidade, foco visível, label acessível, navegação teclado, contraste, skeleton/empty/error e perda de rede recuperável; testar modo smartphone, notebook e telas ampliadas.
- E2E: primeira abertura, navegação, volta, interrupção/retomada, não observável, submit duplo, sem conexão, troca de convite, identidade inválida, preenchimento assistido.

**Aceite:** participante realiza o percurso com poucas interações e zero conhecimento técnico; questionário não depende de login administrativo; sem perda silenciosa de respostas.

---

## PROMPT 06 — Área da liderança e evidências
**RFCs:** 019–021.

**História:** Como líder, quero ver apenas meus liderados e responder à avaliação sem conhecer previamente a autoavaliação deles.

**Fazer:**
- Usar layout padrão do IndusCost (lista com filtros por status, setor, prazo; busca, ações, resumo) e componente de formulário reutilizado com enunciados em terceira pessoa.
- Garantir autorização por colaborador/atribuição, em leitura/escrita/exportação; sem acesso a superior, par, pessoa de outro setor ou ao próprio registro via permissão de líder.
- Preservar independência: não mostrar autoavaliação antes da finalização da avaliação do gestor, salvo excepcionalmente por regra aprovada/auditada.
- Para notas 1 ou 4, solicitar exemplo breve e observável; se versão inicial usar exigência de justificativa por diferenças >=2, a divergência só é exibida após o líder finalizar sua nota, sem reescrever essa versão.
- Workflow rascunho→enviado→devolvido para revisão→versão revista; sempre trilha de auditoria, sem editar conteúdo enviado silenciosamente.
- Testar IDOR, mudança de gestor, encerramento do prazo, casos sem evidência, erro de validação, consistência após recalibração.

**Aceite:** líderes trabalham no notebook sem telas redundantes, avaliação independente, justificativas e histórico corretos, backend impõe escopo real.

---

## PROMPT 07 — Motor de resultados e cultura
**RFCs:** 022–025.

**História:** Como RH, quero três resultados independentes e uma visão de cultura baseada em comportamentos, com apuração separada para condutas graves.

**Fazer:**
- Serviço de domínio puro/testável para agregações por pilar: soma de respostas 1–4 ÷ número de respostas válidas, N/A excluído, valor bruto preservado e duas casas só na exibição; limiar `3/4` configurável e claramente proposto até aprovado.
- Autoavaliação exibida separadamente, sem peso automático na nota gerencial; resultado oficial depende do líder e homologação; cálculo técnico exige validação com evidências da função e pode ficar `PENDENTE_VALIDACAO`.
- Competências culturais: respeito, comunicação, cooperação, honestidade/responsabilidade; documentos de valores/código de conduta como configuração versionável e com aceite interno antes de publicação.
- Indicador cultura separado: consistente/em desenvolvimento/requer análise; regras não arbitrárias, guardar fundamento e contexto; sem penalização automática.
- Inspecionar se RH já tem ocorrências. Reutilizar seu mecanismo se houver; caso contrário, criar **apenas contrato de integração e especificação restrita** (ou módulo mínimo se compatível e aprovado); denúncias não comprovadas não alteram nota, não mostrar detalhes de ocorrências ao gestor não autorizado.
- Testes: missing, zero vs N/A, média não arredondada nos cortes, revisão, evidência insuficiente, segregação, desvios de cálculo, ausência de punição automática.

**Aceite:** três pilares independentes, resultado técnico não finge ser validado, cultura não vira terceiro eixo e ocorrência não gera sentença automática.

---

## PROMPT 08 — Nine-Box, calibração e homologação
**RFCs:** 026–028, base de 033.

**História:** Como RH, quero uma Nine-Box preliminar baseada em evidências e aprovar resultados com revisão humana rastreável.

**Fazer:**
- Serviço para mapear X=desempenho técnico VALIDADO e Y=potencial, com 3 faixas configuráveis, proposta inicial `<2,5 baixo`, `2,5–<3,5 médio`, `>=3,5 alto`; configuração não homologada não gera classificação OFICIAL; não usar arredondamento para definir quadrante.
- Cultura como etiqueta/estado independente; evidência insuficiente em qualquer eixo = `SEM_CLASSIFICACAO` com motivo claro, não empurrar para quadrante 1.
- Fila de calibração RH: nome, setor/cargo, líder, três pilares, respostas por perspectiva, evidências, alertas de divergência, posição proposta, comentário/solicitação de revisão, histórico.
- Workflow de aprovação por permissões explícitas; alterações somente por revisão versionada com motivo, responsável, before/after, data; vedar auto-homologação indevida.
- Aprovar resultado individual e ciclo quando seus critérios forem atendidos; congelar snapshot de resultados oficiais; alteração posterior segue revisão formal.
- Testes de cortes exatos, 2,499/2,5/3,499/3,5, escassez de evidências, concorrência de aprovadores, conflito de versão, privacidade e alteração de modelo.

**Aceite:** Nine-Box apenas oficial após homologação; mudança de nota ou regra nunca reescreve histórico; cultura permanece separada.

---

## PROMPT 09 — Feedback, ciência e PDI
**RFCs:** 029–031.

**História:** Como líder e colaborador, queremos transformar a avaliação em uma conversa objetiva e em uma ação concreta de desenvolvimento.

**Fazer:**
- Fluxo após homologação: registrar devolutiva, principal ponto forte, principal aspecto a desenvolver, ação acordada, responsável, prazo e data da conversa; campos curtos e UI descomplicada.
- Ciências distintas: `visualizou`, `tomou ciência` e `concordou` **não são sinônimos**. Ciência pode ser confirmada sem concordância; registrar eventual observação/contestação do colaborador, com tratamento RH.
- PDI: uma ação prioritária sugerida, permitir outras justificadas; status planejada/em andamento/concluída/suspensa/cancelada, histórico de atualizações e anexos apenas se padrão existente e seguro.
- Acompanhamento trimestral sugerido como padrão configurável, sem disparo externo até aprovação; lembretes podem ser internos.
- Preservar acesso do colaborador somente a suas devolutivas liberadas, não a comentários confidenciais ou mapa gerencial inteiro.
- Testes: ciclo não homologado não gera devolutiva oficial, contestação, permissão de subordinados, alterações após encerramento, evidências e anexos.

**Aceite:** feedback associado ao resultado homologado, ciência sem concordância compulsória, PDI rastreável e usável.

---

## PROMPT 10 — Dashboards, histórico, relatórios e lembretes
**RFCs:** 032–035 e 039.

**História:** Como RH e direção, queremos enxergar conclusão dos ciclos, diferenças relevantes e evolução, mantendo sigilo e filtros corretos.

**Fazer:**
- Dashboard nativo com KPIs calculados em fonte única: elegíveis, convites emitidos, iniciadas, concluídas, pendências, líderes atrasados, calibração, feedback, PDIs; filtros ciclo, setor, gestor, cargo com RBAC.
- Nine-Box interativa 3×3 para quem tiver permissão: células responsivas, legenda e eixos claramente rotulados, quantidade por quadrante, nomes apenas ao escopo permitido; card de colaborador com técnico, potencial e cultura separados; opção lista acessível para teclado/leitor de tela.
- Histórico individual e por ciclo usando snapshots, sem projeção retroativa de cargo/setor/modelo atual sobre ciclos antigos; comparações entre versões apenas quando semanticamente compatíveis e explicitamente sinalizadas.
- PDFs: reutilizar template, cabeçalho, ID único, assinatura/QR documental quando padrão real oferecer, dados de ciclo, versão, horários, autor, permissão backend e redaction; não inventar QR de validação pública que exponha avaliação.
- Exportações XLS/CSV somente se padrões existentes suportarem, jamais contornar permissão. Evitar CSV injection em campos textuais.
- Lembretes e comunicação: opções draft para pendentes/expiração/prazos; **não ativar jobs, e-mails ou mensagens reais** sem aprovação e endpoints configurados; reusar scheduler real do IndusCost quando autorizado.
- Testes: totais por estado, zero/empty, filtros, alterações de gestor, escopo de PDF, row-level isolation, PDF sem dados indevidos, histórico preservado.

**Aceite:** painéis claros e verificáveis, números conciliáveis com registros, PDF seguro, lembretes inativos até autorização.

---

## PROMPT 11 — Hardening, revisão de arquitetura e piloto em dados fictícios
**RFCs:** 036–040 (fechamento transversal).

**História:** Como responsável pelo produto, quero uma experiência pronta para um piloto controlado sem expor colaboradores nem colocar produção em risco.

**Fazer:**
- Revisão de threat model: roubo/replay de QR, IDOR, brute force, CSRF, XSS, SSRF, sessão assistida, enumeração, rate limits, vazamento em logs/referrers, mass assignment, acesso lateral, links externos, privacidade de PDF, retenção e backups.
- Inventariar dados pessoais armazenados, finalidade, retenção e segregação por permissão; registrar decisões pendentes de RH/jurídico, sem inventar base legal ou política.
- Revisão de frontend: desktop RH/gestor + celulares populares/320/360/390px, zoom 200%, contraste, navegação teclado, labels, skeleton, erros, vazio, mensagens legíveis, carregamento e sem overflow.
- Rodar integração/E2E em ambiente local isolado com **dados inteiramente fictícios**: 1 gestor, 1 RH, 6 colaboradores (ativo, recém-admitido, afastado, inativo, transferido e sem gestor), e cenários de respostas extremas/incompletas.
- Preparar checklists de piloto com RH e equipe operacional; não marcar eficácia dos questionários como cientificamente validada sem estudo. Confirmar que todas as flags externas e publicações permanecem desligadas.
- Gerar `PILOTO_E_ACEITE.md`: instruções de teste, casos, resultados, critérios de go/no-go, restrições, pendências e passos a executar manualmente para homologação futura **sem executá-los**.

**Aceite:** ambiente de teste totalmente local, testes documentados, nenhuma rota pública ativa, zero segredos ou dados reais, blockers destacados.

---

## PROMPT 12 — AUDITORIA FINAL INDEPENDENTE (último prompt, obrigatório)

**Papel:** atue como arquiteto revisor, QA lead, especialista de AppSec e analista de negócios crítico. **Não assuma que etapas anteriores estão corretas.** Leia o código atual, catálogo original RFC-001..040, diffs, documentação, design system, contratos RH e todas as evidências. O objetivo é verificar conformidade, NÃO inventar evidências ou fazer deploy.

### 1. Auditoria de escopo RFC por RFC
Monte tabela com as 40 RFCs, cada uma contendo `RFC | requisitos satisfeitos | caminhos/linhas de código | testes e saída | status PASS/PARTIAL/FAIL/BLOCKED | risco | correção necessária`. Não conceda PASS por existir somente tela, mock, DTO ou teste marcado skip. Diferencie contrato criado de fluxo operacional implementado.

### 2. Fluxos end-to-end obrigatórios
Verifique com testes automatizados e, se possível, testes funcionais locais:
1. RH cria modelo draft com três pilares × quatro perguntas; publica versão validada; snapshot imutável.
2. RH cria ciclo, aplica elegibilidade, atribui avaliadores e abre somente quando regras aprovadas.
3. RH emite convites/QR individuais, revoga/reemite; convite vazado isoladamente não autentica respondente.
4. Colaborador se identifica, responde 12 perguntas no celular, usa N/A, salva, sai, retoma, revisa e finaliza uma única vez.
5. Colaborador sem celular realiza fluxo assistido, com registro correto e privacidade preservada.
6. Líder vê só equipe autorizada, responde sem ler antes a autoavaliação, anexa exemplos extremos e finaliza.
7. Divergências aparecem na fase correta; RH solicita revisão e preserva as versões.
8. Técnico, cultura e potencial calculam separadamente; N/A não vira zero; resultados insuficientes não são classificados.
9. Desempenho técnico exige validação da função; cultura não modifica eixos automaticamente; incidentes não comprovados não alteram notas.
10. Nine-Box preliminar, calibração, homologação, revisão e snapshot; cortes em limites sem arredondamento.
11. Líder entrega feedback, colaborador toma ciência sem ser obrigado a concordar, PDI é acompanhado.
12. Dashboards, histórico e PDFs respeitam permissões e exibem dados coerentes.

### 3. Matriz de testes de segurança e privacidade
Executar/inspecionar: RBAC backend inclusive próprios, pares, superiores, setores, elevador de privilégio, IDOR leitura/escrita/exportação; token replay/revogação/expiração, OTP, rate limit, brute force, ausência de token em logs, referrer, cache e URL de documentos; privacidade de RH/denúncias; usuário desativado; concorrência; mudança de líder, LGPD e dados sensíveis; SSRF/CSRF/XSS e injeções aplicáveis. Marcar controles dependentes de infra como `NÃO VERIFICADO EM AMBIENTE`, nunca PASS presumido.

### 4. UI e usabilidade
Comparar telas administrativas com layout real do IndusCost: navegação, breadcrumb, grid/tabela, filtros, botões, modais, tipografia, ícones, loading/error/empty/toast. Portal mobile: 320, 360, 390, 768px, zoom 200%, alvo mínimo de toque, leitura fácil, 1 pergunta/tela, sem rolagem horizontal, teclado, leitor de tela, progresso, auto-save e tratamento offline/instabilidade. Apontar inconsistências com prints **somente se ferramenta local disponível**, sem fingir capturas.

### 5. Qualidade técnica e evidências
- `git status`, diff completo, lockfile, migrations, constraints, índices, nullability, snapshots, transações, idempotência, contratos de API, tipagem, lint, testes, build e regressões dos recursos RH reaproveitados.
- Confirmar que não há novos schedulers ativos nem integração Nomus, acesso remoto, banco real ou deploy.
- Buscar segredos, logs de dados pessoais, URLs não seguras, handlers sem autenticação e testes frágeis.
- Registrar **comandos exatos e suas saídas relevantes**, não resumos fictícios. Calcular cobertura somente se a suíte a fornecer.
- Classificar pendências em P0 (segurança/dados/incorreção), P1 (fluxo essencial), P2 (polimento/expansão). Especificar o menor ajuste corretivo e regressões a testar.

### 6. Decisões que dependem de pessoas (não automatizar)
Confirmar status de: redação e compreensão das 12 perguntas, escala de frequência vs validação técnica, anonimato de perspectivas futuras, método de verificação do QR, elegibilidade 90 dias, pelo menos 3/4 por pilar, cortes 2,5 e 3,5, estado cultural, código de conduta, calibração, LGPD e piloto com operadores. Nenhum desses itens pode ser marcado como homologado apenas pelo código.

### 7. Relatório final obrigatório
Gerar `docs/avaliacao-desempenho/RELATORIO_VALIDACAO_FINAL.md` com:
- Sumário com `APTO PARA PILOTO LOCAL` / `NÃO APTO PARA PILOTO LOCAL` e justificativa.
- Tabela com **40/40 RFCs** e evidências.
- Métricas numéricas: PASS, PARTIAL, FAIL, BLOCKED; não arredondar para parecer melhor.
- Lista P0/P1/P2 e riscos residuais.
- Ambiente exato onde testes ocorreram.
- Pendências de RH/direção, jurídico, infraestrutura e UX.
- Resultado da revisão do visual e regressões.
- Checklist para homologação futura (sem SSH/deploy).
- Declaração textual: `NENHUMA ALTERAÇÃO EM PRODUÇÃO EXECUTADA NESTA AUDITORIA` ou, se não for possível confirmar, explicar.

**Gate final:** Se algum P0, controle essencial ausente, teste crítico não executado ou decisões indispensáveis abertas, classificar `NÃO APTO` para produção. `APTO PARA PILOTO LOCAL` não equivale a homologado nem a pronto para AWS. Ao terminar, não fazer commit/push/deploy e não acessar servidores.

---

## Organização para execução noturna

1. Coloque o catálogo das 40 RFCs e este documento no workspace local (pasta de docs apropriada, sem sobrescrever arquivos existentes).
2. Execute PROMPT 00 para auditar. Só avance se as dependências/contratos estiverem identificados.
3. Processe PROMPT 01 até PROMPT 11 em ordem; cada etapa verifica `PROGRESSO.md`, executa testes e registra pendências. Se surgir falha P0/P1 bloqueante, **não execute o próximo prompt**; registre bloqueio e continue apenas com trabalho independente claramente seguro.
4. Encerre com PROMPT 12. Não substitua auditoria por checklist autoafirmado.
5. O operador humano revisa o relatório pela manhã e decide sobre correções e **homologação separada**.

**Importante:** nenhum agente deve converter execução noturna em permissão irrestrita. A autonomia concedida é exclusivamente para editar e testar o repositório local com dependências e dados fictícios. Se o Cursor tiver modo de execução encadeada, use os prompts como tarefas sequenciais com gates; não crie rotinas que desabilitem suas proteções.
