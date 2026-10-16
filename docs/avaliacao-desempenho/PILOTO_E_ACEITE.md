# Piloto e aceite — não executar em produção

Este arquivo descreve um piloto futuro. Nenhum passo abaixo foi executado contra servidor, banco real, Nomus, Cloudflare ou fila de mensagem.

## Pré-condições que ainda não existem

1. RH e jurídico fecham as linhas de `DECISOES_PENDENTES.md`.
2. A migration aditiva é aplicada num banco descartável, nunca no de produção, por alguém autorizado.
3. A gravação Prisma deixa de ser “lê o grafo inteiro e substitui” antes de duas pessoas salvarem ao mesmo tempo.
4. A tela passa a escolher participantes, emitir o convite e mostrar calibração, devolutiva e PDI.
5. Alguém percorre o portal no celular (320, 360 e 390 px) e o administrativo no notebook.

## Dados fictícios sugeridos

Um RH, um líder e seis pessoas: ativa com mais de 90 dias, admitida há pouco, afastada, inativa, transferida de setor, sem gestor. Nomes inventados. Nenhum CPF, nascimento ou matrícula como senha.

## Casos

1. Modelo nasce em rascunho e em validação. Publicar não altera uma versão já publicada; a edição exige cópia.
2. Ciclo em rascunho pode ser preparado. Abrir com `PERFORMANCE_OFFICIAL_PUBLICATION=0` devolve bloqueio de governança.
3. Pessoa com admissão recente fica não elegível, salvo exceção escrita.
4. QR sozinho não abre o formulário. Sem OTP configurado a mensagem é neutra.
5. Cinco códigos errados bloqueiam o convite. Reemitir revoga o anterior.
6. Colaborador responde 12 itens, usa “não sei”, sai e retoma, envia uma vez. O segundo envio pelo portal falha.
7. Líder não vê a autoavaliação antes de enviar a dele. Notas 1 e 4 sem exemplo são recusadas.
8. Ocorrência não muda quadrante.
9. Média 2,499 fica na faixa baixa; 2,50 na média; 3,499 na média; 3,50 na alta. Exibir 2,50 não muda a faixa de 2495/1000.
10. Ciência pode ser registrada sem concordância.
11. Lembrete não sai do sistema.

## Go / no-go

No-go enquanto qualquer item de pré-condição estiver aberto, a flag pública estiver ligada sem canal de identidade, ou o questionário for tratado como instrumento validado.

## Homologação futura

Continua fora deste repositório: parecer do RH sobre os textos, parecer jurídico, escolha do canal do código, aplicação da migration e piloto com operadores. Não inclui SSH, deploy nem Nomus.
