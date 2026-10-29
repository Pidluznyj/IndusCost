# Inteligência Fiscal 360° — protótipo × interface final

**Referência:** `inteligencia_fiscal_360_prototipo.html` (protótipo navegável com dados fictícios).
**Implementação:** `src/components/finance/fiscal360/` (React/TypeScript, componentes do design system do IndusCost, sem `iframe`).

| Área do protótipo | Componente final | O que mudou | Fonte real |
|---|---|---|---|
| Visão executiva (4 KPIs fictícios, gráfico "Apurado × Pago", qualidade da conciliação) | `Fiscal360Overview` | 12 KPIs com fonte e regra; gráfico em 4 séries (destacado/apurado/devido/pago); medidores reais; por tributo e por empresa | `FiscalMonthlySnapshot`, `FiscalPaymentFact` |
| Tributos pagos (tabela + drilldown fictício) | `Fiscal360Payments` + `Fiscal360PaymentDrawer` | Paginado no servidor; separa **baixa no ERP** de **comprovado**; "em revisão" fora do total; trilha de evidências real (apuração → guia → AP → baixa → comprovante → Tesouraria) | `FiscalPaymentFact`, `FiscalPaymentGuide`, `FiscalPaymentProof`, Tesouraria |
| Conciliação fiscal (fila simulada) | `Fiscal360Reconciliation` | 10 checagens persistidas; títulos AP pendentes de classificação; revisão manual com motivo obrigatório | `FiscalReconciliationItem`, `FiscalApTitleFact`, `FiscalReconciliationDecision` |
| Documentos fiscais | `Fiscal360Documents` + `Fiscal360DocumentDrawer` | Classificação em 8 classes; XML/qualidade; tributos de cabeçalho e **por item**; aviso de NFS-e sem fonte | `FiscalDocumentFact`, `FiscalDocumentTaxFact`, `NomusNfeTaxLine` |
| Operações do grupo | `Fiscal360Intercompany` | Pares emitente → destinatário, receita × despesa individual, tributos **preservados**, divergência indicativa | `FiscalIntercompanySnapshot`, `FiscalApTitleFact` |
| Projeções e cenários (sliders didáticos, alíquotas hipotéticas) | `Fiscal360Forecast` | Cenários persistidos Base/Conservador/Expansão; Personalizado com prévia e salvamento; determinística × estimada; "projeção indisponível" | `FiscalForecastScenario/Snapshot` |
| Processamento (pipeline, "simular lote") | `Fiscal360Processing` | Fila real, defasagem, integridade fonte × materializado, jobs com erro (reenfileirar), reprocessamento seletivo autorizado, regras versionadas | `FiscalProcessingJob/Run/Checkpoint`, `FiscalRuleVersion` |
| Auditoria e qualidade | `Fiscal360Audit` | Pendências abertas/resolvidas, decisões revogáveis, trilha de auditoria | `FiscalDataQualityIssue`, `FiscalSettlementAuditLog` |
| Filtros (empresa, período, competência, tributo) | `Fiscal360Panel` | Empresa/grupo, período (YTD, mês, trimestre, ano, 12m, personalizado), **visão separada** competência × caixa, tributo | `parseFiscal360Filters` (whitelist) |
| Exportar CSV | `Fiscal360Panel` + `/export` | XLSX e CSV com coluna de fonte, filtros e versão; recusa (413) acima de 50 mil linhas | `fiscal360Export.server.ts` |
| Rodapé "dados fictícios" | removido | Nenhum dado demonstrativo (teste de contrato garante) | — |

## Adaptações ao padrão visual do IndusCost
* Navegação interna como **aba de Financeiro › Tributos** (`TaxModule`), ao lado de "Apuração e guias", "Inteligência fiscal" e "Regras de precificação" (todas preservadas).
* Tokens visuais do módulo existente (cinza `#E5E7EB`, azul `#1e3a8a`, texto `#111827`, texto 12 px), `lucide-react` e `recharts`, `formatFinanceCurrency`.
* Responsivo: grids `grid-cols-1 → min-[420px]:2 → lg:4`, tabelas com rolagem horizontal, navegação por abas rolável, gaveta de detalhe em largura total no celular.

## Validação visual
Roteiro de comparação em [fiscal-intelligence-360-homologation.md](./fiscal-intelligence-360-homologation.md) §5 (desktop 1280, tablet 768, celular 375). Verificação automatizada: `fiscal360Contract.test.ts` (responsividade, ausência de dados demonstrativos, oito áreas) e `fiscal360Ui.test.tsx`.
