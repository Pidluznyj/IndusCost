-- CommissionOrderItemSnapshot.sourceHash deixa de ser único global.
--
-- MOTIVO
-- `sourceHash` representa CONTEÚDO do item (pedido, NF, item, produto, valores,
-- regra e status). Num modelo versionado que preserva histórico, um item que
-- NÃO mudou entre duas versões legítimas do snapshot pai produz exatamente o
-- mesmo conteúdo — e portanto o mesmo hash. Unicidade global de conteúdo é,
-- por definição, incompatível com preservação de histórico.
--
-- Sintoma em produção: PD 02763 não conseguia materializar nova versão porque o
-- item inalterado (1%, R$ 10,00, COMMISSIONABLE) já tinha o hash
-- b10ef9e54b1f2b38bc6654f601ae9aed1ec22eab7a389bc4cbb3e3343a0731fe gravado na
-- versão anterior.
--
-- O QUE PROTEGE A IDENTIDADE
-- A unicidade lógica do item dentro do snapshot continua garantida por
-- CommissionOrderItemSnapshot_orderSnapshotId_salesOrderItemId_key, que é
-- preservada e NÃO é tocada aqui. Essa é a regra que impede o mesmo
-- salesOrderItemId aparecer duas vezes no mesmo snapshot.
--
-- SEGURANÇA
-- Operação puramente estrutural: nenhum dado é lido, alterado ou removido.
-- Nenhum sourceHash histórico é recalculado. Remover um índice único nunca
-- invalida linhas existentes — apenas deixa de recusar futuras inserções que
-- hoje são legítimas.
--
-- REVERSÃO
-- Recriar o índice único só é possível se não houver hashes repetidos:
--   CREATE UNIQUE INDEX "CommissionOrderItemSnapshot_sourceHash_key"
--     ON "CommissionOrderItemSnapshot"("sourceHash");
-- Após qualquer nova materialização versionada, espera-se que existam
-- repetições legítimas e a reversão falhe — o que é o comportamento correto.

DROP INDEX IF EXISTS "CommissionOrderItemSnapshot_sourceHash_key";

-- sourceHash segue como coluna de auditoria/rastreio: índice comum para
-- permitir busca por hash sem impor unicidade.
CREATE INDEX IF NOT EXISTS "CommissionOrderItemSnapshot_sourceHash_idx"
  ON "CommissionOrderItemSnapshot"("sourceHash");
