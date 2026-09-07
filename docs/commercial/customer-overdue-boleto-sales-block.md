# Trava de venda por boleto vencido — identidade financeira do cliente

Bloqueio de **criação de venda** (não de orçamento) quando o cliente tem boleto
vencido em aberto no Contas a Receber, ou quando a identidade financeira do
cliente não pode ser validada com segurança. Derivado em leitura; nada é
gravado em `Customer.status`, no Nomus ou em qualquer tabela.

## CUSTOMER FINANCIAL IDENTITY AUTHORITY

| Papel | Campo | Origem / regra |
|---|---|---|
| **Primary** | `Customer.nomusExternalPersonId` | Nomus `GET pessoas` → `pessoa.id` (idPessoa). Único escritor: `scripts/nomusCustomersSyncV1.ts` (create e update). Comprovado no código. |
| **Consistency evidence** | `SalesOrder.externalCustomerId` | Nomus `idPessoaCliente` do pedido (`scripts/nomusSalesOrdersSyncV1.ts`). Só valida consistência; **não** é requisito. |
| **AR authority** | `NomusAccountsReceivable.personId` | Consultado apenas com identidade RESOLVED. |
| **Boleto authority** | `paymentMethodId = 10` | Catálogo observado na homologação: 10 = "Boleto Bancário" (4.835 títulos, 290 clientes); nenhum outro ID com "boleto". `paymentMethodName` é rótulo/diagnóstico. |
| **Overdue** | `dueDate` civil `< hoje` | Vence hoje **não** bloqueia. |
| **Open** | saldo canônico `> 0` + elegibilidade oficial | `filterOfficialArOverdueTitles` (dedup pré-NF, suspensão, presença/frescor da fonte). |
| **Unresolved** | fail closed | Sem identidade validável → venda bloqueada, sem afirmar inadimplência. |
| **Nomus writeback** | none | — |

### Resolução (`resolveCustomerFinancialIdentity`)

| Caso | `nomusExternalPersonId` | `SalesOrder.externalCustomerId` | Resultado |
|---|---|---|---|
| A | presente | nenhum pedido | RESOLVED (cliente sem pedido resolve — 863 casos na homologação) |
| B | presente | todos iguais ao do Customer | RESOLVED |
| C | presente | algum diferente | UNRESOLVED_IDENTITY_CONFLICT → bloqueia (não escolhe, não soma, não infere) |
| D | ausente | exatamente 1 | UNRESOLVED_IDENTITY → bloqueia (não há regra oficial que promova pedido a identidade; 0 casos observados) |
| E | ausente | nenhum | UNRESOLVED_IDENTITY → bloqueia (1 caso observado) |

Nome/razão social nunca participa: dois clientes com o mesmo `companyName` e
`personId` diferentes não cruzam dívida.

## Estados e payload

`salesBlock` (browser-safe, `customerSalesBlockView.ts`):

```ts
{
  blocked: boolean;
  reason: "OVERDUE_BOLETO" | "FINANCIAL_IDENTITY_UNRESOLVED" | null;
  resolution: "RESOLVED" | "UNRESOLVED_IDENTITY" | "UNRESOLVED_IDENTITY_CONFLICT" | "UNRESOLVED_PAYMENT_METHOD";
  // só com permissão de Contas a Receber:
  overdueBoletoCount?, overdueOpenBalance?, oldestDueDate?, maxDaysOverdue?, nomusPersonId?, evaluatedAt?
}
```

- `OVERDUE_BOLETO`: inadimplência provada pelo motor oficial de AR.
- `FINANCIAL_IDENTITY_UNRESOLVED`: identidade não validável; `nomusPersonId`
  fica `null` (nenhum AR foi consultado).
- `UNRESOLVED_PAYMENT_METHOD`: identidade ok, todos os vencidos sem forma de
  pagamento informada → não prova boleto, não bloqueia.

## Hard block

`assertCustomerSalesAllowed` roda em `POST /api/proposals/:id/generate-sales-order`
(único `salesOrder.create` local; o sync inbound do Nomus não é protegido nem
alterado — `NOMUS_NATIVE_SALES_BLOCK=NAO`). Resposta `409` com:

- `CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO` — "Venda bloqueada. O cliente possui boleto(s) vencido(s) em aberto."
- `CUSTOMER_SALES_BLOCKED_FINANCIAL_IDENTITY_UNRESOLVED` — "Venda bloqueada. Não foi possível validar com segurança a identidade financeira do cliente."

## UI

Badge vermelho `[🔒 Venda bloqueada]` nos dois casos; o tooltip distingue:

- boleto vencido: "Venda bloqueada: o cliente possui boleto(s) vencido(s)." (ou
  detalhes financeiros com permissão de AR);
- identidade não validada: "Venda bloqueada: não foi possível validar a
  situação financeira do cliente." — nunca menciona boleto.

"Nova venda" desabilitado nos dois casos; "Novo orçamento" permanece.

## Performance

Lote para N clientes: (0–1) consulta de `Customer` só para clientes cuja linha
não trouxe `nomusExternalPersonId`, 1 consulta de `SalesOrder` (evidência),
1 consulta de AR. Sem N+1.

## Auditoria

`scripts/audit-customer-overdue-boleto-sales-block.sql` (read only): identidade
primária, evidência dos pedidos, resolução, títulos do `personId`, panorama
bruto (diagnóstico — a regra é o motor AR) e catálogo de formas de pagamento.

## Arquivos

- Regras puras: `src/lib/commercial/customerSalesBlock.ts`
- Contrato público/UI: `src/lib/commercial/customerSalesBlockView.ts`
- Carga Prisma em lote: `src/lib/commercial/customerSalesBlock.server.ts`
- Componentes: `src/components/customers/CustomerSalesBlockBadge.tsx`
- Testes: `customerSalesBlock.test.ts`, `customerSalesBlock.server.test.ts`, `customerSalesBlockUi.test.tsx`
