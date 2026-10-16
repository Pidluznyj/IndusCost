# IndusCost — Catálogo de RFCs e Histórias de Usuário

**Versão:** 1.0 (proposta para homologação)  
**Data:** 16/10/2026  
**Produto:** Gestão de Desempenho, Cultura e Potencial  
**Escopo:** Pessoas/RH, fluxo simples para operação fabril, liderança, RH e direção

> Status: especificação negocial proposta; nenhum esquema de banco, rota, política de acesso, peso ou corte deve ser presumido implementado ou homologado.

## Contrato comum a todos os RFCs

- Reutilizar cadastros de Pessoas, hierarquia, usuários, autenticação, RBAC, componentes de interface, padrões de PDF e auditoria existentes; **auditar antes de criar**.
- Separar desenvolvimento local, homologação no servidor local e produção AWS; agente de código sem SSH, escrita em banco real, sync Nomus, deploy ou operações Git não autorizadas.
- Preservar histórico via snapshots, trilhas de revisão e regras de autorização em backend e exportações.
- Interface mobile simples para colaboradores, líder em notebook; linguagem acessível; no máximo 12 perguntas-base na primeira versão.
- Nine-Box **desempenho × potencial**; cultura como terceiro indicador independente; classificação sujeita à revisão humana.
- Decisões de metodologia sinalizadas como propostas precisam de homologação do RH/direção e piloto.

## Épicos, RFCs e histórias


## Épico — Fundação e integração com RH

### RFC-001 — Integração ao cadastro oficial de Pessoas
**História de usuário:** Como RH, quero selecionar colaboradores existentes para avaliar, sem recadastrar pessoas.

**Regras e comportamento funcional:** Consultar cadastro oficial de colaborador, matrícula, situação, cargo e departamento; somente chaves oficiais; vínculo com histórico por identificador imutável.

**Critérios de aceite (Given/When/Then resumidos):** Pessoa ativa aparece uma única vez; desativada não recebe novos convites por padrão; alterações cadastrais não apagam ciclos anteriores.

**Dependência / validação:** Auditar entidades/serviços existentes de Pessoas e status de vínculo.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-002 — Hierarquia e responsáveis por avaliação
**História de usuário:** Como RH, quero identificar quem avalia cada colaborador para distribuir as tarefas corretamente.

**Regras e comportamento funcional:** Derivar líder do cadastro existente; permitir exceção atribuída e justificada pelo RH; congelar líder, cargo e setor no ciclo; impedir autoavaliação gerencial da própria pessoa.

**Critérios de aceite (Given/When/Then resumidos):** Mudança de gestor após abertura não altera retrospectivamente atribuição; reatribuição é auditada; líder só vê equipe autorizada.

**Dependência / validação:** Mapear hierarquia e escopo RBAC reais.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-003 — Capacidades e autorização nativa
**História de usuário:** Como administrador, quero distribuir acesso por capacidades sem criar perfis paralelos.

**Regras e comportamento funcional:** Reutilizar sessão e RBAC; capacidades read/respond/evaluate/manage/calibrate/report; deny prevalece; acesso ao próprio formulário não concede acesso ao RH interno.

**Critérios de aceite (Given/When/Then resumidos):** Tentativas diretas em API negadas; exportação obedece escopo; usuário desativado perde acesso.

**Dependência / validação:** Auditar middleware e resolução de permissão existentes.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-004 — Visões integradas ao RH do colaborador
**História de usuário:** Como RH, quero abrir o histórico da pessoa a partir do cadastro atual.

**Regras e comportamento funcional:** Nova aba ou seção no perfil existente, sem duplicar perfil; exibir somente ciclos, feedbacks e PDIs permitidos; acesso sensível separado.

**Critérios de aceite (Given/When/Then resumidos):** Abertura a partir do cadastro aponta ao mesmo registro; gestor não vê registros fora do escopo; não expor denúncias no perfil geral.

**Dependência / validação:** Reutilizar componentes e padrões do modal de Pessoas.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.


