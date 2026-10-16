# Decisões pendentes — Desempenho, Cultura e Potencial

Nada nesta lista está homologado. O código usa os valores como **proposta** para o editor e para os testes locais. Ligar a feature não aprova a metodologia.

| Tema | Proposta no código | Status |
| --- | --- | --- |
| Escala | Frequência 1–4. 4 não significa desempenho excepcional. | PROPOSTA |
| Não observável | `Não sei / Não tive oportunidade`, distinto de `0` e de resposta ainda não dada (`pending`). | PROPOSTA |
| 12 perguntas | Textos provisórios DT-01..04, CU-01..04, PO-01..04. O catálogo RFC não traz a redação oficial. | PROPOSTA |
| Dica por função | Campo `hint` existe. Não há catálogo de exemplos por cargo. | PROPOSTA |
| Elegibilidade | 90 dias de observação (`PROPOSED_MIN_OBSERVATION_DAYS`). Exceção só com justificativa. | PROPOSTA |
| Mínimo por pilar | 3 de 4 respostas válidas (`PROPOSED_MIN_VALID_ANSWERS`). | PROPOSTA |
| Cortes Nine-Box | Baixo se `soma * 2 < 5 * quantidade` (< 2,5). Alto se `soma * 2 >= 7 * quantidade` (>= 3,5). Sem arredondamento. | PROPOSTA |
| Cultura | Insuficiente se abaixo do mínimo. Requer análise se alguma nota 1. Consistente se média >= 3,5. Caso contrário, em desenvolvimento. Cultura não é eixo da Nine-Box. | PROPOSTA |
| Divergência | Diferença absoluta >= 2, só depois que o líder enviou. | PROPOSTA |
| Evidência do líder | Notas 1 e 4 exigem texto com pelo menos 8 caracteres. | PROPOSTA |
| Identidade do convite | OTP de 6 dígitos, digest no banco, 5 falhas bloqueiam. Sem canal de entrega (SMS, e-mail, WhatsApp). Flag `PERFORMANCE_IDENTITY_OTP=0`. | PROPOSTA — canal não escolhido |
| LGPD | Não há base legal, prazo de retenção nem parecer jurídico neste repositório. | PENDENTE DE RH/JURÍDICO |
| Condutas | Registro restrito não altera nota nem quadrante. Não existe módulo de ocorrências de RH para reutilizar. | PROPOSTA |
| Período do ciclo | Datas informadas no cadastro. Sem calendário corporativo aprovado. | PROPOSTA |
| Publicação operacional | `PERFORMANCE_OFFICIAL_PUBLICATION=0` bloqueia abrir o ciclo (`GOVERNANCE_BLOCKED`). | BLOQUEADO DE PROPÓSITO |
| Lembretes | Rascunho pode ser gravado. O disparo responde `REMINDERS_DISABLED`. Nenhum job novo. | BLOQUEADO DE PROPÓSITO |
| Modelo inicial | Nasce `DRAFT` e `EM_VALIDACAO`. Publicar versão não declara o questionário homologado. | PROPOSTA |

Identificadores no código: `culture-proposal-unapproved-v0`, `nine-box-proposal-unapproved-v0`, `performance-mean-v0`.
