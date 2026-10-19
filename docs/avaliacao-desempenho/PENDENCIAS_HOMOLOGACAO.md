# Pendências de homologação — Desempenho, Cultura e Potencial

Situação em 16/10/2026, branch `feature/avaliacao-desempenho-claude`. Nada abaixo foi feito fora da máquina local. Esta lista **não** é aprovação: o que está escrito como proposta continua proposta até o RH ou o jurídico registrar a decisão.

## 1. Decisões de RH e metodologia

O código já aceita cada item como configuração do modelo ou como texto editável. Falta a decisão formal.

| Item | Proposta no código | Onde muda |
| --- | --- | --- |
| Redação das 12 perguntas, descrição, exemplo positivo e negativo | Modelo inicial (Qualidade, Produtividade, Organização, Segurança; Respeito, Colaboração, Responsabilidade, Ética; Aprendizado, Iniciativa, Adaptação, Desenvolvimento) | Modelos › editor (nova versão) |
| Exemplos por cargo | Campo existe, até 12 por pergunta; o modelo inicial nasce sem exemplos | Modelos › editor |
| Escala 1–4 de frequência e "Não sei / Não tive oportunidade" | Escala fixa, rótulos da proposta | Código (`performanceDomain.ts`) |
| Observação mínima | 90 dias | Regras do modelo |
| Respostas válidas mínimas por pilar | 3 de 4 | Regras do modelo |
| Cortes da Nine-Box | < 2,50 baixo; ≥ 3,50 alto, sem arredondamento | Regras do modelo |
| Faixas de cultura | Nota 1 → requer análise; média ≥ 3,50 consistente; resto em desenvolvimento | Regras do modelo |
| Divergência pessoa × líder | Diferença ≥ 2 | Regras do modelo |
| Evidência obrigatória | Notas 1 e 4, mínimo de 8 caracteres | Regras do modelo |
| Entrega do código de acesso | Código de 6 dígitos falado pelo RH, fora da folha do QR | Processo de RH |
| Sessão do portal | 8 h; assistido 30 min; convite até 14 dias, limitado ao prazo da autoavaliação | Código (propostas novas desta entrega) |
| Limite de tentativas | 240 req/min por IP no portal; 20/min nas chamadas de autenticação; 5 códigos errados bloqueiam o convite | Código |
| Calendário do ciclo | Datas digitadas no cadastro | Ciclos |

## 2. Jurídico e LGPD (RFC-037, RFC-025)

- Base legal, aviso ao colaborador, prazo de retenção e expurgo: **sem parecer**. Nada foi inventado.
- Ocorrências de conduta: o registro restrito existe e não altera resultado. O fluxo de triagem, apuração e conclusão ficou sem tela de propósito; depende de processo de RH e de parecer sobre sigilo e não retaliação.
- O portal mostra só o primeiro nome; logs não guardam respostas nem tokens. Isso é proteção técnica, não substitui o parecer.

## 3. Lembretes (RFC-039)

Planejamento gravado; o disparo responde `REMINDERS_DISABLED`. Falta escolher canal (e-mail, SMS, WhatsApp) e aprovar o texto. Nenhum job foi criado.

## 4. Exposição externa do portal

O portal (`/avaliacao`) é um bundle separado e só aceita os caminhos da allowlist quando o host público está configurado.

1. Decidir como o celular chega ao servidor (Cloudflare Tunnel, Tailscale Funnel ou rede interna). Nada foi configurado.
2. Definir no ambiente: `APP_PUBLIC_ORIGIN` (origem usada no QR) e `PERFORMANCE_PUBLIC_HOSTS` (hosts que só servem o portal) ou `PERFORMANCE_PUBLIC_SURFACE_HEADER` (se o túnel injeta um cabeçalho).
3. Conferir em homologação que o host público responde 404 para `/api/hr/…` e para o SPA administrativo.

## 5. Acesso e flags

| Flag | Padrão | Efeito |
| --- | --- | --- |
| `PERFORMANCE_CYCLE_ENABLED` | desligada | Menu, rotas e portal |
| `PERFORMANCE_OFFICIAL_PUBLICATION` | `0` | Abrir ciclo exige aceite explícito de piloto (`pilotAck`) |
| `PERFORMANCE_IDENTITY_OTP` | `0` | Reservada |
| `PERFORMANCE_REMINDERS_ENABLED` | `0` | Disparo bloqueado |

Recursos de permissão: `admin.employees.performance`, `.calibration`, `.reports`, `.invites`, `.conduct` (este último estrito, sem atalho de editor de RH). Rodar `permissions:seed` e montar os perfis de RH e de líder antes de ligar a flag. O líder precisa ter o usuário ligado ao cadastro do colaborador.

## 6. Ordem de implantação (quando autorizada)

1. Backup do banco.
2. Migration `20261016180000_hr_performance_cycle`.
3. Migration `20261021120000_hr_performance_cycle_rules` (só `ADD COLUMN` com default e `CREATE TABLE`).
4. Código.
5. `permissions:seed` e perfis.
6. Flags, ainda com publicação oficial em `0`.

O deploy de homologação roda os testes dos arquivos alterados. Os 6 arquivos de teste do módulo passam; os testes compartilhados tocados (navegação, sidebar, competências) também.

## 7. Piloto (RFC-040)

Piloto com 8 a 12 pessoas reais, um líder e um RH, depois de 1 a 6. Roteiro sugerido em [PILOTO_E_ACEITE.md](PILOTO_E_ACEITE.md) e roteiro técnico em [EVIDENCIAS_TESTES.md](EVIDENCIAS_TESTES.md). Não executado.

## 8. Observações fora do módulo

- A cadeia de migrations do repositório não aplica a partir de banco vazio (`20260410120000_purchases_block1` pede `Material`). Preexistente.
- A impressão da avaliação de experiência (`hr-evaluation-print.css`) provavelmente sai em branco pelo mesmo motivo que o PDF deste módulo saía: `src/reports-print.css` esconde `body *` e aquela folha não revela o conteúdo. Não foi alterada; vale conferir.

## 9. Avaliação 180° de liderança (branch `feat/performance-leadership-180`)

Decisões já aprovadas pelo RH para o piloto (registradas em [AVALIACAO_180_LIDERANCA.md](AVALIACAO_180_LIDERANCA.md) §3): comentário da equipe guardado e não lido por ninguém; média da equipe só com 5 ou mais respostas; nota calibrada inteira de 1 a 4; índice como média simples das competências com dado.

Ainda em aberto:

| Item | Proposta no código | Quem decide |
| --- | --- | --- |
| Textos das 8 competências (LD-01..LD-08) e das três frases | Proposta inicial do modelo | RH (editável no modelo de liderança, em rascunho) |
| Comentário mínimo em nota 1 ou 4 | 15 letras | RH (regra do modelo) |
| Divergência que pede justificativa na calibração | 1,5 ponto | RH (regra do modelo) |
| Base legal, aviso e retenção do comentário da equipe guardado e não lido | Sem parecer | Jurídico/LGPD |
| Avaliação da equipe no modo assistido (quem ajuda vê as respostas sobre o líder) | Permitido, como os demais formulários | RH + Jurídico |
| Tela própria para o líder ver o resultado homologado | Não existe: o líder recebe o documento emitido pelo superior na devolutiva | RH |
| Topo da estrutura | Calibrado com exceção registrada (não há superior) | RH |

Pré-requisito técnico: `npm run audit:org-hierarchy` sem líderes ambíguos ou sem gestor antes de abrir ciclo com 180°. O retrato da liderança é gravado na abertura e não muda depois.