## Épico — Metodologia, competências e modelos

### RFC-005 — Catálogo de três pilares
**História de usuário:** Como RH, quero avaliar desempenho, cultura e potencial separadamente.

**Regras e comportamento funcional:** Pilares DT/CU/PO com quatro competências-base cada; não somar pilares numa nota total única; preservação semântica por versão.

**Critérios de aceite (Given/When/Then resumidos):** Três resultados separados; ausência de respostas não vira zero; alterações publicadas não retroagem.

**Dependência / validação:** Definir IDs estáveis, descrições e comportamentos observáveis.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-006 — Questionário-base de 12 perguntas
**História de usuário:** Como colaborador, quero perguntas curtas que entenda sem ajuda técnica.

**Regras e comportamento funcional:** Texto simples em segunda pessoa; correspondente em terceira pessoa para líder; testar perguntas de dupla interpretação; não confundir personalidade com conduta.

**Critérios de aceite (Given/When/Then resumidos):** 12 perguntas na versão-base; mesmas competências em ambas as perspectivas; leitura compreensível em piloto fabril.

**Dependência / validação:** Aprovação do conteúdo pelo RH e líderes antes de publicar.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-007 — Escala de frequência e não observável
**História de usuário:** Como avaliador, quero quatro respostas fáceis e uma opção sem evidência.

**Regras e comportamento funcional:** 1 Nunca ou quase nunca; 2 Às vezes; 3 Na maioria das vezes; 4 Sempre ou quase sempre; N/O não pontua; mostrar a instrução de período de referência.

**Critérios de aceite (Given/When/Then resumidos):** Nenhum valor N/O vira 0; pergunta não fica respondida por valor default; todas alternativas acessíveis no celular.

**Dependência / validação:** Distinguir frequência de competência técnica; validar em piloto.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-008 — Exemplos técnicos por função
**História de usuário:** Como líder, quero exemplos adequados ao posto sem mudar os critérios.

**Regras e comportamento funcional:** Associar exemplos observáveis às funções; modelo-base compartilhado; mudanças que afetem medição geram nova versão; não usar produtividade de cargos não comparáveis como métrica única.

**Critérios de aceite (Given/When/Then resumidos):** Operador, manutenção e administrativo recebem exemplos pertinentes; ausência de exemplo não impede questionário-base; histórico conserva exemplo usado.

**Dependência / validação:** Reutilizar cargo/função e treinamentos existentes.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-009 — Versionamento e publicação do modelo
**História de usuário:** Como RH, quero melhorar perguntas futuramente sem alterar avaliações já feitas.

**Regras e comportamento funcional:** Estados rascunho/publicado/inativo; versão publicada imutável; ciclo guarda snapshot integral de texto, escala, critérios e regras; duplicar versão para editar.

**Critérios de aceite (Given/When/Then resumidos):** Alterar rascunho não atinge ciclo aberto; versão antiga continua auditável; bloqueio de edição destrutiva da publicada.

**Dependência / validação:** Modelo de snapshots e migrações somente após auditoria.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.


## Épico — Ciclos, elegibilidade e distribuição

### RFC-010 — Cadastro e lifecycle de ciclos
**História de usuário:** Como RH, quero abrir e encerrar avaliações sem intervenção técnica.

**Regras e comportamento funcional:** Nome, referência semestral, versão, público, prazos, responsável; rascunho→preparado→aberto→consolidação→calibração→homologado→encerrado; guardas explícitas.

**Critérios de aceite (Given/When/Then resumidos):** Não abrir sem participantes/modelo; não homologar sem revisões mínimas; encerramento imutável salvo revisão formal.

**Dependência / validação:** Definir máquina de estados no domínio e relógio no servidor.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-011 — Elegibilidade e exceções de vínculo
**História de usuário:** Como RH, quero avaliar apenas quem possui período observável adequado.

**Regras e comportamento funcional:** Regra proposta 90 dias de observação; contemplar admissão, afastamento, transferência, mudança de função e desligamento; exceção registrada; nunca inferir desinteresse por ausência.

