# Guia — Conciliação bancária

**Telas:**  
- Importação: `/finance/treasury/ofx` ou `/finance/treasury/bank-movements`  
- Workspace: `/finance/treasury/reconcile`  

**Isto não é** a Conciliação de Carteira (pedido/NF).

## 1. Importar OFX
1. Selecione a conta financeira IndusCost correta.  
2. Envie o arquivo (preview).  
3. Confira totais, período e linhas NEW / DUPLICATE / INVALID.  
4. Confirme o apply.  
5. Reimportar o mesmo arquivo não deve duplicar (idempotência por hash/fingerprint).

## 2. Workspace
Em Conciliação bancária veja:
- pendentes;
- não conciliados;
- matches ativos;
- amostra de movimentos.

Use Movimentos bancários para detalhe e ações.

## 3. Sugestões
O sistema sugere matches (score HIGH/MEDIUM/LOW) com motivos.  
**Nada é conciliado automaticamente** — você confirma.

## 4. Aceitar match
1. Revise valor, data, contraparte e alocações (parcial, fee, diferença, etc.).  
2. Aceite o match (`POST /reconciliations`).  
3. Confirme que o título Nomus **não** foi baixado pelo IndusCost — baixa oficial continua no Nomus.

## 5. Desfazer (unmatch)
Use unmatch com motivo quando o vínculo estiver errado (ainda não “reverso forte”).

## 6. Reversão forte
Para desfazer match já consolidado com trilha forte:
1. Justificativa.  
2. Digite exatamente a frase **`REVERTER`**.  
3. Confirme.  
4. Se o dia estiver fechado, espere orientação de exceção pós-fechamento / reabertura.

## 7. Boas práticas
- Concilie diariamente após OFX.  
- Trate PARTIAL com consciência do saldo remanescente.  
- Diferenças viram exceção/alerta — não “arredonde” no silêncio.  
- Transferências internas têm tratamento próprio (não misturar com receita).

## Permissões
| Ação | Resource |
|------|----------|
| Ver movimentos/workspace | `finance.treasury.reconciliation` `view` |
| Importar OFX / accept / unmatch | `…reconciliation` `manage` |
| Reverse | `…reconciliation.reverse` `execute` |
