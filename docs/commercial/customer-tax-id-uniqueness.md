# Unicidade do CNPJ/CPF do cliente — riscos atuais e correção estrutural proposta

Origem: incidente de 26/10/2026 (cadastro com CNPJ `08.535.015/0001-66` já existente derrubou o servidor).
A correção `b474bda9` (branch `fix/customer-create-duplicate-taxid`) evita a queda e decide duplicidade pelos
**dígitos** no cadastro manual e na Inteligência de CNPJ. Este documento registra o que **continua** podendo
duplicar e propõe a correção estrutural como tarefa separada. Nada aqui executa migration ou altera dados.

## Situação do banco

- `Customer.taxId` é `@unique` **como texto**. `08.535.015/0001-66` e `08535015000166` são textos diferentes, então
  o índice único aceita os dois. Para o negócio, são o mesmo cliente.
- O banco tem os dois formatos:
  - o cadastro manual grava como foi digitado (com ou sem máscara);
  - o Nomus, a Inteligência de CNPJ e a importação por planilha gravam só dígitos.

## Quem grava `Customer.taxId`

| Caminho | Formato gravado | Como confere duplicidade | Situação após `b474bda9` |
|---|---|---|---|
| `POST /api/customers` (tela Clientes) | Como digitado (com trim) | Dígitos + lock consultivo por documento + P2002 → 409 | **Protegido** |
| `PUT /api/customers/:id` | Como digitado | Dígitos (excluindo o próprio cliente) + lock + P2002 → 409 | **Protegido** |
| `POST /api/customers/from-company-intelligence` | Só dígitos | Dígitos + P2002 → 409 `DUPLICATE_TAX_ID` (sem lock) | Protegido contra formato. A corrida com outro caminho tem janela pequena |
| Sincronização Nomus (`scripts/nomusCustomersSyncV1.ts`) | Só dígitos (`normalizeTaxId`) | `findMany({ taxId: { in: dígitos } })`, **texto exato** | **Risco alto** (R1) |
| Importação por planilha (`/api/customers/import/*`, `CustomerConfig`) | Só dígitos (`replace(/\D/g, "")`) | `findMany({ taxId: { in } })`, **texto exato** | **Risco alto** (R2, R3) |
| Seeds de teste (`scripts/testing/*`) | — | — | Só bancos descartáveis |

## Riscos

**R1 — Nomus duplica clientes cadastrados à mão com máscara.**
- *Como acontece:* um cliente criado na tela como `08.535.015/0001-66` não é encontrado pela sincronização, que
  procura `08535015000166`. A sincronização faz `customer.create`.
- *Resultado:* dois clientes para a mesma empresa. Propostas, pedidos, comissões, crédito e CRM ficam divididos
  entre os dois.
- *Situação:* pode **já ter acontecido** em produção; a consulta A1 abaixo responde.

**R2 — A importação por planilha duplica clientes com máscara.**
- Mesmo mecanismo do R1.
- Duas linhas com o mesmo documento no **mesmo arquivo** fazem o `createMany` inteiro falhar. O servidor não cai (o
  erro é tratado e devolve 500 "Erro ao salvar dados no banco"), mas nenhuma linha é importada.

**R3 — Zero à esquerda perdido na planilha.**
- Uma célula numérica do Excel transforma `08535015000166` em `8535015000166` (13 dígitos).
- O resultado é um cliente novo com documento inválido, que nunca casa com o verdadeiro.

**R4 — Corrida entre caminhos diferentes.**
- O lock consultivo só existe no cadastro manual. Nomus e importação não o tomam.
- Uma gravação simultânea do mesmo documento em formatos diferentes, por caminhos diferentes, ainda pode passar.
- *Janela:* pequena (segundos). A probabilidade é baixa e o impacto é igual ao do R1.

**R5 — Duplicatas antigas.**
- O cadastro manual passou a responder 409 e devolve o cliente **mais antigo** pelos dígitos. Duplicatas que já
  existam continuam lá: nada é unificado automaticamente, por decisão.

## Auditoria (somente leitura; rodar em homologação e depois em produção)