**Critérios de aceite (Given/When/Then resumidos):** Três estados distintos: elegível, não elegível e evidência insuficiente; exceções exigem motivo.

**Dependência / validação:** Prazo de 90 dias ainda sujeito a homologação.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-012 — Distribuição de tarefas por avaliador
**História de usuário:** Como RH, quero criar uma atividade para autoavaliação e outra para o líder.

**Regras e comportamento funcional:** Atribuições únicas por colaborador/ciclo/tipo/avaliador; sem duplicidade; reatribuição auditada; manter avaliação anterior se houver substituição.

**Critérios de aceite (Given/When/Then resumidos):** Reabrir tela não duplica atribuição; mudança de avaliador não perde versão enviada; cada tarefa tem situação própria.

**Dependência / validação:** Usar serviço transacional e restrições únicas.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-013 — Painel e prazos do ciclo
**História de usuário:** Como RH, quero ver quantas pesquisas faltam para agir.

**Regras e comportamento funcional:** Contadores elegíveis/convidados/em andamento/enviados/líder/calibração/feedback; filtros por equipe; lembretes sem exposição do conteúdo.

**Critérios de aceite (Given/When/Then resumidos):** Totais reconciliam com participantes; prazos alterados geram auditoria; não confundir convidado com respondido.

**Dependência / validação:** Reaproveitar dashboard e componentes de filtro.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.


## Épico — QR Codes e portal do colaborador

### RFC-014 — Convite individual por QR Code
**História de usuário:** Como colaborador, quero abrir minha pesquisa com a câmera do celular.

**Regras e comportamento funcional:** Token criptograficamente seguro associado a atribuição e ciclo; URL HTTPS curta; QR e impressão individual/lote; revogação e substituição; token apenas hash no banco.

**Critérios de aceite (Given/When/Then resumidos):** QR A não abre pesquisa B; reemissão invalida convite anterior; cópia do link sozinha não conclui verificação de identidade.

**Dependência / validação:** Portal externo isolado da interface administrativa.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-015 — Confirmação de identidade simplificada
**História de usuário:** Como colaborador, quero confirmar minha identidade sem usuário completo.

**Regras e comportamento funcional:** Passo adicional por código de uso único independente do link ou validação assistida; limite de tentativas e expiração; não usar CPF/data de nascimento como segredo.

**Critérios de aceite (Given/When/Then resumidos):** Token inválido/expirado bloqueia; acerto autentica só a tarefa; registro de eventos sem logar segredo.

**Dependência / validação:** Método operacional de entrega do código precisa de aprovação.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-016 — Portal mobile com 12 perguntas
**História de usuário:** Como colaborador, quero responder em poucos toques e linguagem acessível.

**Regras e comportamento funcional:** Uma pergunta por tela; botões grandes; progresso; instrução clara; três grupos; voltar/avançar; sem login geral; contrastes e navegação assistiva.

**Critérios de aceite (Given/When/Then resumidos):** Funciona em celular comum; não pré-seleciona resposta; conclusão exige revisão; meta de 8–10 min validada em piloto.

**Dependência / validação:** Prototipar e testar com trabalhadores reais.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-017 — Rascunho e retomada protegida
**História de usuário:** Como colaborador, quero continuar se a internet cair ou eu fechar a página.

**Regras e comportamento funcional:** Salvar progressivamente no servidor; retorno só com sessão validada; prevenir duplicação/conflito de versões; expiração de sessão explícita.

**Critérios de aceite (Given/When/Then resumidos):** Falha de rede não informa falso sucesso; reentrada recupera respostas; envio duplicado é idempotente.

**Dependência / validação:** Definir janela de sessão e política de retenção de rascunho.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-018 — Modo de preenchimento assistido
**História de usuário:** Como RH, quero apoiar quem não tem celular ou facilidade digital.

**Regras e comportamento funcional:** Dispositivo compartilhado em sessão individual; registrar assistente e motivo; permitir privacidade; limpar sessão após conclusão; assistência não autoriza escrever pela pessoa sem confirmação.

