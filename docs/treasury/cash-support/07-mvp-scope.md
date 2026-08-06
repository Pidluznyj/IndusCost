# Escopo do MVP — Apoio ao Caixa

---

## MVP READ-ONLY (liberável antes da correção P0)

Itens CS-001 … CS-010.

- Visão unificada (títulos reais, previsões como contexto, movimentos bancários).
- Posição bancária: saldo, entradas, saídas, conciliado, parcial, não conciliado.
- Movimentos válidos — inclusive **sem match e sem classificação**.
- Títulos reais de CR e CP.
- Previsões marcadas visualmente, **sem qualquer ação de conciliação**.
- Estado de conciliação e residual, ambos vindos do motor oficial.
- Warnings estruturados (contexto ausente, cobertura desconhecida, correção não suportada).
- Referências de origem por linha.
- Filtros, paginação e ordenação no backend.
- Detalhe lateral com histórico e aviso de que a conciliação não altera o Nomus.
- Sugestões **somente leitura**.
- Auditoria somente leitura.
- RBAC (`finance.treasury.reconciliation.view`), ACL por conta, feature flag.

**Critério de liberação:** nenhuma rota de escrita exposta; nenhum botão de conciliar
renderizado; flag desligada por padrão.

---

## MVP WRITE (somente após CASH-SUPPORT-P0-CONCURRENCY-001 resolvido e aprovado)

Itens CS-011 … CS-016, CS-019.

- Aceite e rejeição de sugestão.
- Conciliação manual 1:1.
- Parcial, 1:N e N:1.
- Ajustes: tarifa, juros, desconto, abatimento, diferença, unidentified.
- Transferências internas.
- Investigação e reversão.
- Fechamento / revisão de período.

**Gate obrigatório:** os 12 critérios de aceite do documento `05`, com testes de concorrência
real e revisão independente.

---

## PÓS-MVP

- Maker-checker (CS-018) — lacuna real, sem padrão institucional a reutilizar.
- Source revalidation ampliada (CS-017).
- Cobertura avançada de extrato (depende de mudança no parser OFX, hoje proibida).
- Saldo *available* (idem).
- Correções de movimento OFX (idem).
- Anexos em match.
- Automações e refinamentos.

---

## FORA DO ESCOPO — permanentemente

- Dar baixa oficial no Nomus.
- Conciliar previsão (qualquer `lineKind` de forecast).
- Criar segunda fonte de verdade financeira.
- Associação artificial PV → CR.
- Classificar transferência interna como receita ou despesa.
- Criar movimento artificial para zerar diferença.
- Excluir movimento bancário válido da posição.
- Casar título↔conta por semelhança de nome.
