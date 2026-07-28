# Guia — Fechamento do dia

**Tela:** `/finance/treasury/closing`  
**Permissões:** `closing.view` (preview) + `closing.close` / `closing.reopen`.

## Antes de fechar

1. Saldos observados do dia preenchidos.  
2. OFX do dia importado (se aplicável) e conciliação avançada.  
3. Transferências críticas não “esquecidas” em trânsito (ou ressalva).  
4. Exceções bloqueantes tratadas.  
5. Sync Nomus sem falha recente crítica.

## Passo a passo

### 1. Preview
1. Abra Fechamento diário.  
2. Selecione a data civil.  
3. Execute **Preview**.  
4. Leia:
   - bloqueios absolutos (impedem fechar);
   - itens que exigem **ressalva**;
   - avisos informativos.

### 2. Tratar bloqueios absolutos
Exemplos: saldo observado ausente, dia já fechado, saldo negativo proibido, fonte indisponível, duplicidade suspeita aberta.  
Corrija a causa e **gere novo preview**.

### 3. Registrar ressalvas
Para cada caveat obrigatório, confirme/acknowledge com texto claro (não use ressalva genérica vazia).

### 4. Confirmar fechamento
1. Revise o `sourceHash` / orientação de conflito.  
2. Confirme o close.  
3. Se receber **409**, a base mudou após o preview — atualize preview e tente de novo.

### 5. Após fechar
- O fechamento fica **imutável**.  
- Mudanças posteriores geram exceção pós-fechamento — não reescrevem o CLOSED.  
- Para corrigir: fluxo de **reabertura** (nova versão) + justificativa.

## Reabertura

1. Permissão `closing.reopen`.  
2. Informe motivo.  
3. Opere correções.  
4. Feche novamente (nova versão).

## Não fazer
- Fechar com divergência oculta.  
- Apagar movimentos/lançamentos para “bater” saldo.  
- Editar payload de um CLOSED antigo.