**Critérios de aceite (Given/When/Then resumidos):** Usuário anterior não fica visível; RH vê status, não acessa livremente respostas; conclusão atribui autoria ao colaborador com registro de assistência.

**Dependência / validação:** Revisão de privacidade e fluxo presencial.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.


## Épico — Avaliação da liderança

### RFC-019 — Minha equipe: fila de avaliações
**História de usuário:** Como líder, quero uma fila simples dos colaboradores que devo avaliar.

**Regras e comportamento funcional:** Listagem com nome, função, ciclo, prazo e estado; rascunho e conclusão; não acessar matriz de pares, superiores ou próprios registros pelo escopo de líder.

**Critérios de aceite (Given/When/Then resumidos):** Somente atribuições autorizadas aparecem; URL manual para outro colaborador retorna acesso negado.

**Dependência / validação:** Reutilizar hierarquia congelada do ciclo.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-020 — Formulário do líder e evidências
**História de usuário:** Como líder, quero avaliar pelos mesmos critérios e justificar casos extremos.

**Regras e comportamento funcional:** Terceira pessoa; evidência obrigatória em 1/4; N/O disponível; salvar rascunho; impedir envio com pendências; notas condicionadas a comportamento observável.

**Critérios de aceite (Given/When/Then resumidos):** Perguntas equivalentes ao formulário móvel; evidências preservadas; líder não vê autoavaliação antes de enviar a sua.

**Dependência / validação:** Calibrar extensão de texto e orientações por função.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-021 — Divergências e revisão da liderança
**História de usuário:** Como RH, quero identificar diferenças e solicitar fundamentação.

**Regras e comportamento funcional:** Comparar após envio do líder; diferença >=2 pontos sinaliza revisão proposta; pedido de ajuste com justificativa; reenvio versionado, sem sobrescrever original.

**Critérios de aceite (Given/When/Then resumidos):** Divergência não muda nota automaticamente; comparação só fica disponível após envio independente; trilha de versões.

**Dependência / validação:** Limiar 2 sujeito a homologação.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.


## Épico — Cálculos, cultura e Nine-Box

### RFC-022 — Cálculo de notas por pilar
**História de usuário:** Como RH, quero médias reproduzíveis e sem distorções.

**Regras e comportamento funcional:** Média simples apenas dos valores 1–4; N/O excluído; mínimo proposto 3/4 válidas por pilar; guardar notas brutas e algoritmo versionado; arredondar só na exibição.

**Critérios de aceite (Given/When/Then resumidos):** N/O não equivale a 0; duas casas na UI; menos que 3 válidas gera insuficiência, não classificação.

**Dependência / validação:** Confirmar política de evidência mínima no piloto.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-023 — Validação de desempenho técnico
**História de usuário:** Como RH, quero evitar que frequência seja confundida com competência no posto.

**Regras e comportamento funcional:** Líder revisa padrão do cargo e evidências de qualidade/produtividade; etapa compacta de confirmação; mudança da classificação pede motivo; nenhum KPI converte sozinho em nota.

**Critérios de aceite (Given/When/Then resumidos):** Desempenho para Nine-Box não é atribuído sem confirmação; critérios claros por função; resultados preservam evidências.

**Dependência / validação:** Alinhar escala de desempenho com as quatro perguntas.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-024 — Gestão dos valores culturais
**História de usuário:** Como direção, quero comunicar e avaliar valores com fatos.

**Regras e comportamento funcional:** Catálogo de valores, descrições, exemplos positivos/negativos e vigência; padrões igualmente aplicáveis a todos os níveis; evitar traços de personalidade, opiniões e conformismo como critérios.

**Critérios de aceite (Given/When/Then resumidos):** Avaliação apresenta valores vigentes; revisão preserva histórico; cultura fica separada dos eixos Nine-Box.

