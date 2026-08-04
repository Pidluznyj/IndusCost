-- Performance: Financeiro > Faturamento (fonte NF-e, padrão da tela) demorava
-- para carregar. Causa: ~13 consultas paralelas em NomusNfe repetem o mesmo
-- filtro (status/isMarketSale/billingClassification/valorLiquido) sem nenhum
-- índice que o cubra — cada uma varre a tabela inteira. Os índices por coluna
-- isolada existentes (status, isMarketSale, billingClassification) têm baixa
-- seletividade sozinhos e não ajudam o filtro por faixa de data, que é feito
-- sobre COALESCE("xmlDhEmi","dataProcessamento") — expressão sem índice.
--
-- Os dois índices parciais abaixo cobrem exatamente o predicado usado por
-- fiscalNfeWhereSql() (src/lib/financeBillingNfeDashboard.ts): o Postgres
-- resolve o filtro e a ordenação por data em uma única leitura de índice, sem
-- tocar linha que não interessa. Também acelera queryRecentFiscalNfes, cujo
-- "ORDER BY <mesma expressão> DESC LIMIT 15" passa a ler o índice de trás para
-- frente e parar nas primeiras 15 linhas, em vez de ordenar o histórico inteiro
-- de NF-e fiscais (hoje sem corte de data nenhum).
--
-- "emissao" é o dateBase padrão da tela; "processamento" é a alternativa do
-- mesmo filtro (seletor na UI) — os dois pares de coalesce têm índice próprio
-- porque a ordem dos argumentos muda qual coluna o Postgres pode usar primeiro.
--
-- Puramente aditivo: nenhuma linha, coluna ou resultado de consulta muda.
CREATE INDEX IF NOT EXISTS "NomusNfe_fiscal_market_emissao_idx"
  ON "NomusNfe" (COALESCE("xmlDhEmi", "dataProcessamento"))
  WHERE "status" = 4
    AND "isMarketSale" = true
    AND "billingClassification" = 'MARKET_REVENUE'::"NomusNfeBillingClassification"
    AND "valorLiquido" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "NomusNfe_fiscal_market_processamento_idx"
  ON "NomusNfe" (COALESCE("dataProcessamento", "xmlDhEmi"))
  WHERE "status" = 4
    AND "isMarketSale" = true
    AND "billingClassification" = 'MARKET_REVENUE'::"NomusNfeBillingClassification"
    AND "valorLiquido" IS NOT NULL;

-- queryTopFiscalNfeCustomers / queryRecentFiscalNfes casam NomusNfe ↔ Customer
-- por regexp_replace(...) aplicado nos DOIS lados (dígitos do CNPJ/CPF), porque
-- os dados vêm com máscara divergente entre as fontes. Função em cima da coluna
-- de junção impede o Postgres de usar o índice único existente em
-- Customer.taxId (ele é sobre o texto cru, com máscara). Os índices de
-- expressão abaixo indexam exatamente o valor calculado usado na junção, dos
-- dois lados — sem isso, cada consulta recalcula regexp_replace linha a linha
-- num full scan das duas tabelas para casar o par.
CREATE INDEX IF NOT EXISTS "Customer_taxid_digits_idx"
  ON "Customer" (regexp_replace(COALESCE("taxId", ''), '[^0-9]', '', 'g'));

CREATE INDEX IF NOT EXISTS "NomusNfe_destcnpj_digits_idx"
  ON "NomusNfe" (regexp_replace(COALESCE("xmlDestCnpjCpf", ''), '[^0-9]', '', 'g'));