```sql
-- A1. Grupos de clientes com o mesmo documento (dígitos) — duplicatas reais.
SELECT regexp_replace("taxId", '[^0-9]', '', 'g') AS digits,
       count(*) AS clientes,
       array_agg("taxId" ORDER BY "createdAt") AS formatos,
       array_agg(id ORDER BY "createdAt") AS ids,
       array_agg(("nomusExternalPersonId" IS NOT NULL) ORDER BY "createdAt") AS veio_do_nomus
FROM "Customer"
GROUP BY 1
HAVING count(*) > 1
ORDER BY 2 DESC, 1;

-- A2. Distribuição de formatos.
SELECT CASE WHEN "taxId" ~ '^[0-9]+$' THEN 'só dígitos' ELSE 'com máscara/outros' END AS formato,
       length(regexp_replace("taxId", '[^0-9]', '', 'g')) AS qtd_digitos,
       count(*)
FROM "Customer" GROUP BY 1, 2 ORDER BY 1, 2;

-- A3. Documentos com quantidade de dígitos fora de CPF (11) / CNPJ (14) — inclui zero à esquerda perdido (13).
SELECT id, "taxId", "companyName", "createdAt", "nomusExternalPersonId"
FROM "Customer"
WHERE length(regexp_replace("taxId", '[^0-9]', '', 'g')) NOT IN (11, 14)
ORDER BY "createdAt";

-- A4. Para cada grupo de A1: quantos registros dependem de cada cliente (base da decisão de unificação).
SELECT c.id, c."taxId",
  (SELECT count(*) FROM "Proposal" p WHERE p."customerId" = c.id) AS propostas,
  (SELECT count(*) FROM "SalesOrder" s WHERE s."customerId" = c.id) AS pedidos
FROM "Customer" c
WHERE regexp_replace(c."taxId", '[^0-9]', '', 'g') IN (
  SELECT regexp_replace("taxId", '[^0-9]', '', 'g') FROM "Customer" GROUP BY 1 HAVING count(*) > 1
)
ORDER BY regexp_replace(c."taxId", '[^0-9]', '', 'g'), c."createdAt";
```

## Correção estrutural proposta (tarefa separada; exige aprovação de migration e de unificação)

1. **Auditoria e decisão de unificação.** Rodar A1–A4 em homologação e em produção. Para cada grupo duplicado, o
   negócio decide qual cliente fica. Depois, mover as referências e arquivar o duplicado. São dezenas de tabelas com
   FK para `Customer`. A unificação não é automática: segue um script com simulação (dry-run), aplicação e reversão,
   como o padrão do repositório.
2. **Identidade única pelos dígitos no banco.** Depois da unificação, uma migration cria
   `CREATE UNIQUE INDEX "Customer_taxId_digits_key" ON "Customer" (regexp_replace("taxId", '[^0-9]', '', 'g'))`.
   - É um índice de expressão: entra em `migrationOnlyStatements` do harness de testes, como os demais objetos que
     só existem em migration.
   - O banco passa a recusar duplicata em qualquer caminho e em qualquer corrida, e o P2002 vira o 409 já tratado.
   - A migration falha se houver duplicata. Por isso ela só roda depois do passo 1.
   - Alternativa sem índice de expressão: coluna gerada `taxIdDigits` com `@unique`.
3. **Sincronização Nomus e importação procuram por dígitos.** Uma variante em lote de
   `findCustomerIdByTaxIdDigits`, para atualizar o cliente existente em vez de criar outro.
   - A importação recusa a linha com 13 dígitos ou com tamanho fora de 11/14 (zero à esquerda perdido), em vez de
     inventar um documento.
   - Linhas duplicadas no mesmo arquivo são agrupadas antes do `createMany`.
4. **Lock nos demais caminhos** (opcional depois do passo 2): Inteligência de CNPJ e Nomus tomam o mesmo lock
   consultivo (`CUSTOMER_TAX_ID_LOCK_NAMESPACE`) dentro de transação.

Ordem de implantação: auditoria (A1–A4) → unificação aprovada → migration → código do passo 3. Nos testes:
PostgreSQL 17 real com duplicatas sintéticas, migration recusada enquanto houver duplicata e Nomus/importação
reconhecendo clientes com máscara.