**Dependência / validação:** Direção/RH aprovam valores oficiais e Código de Conduta.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-025 — Tratamento restrito de ocorrências
**História de usuário:** Como RH, quero apurar fatos graves sem reduzir denúncias a notas.

**Regras e comportamento funcional:** Fluxo separado: registro→triagem→apuração→conclusão→providências; segredo e não retaliação; alegação não é fato comprovado; sem punição automática por nota/denúncia.

**Critérios de aceite (Given/When/Then resumidos):** Ocorrência não aparece em dashboard geral nem no PDF comum; só casos concluídos podem alimentar contexto gerencial autorizado; versões e logs preservados.

**Dependência / validação:** Auditar módulo existente de ocorrências antes de construir outro; validação jurídica.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-026 — Posicionamento sugerido na Nine-Box
**História de usuário:** Como RH, quero matriz por desempenho e potencial, sem esconder cultura.

**Regras e comportamento funcional:** Eixo X desempenho; Y potencial; bandas propostas <2,50; 2,50–<3,50; >=3,50; cultura indicador independente; insuficiência impede quadrante automático.

**Critérios de aceite (Given/When/Then resumidos):** 9 quadrantes; mesmo eixo/cortes reproduz mesma posição; matriz distingue provisório e homologado; não há promoção/pena automática.

**Dependência / validação:** Cortes sujeitos a piloto; sem editar após ver nomes sem justificativa.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.


## Épico — Calibração, feedback e desenvolvimento

### RFC-027 — Fila de calibração pelo RH
**História de usuário:** Como RH, quero revisar notas, evidências e divergências antes da homologação.

**Regras e comportamento funcional:** Ver avaliações disponíveis, autoavaliação, notas, cultura, comparações, N/O, evidências; solicitar esclarecimento; filtro por setor; revisar de modo imparcial.

**Critérios de aceite (Given/When/Then resumidos):** Sem avaliação do líder não homologar automaticamente; seleção auditada; permissões de RH estritas.

**Dependência / validação:** Depende das RFCs de respostas e cálculo.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-028 — Homologação e revisão versionada
**História de usuário:** Como RH, quero aprovar resultados sem apagar o passado.

**Regras e comportamento funcional:** Registrar resultado original/calibrado, motivos, quem/quando, versão e status; aprovação exclusiva por capacidade; revisão posterior excepcional com justificativa.

**Critérios de aceite (Given/When/Then resumidos):** SHA lógico/snapshot de regra associado; cada alteração consultável; reabrir exige permissão; proibir alteração silenciosa.

**Dependência / validação:** Validar autoridade final de RH/direção.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-029 — Devolutiva individual e ciência
**História de usuário:** Como colaborador, quero compreender pontos fortes e o que melhorar.

**Regras e comportamento funcional:** Resumo simples: ponto forte, melhoria prioritária, conversa; registro de data e líder; ciência não equivale à concordância; observação ou contestação factual.

**Critérios de aceite (Given/When/Then resumidos):** Colaborador tem acesso apenas à própria devolutiva; Nine-Box gerencial restrita; ciência opcionalmente assistida.

**Dependência / validação:** Definir aprovação e janela de visibilidade.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-030 — PDI com ação prioritária
**História de usuário:** Como líder, quero combinar ação objetiva e prazo sem burocracia.

**Regras e comportamento funcional:** Uma ação recomendada, múltiplas permitidas; competência, objetivo, responsável, prazo, estado, evidência e comentários; sem automação disciplinar.

**Critérios de aceite (Given/When/Then resumidos):** Criar PDI após feedback; pendente aparece ao responsável; histórico preservado ao concluir/cancelar.

**Dependência / validação:** Reutilizar tarefas/ações do RH se existirem.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-031 — Acompanhamento trimestral do PDI
**História de usuário:** Como RH, quero confirmar se a ação teve resultado.

**Regras e comportamento funcional:** Check-in breve; progresso, obstáculos e próxima ação; não forçar nova avaliação completa; notificação futura configurável.

**Critérios de aceite (Given/When/Then resumidos):** Vencimentos visíveis; alteração exige data/autor; encerramento não exclui prova; histórico por ciclo.

**Dependência / validação:** Cadência trimestral é padrão proposto.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.


## Épico — Dashboards, relatórios e histórico

### RFC-032 — Dashboard operacional RH
**História de usuário:** Como RH, quero administrar ciclo e pendências em uma única visão.

**Regras e comportamento funcional:** Cards elegíveis/convidados/iniciados/auto concluída/líder concluído/calibrado/feedback/PDI; filtros; totais por estados exclusivos; ações contextuais.

**Critérios de aceite (Given/When/Then resumidos):** Contadores conciliam com banco; não exibe respostas confidenciais em listas amplas; não rotula não participante como nota baixa.

**Dependência / validação:** Usar componentes de dashboard existentes.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-033 — Nine-Box interativa e análises
**História de usuário:** Como direção, quero visualizar distribuição e necessidades sem expor indevidamente pessoas.

**Regras e comportamento funcional:** Matriz por ciclo, setor, cargo e líder; detalhe individual autorizado; cultura separada; foco em evolução e ações; alertas para baixa amostra.

**Critérios de aceite (Given/When/Then resumidos):** Filtros respeitam RBAC; apenas homologados como oficiais; sem ranking público.

**Dependência / validação:** Depende da homologação.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-034 — Histórico individual e comparabilidade
**História de usuário:** Como RH, quero enxergar evolução mesmo após transferências.

**Regras e comportamento funcional:** Linha do tempo com snapshots de cargo, setor, avaliador, perguntas e resultados; comparação apenas quando escalas/modelos comparáveis; sinalizar mudanças de metodologia.

**Critérios de aceite (Given/When/Then resumidos):** Ciclo antigo mantém estrutura antiga; nova função não altera avaliação passada; sem médias comparativas enganosas.

**Dependência / validação:** Reutilizar ficha atual do colaborador.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-035 — Relatórios PDF e exportações
**História de usuário:** Como RH, quero documentos rastreáveis sem expor dados além da permissão.

**Regras e comportamento funcional:** PDF individual, feedback/PDI, ciclo e matriz; padrão de cabeçalho/ID único existente; versão, data e autoria; exportação dentro do mesmo escopo de leitura.

**Critérios de aceite (Given/When/Then resumidos):** PDF não contorna RBAC; ID rastreável; snapshot histórico reemitível como versão identificada; não incluir ocorrências reservadas.

**Dependência / validação:** Auditar infraestrutura PDF/identificador único atual.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.


## Épico — Segurança, auditoria e implantação

### RFC-036 — Segurança do portal público restrito
**História de usuário:** Como TI, quero oferecer formulário externo sem publicar o IndusCost administrativo.

**Regras e comportamento funcional:** Separação de rotas/origens; HTTPS; sessão escopada; rate limit; proteção contra enumeração e replay; redigir URLs sem dados pessoais; não vazar token em logs/analytics.

**Critérios de aceite (Given/When/Then resumidos):** Portal acessível a celular fora da LAN; endpoints administrativos seguem inacessíveis ao convidado; teste de acesso indevido e expiração.

**Dependência / validação:** Definir arquitetura de exposição segura após auditoria de Cloudflare/Tailscale.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-037 — LGPD, segregação e retenção
**História de usuário:** Como encarregado/RH, quero finalidade clara, acesso mínimo e retenção apropriada.

**Regras e comportamento funcional:** Informar finalidade, acesso e direitos; distinguir avaliação de denúncias; base legal definida pelo jurídico; expurgo/retenção por política; evitar CPF como senha; perfis de RH mínimos.

**Critérios de aceite (Given/When/Then resumidos):** Sem consentimento forçado por padrão; logs não expõem texto livre; solicitações têm processo; acesso restrito por necessidade.

**Dependência / validação:** Validação jurídico/RH antes de produção.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-038 — Auditoria, integridade e rastreabilidade
**História de usuário:** Como auditor, quero reconstruir decisões relevantes de cada ciclo.

**Regras e comportamento funcional:** Event log para convites, avaliação, revisão, calibração, publicação, exportação; actor/timestamp/versão/motivo; concorrência e idempotência; não permitir edição invisível.

**Critérios de aceite (Given/When/Then resumidos):** É possível explicar quem alterou o quê e quando; eventos sensíveis são protegidos; alterações não geram duplicidade.

**Dependência / validação:** Aproveitar mecanismos existentes de audit log.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-039 — Lembretes e comunicação operacional
**História de usuário:** Como RH, quero lembrar apenas quem ainda possui tarefas pendentes, sem precisar verificar manualmente cada caso.

**Regras e comportamento funcional:** Lembretes configuráveis por ciclo para colaborador, líder e RH; nenhum conteúdo de avaliação no aviso; usar canal já suportado e aprovado; evitar mensagens excessivas; registrar envio e falha.

**Critérios de aceite (Given/When/Then resumidos):** Não avisar quem concluiu; revogação cancela lembrete; falha de envio não muda status da avaliação; envio manual e automatizado usam as mesmas regras.

**Dependência / validação:** Auditar infraestrutura existente de notificações e canais habilitados.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

### RFC-040 — Piloto, testes e gates de publicação
**História de usuário:** Como patrocinador, quero validar simplicidade e confiabilidade antes do rollout.

**Regras e comportamento funcional:** Piloto sugerido 8–12 pessoas de funções distintas; testes mobile/acessibilidade/RBAC/cálculo/segurança; aprovar metodologia e thresholds; desenvolvimento local→homolog→produção com autorização.

**Critérios de aceite (Given/When/Then resumidos):** Nenhum deploy automático; evidência de build/testes e SHA homologado; piloto aponta ambiguidade e tempo real; rollback e backups avaliados.

**Dependência / validação:** Seguir protocolo oficial do IndusCost.

**Testes mínimos:** caso positivo, caso negativo (sem permissão ou dado insuficiente), persistência/retomada se aplicável, preservação histórica e regressão no recurso reutilizado.

## Mapeamento de etapas e releases

| Release sugerido | RFCs | Gate de aceite |
|---|---|---|
| A — Fundação e piloto de questionário | 001–020, 036–039 (fatias necessárias) | Questionário e avaliação do líder testados com pessoas reais, dados isolados e autorização íntegra |
| B — Consolidar e classificar | 021–028, 033–034 | Cálculo reproduzível, calibração e Nine-Box provisória/oficial diferenciadas |
| C — Fechar ciclo de desenvolvimento | 029–032, 035 | Feedback, PDI, histórico e relatórios testados |
| D — Expansão da coleta 360º | RFC adicional futuro, não incluído como obrigação do MVP | Privacidade e desenho de avaliação entre pares aprovados |

## Decisões que bloqueiam publicação oficial

1. Aprovar texto das 12 perguntas, exemplos técnicos por função e a escala de frequência; corrigir perguntas com mais de uma ideia.
2. Validar se as notas de frequência e a validação técnica geram medidas úteis; não supor validade psicométrica.
3. Homologar mínimos de respostas e faixas da Nine-Box; não alterar cortes olhando nomes sem registro formal.
4. Definir procedimento viável de autenticação do QR Code e acessibilidade para pessoas sem celular.
5. Aprovar valores culturais, Código de Conduta e processo independente de apuração.
6. Formalizar regras de elegibilidade, revisão, calibração e autoridade decisória.
7. Validar LGPD, retenção, avisos, controles de acesso e exposição externa do portal.

## Definition of Done comum

Cada RFC só está concluído quando: contrato de negócio validado; rotas e controles de acesso revisados; critérios de aceite demonstrados; testes automatizados direcionados e de regressão aprovados; documentação e migrações revisadas quando existirem; observabilidade/auditoria funcionando; nenhuma regressão relevante; e relatório de evidências com SHA, arquivos alterados, pendências e passos de homologação **não executados** sem autorização.
