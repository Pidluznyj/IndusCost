import React, { useEffect, useMemo, useState } from "react";
import { fiscal360CompanyLabel } from "@/src/lib/finance/fiscal360/fiscal360Constants";
import { buildFiscal360Query, formatFiscal360Date, formatFiscal360Month, type Fiscal360UiFilters } from "@/src/lib/finance/fiscal360/fiscal360Client";
import type { Fiscal360IntercompanyResponse } from "@/src/lib/finance/fiscal360/fiscal360Types";
import { Badge, Callout, DataTable, ErrorState, KpiCard, KpiGrid, LoadingState, Pagination, Section, money } from "./Fiscal360Shared";
import { useFiscal360Resource } from "./useFiscal360Resource";

export function Fiscal360Intercompany({ filters, refreshKey, onOpenDocument }: { filters: Fiscal360UiFilters; refreshKey: number; onOpenDocument: (id: string) => void }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filters]);
  const query = useMemo(() => buildFiscal360Query(filters, { page, pageSize: 25 }), [filters, page]);
  const { data, loading, error } = useFiscal360Resource<Fiscal360IntercompanyResponse>("intercompany", query, refreshKey);
  if (error) return <ErrorState message={error} />;
  if (!data) return loading ? <LoadingState /> : null;
  const docValue = data.pairs.reduce((s, p) => s + p.documentValue, 0);
  const docTaxes = data.pairs.reduce((s, p) => s + p.highlightedTaxAmount, 0);
  const apPaid = data.pairs.reduce((s, p) => s + p.apPaidAmount, 0);
  return (
    <div className="space-y-4" data-testid="fiscal360-intercompany">
      <KpiGrid>
        <KpiCard label="Faturamento interno detectado" value={money(data.eliminatedRevenue)} hint="Não integra o faturamento externo consolidado" source="NF-e INTERCOMPANY autorizadas" />
        <KpiCard label="Documentos internos (NF-e)" value={data.documents.total.toLocaleString("pt-BR")} hint={`vNF ${money(docValue)}`} />
        <KpiCard label="Tributos destacados em operações internas" value={money(docTaxes)} hint="Obrigações reais de cada CNPJ — NÃO são eliminadas" tone="warn" />
        <KpiCard label="Pagamentos internos (AP)" value={money(apPaid)} hint={`${data.apTitles.total} título(s) entre empresas do grupo`} source="NomusAccountsPayable (pagador e credor do grupo)" />
      </KpiGrid>
      <Callout>
        Eliminação gerencial apenas na visão consolidada: documentos fiscais permanecem na base, tributos efetivamente recolhidos por cada CNPJ são preservados, e custos reais de terceiros não são eliminados. Serviços internos capitalizados em estoque/ativo exigem tratamento contábil específico (sem eliminação automática). NFS-e entre Lazarios e Koppetel: sem fonte integrada.
      </Callout>
      <Section title="Relacionamentos entre empresas" subtitle="Emitente → destinatário. Diferença documento × AP é indicativa (prazos e escopos diferem).">
        <DataTable
          testId="fiscal360-ic-pairs"
          rows={data.pairs}
          rowKey={(p) => `${p.issuerCnpj}>${p.recipientCnpj}`}
          empty="Nenhuma operação entre empresas do grupo no período."
          columns={[
            { key: "p", header: "Relacionamento", render: (p) => <b>{fiscal360CompanyLabel(p.issuerCnpj)} → {fiscal360CompanyLabel(p.recipientCnpj)}</b> },
            { key: "n", header: "NF-e", align: "right", render: (p) => p.documentCount },
            { key: "r", header: "Receita individual (emitente)", align: "right", render: (p) => <span className="text-[#047857]">+ {money(p.documentValue)}</span> },
            { key: "c", header: "Despesa individual (AP destinatário)", align: "right", render: (p) => <span className="text-[#B91C1C]">− {money(p.apAmount)}</span> },
            { key: "t", header: "Tributos destacados", align: "right", render: (p) => money(p.highlightedTaxAmount) },
            { key: "pg", header: "Pago internamente", align: "right", render: (p) => money(p.apPaidAmount) },
            { key: "d", header: "Possível divergência", align: "right", render: (p) => (Math.abs(p.divergenceAmount) > 1 ? <Badge tone="warn">{money(p.divergenceAmount)}</Badge> : <Badge tone="good">ok</Badge>) },
          ]}
        />
      </Section>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Documentos internos">
          <DataTable
            rows={data.documents.rows}
            rowKey={(d) => d.nomusNfeId}
            onRowClick={(d) => onOpenDocument(d.nomusNfeId)}
            empty="Sem NF-e internas no filtro."
            columns={[
              { key: "n", header: "NF-e", render: (d) => (<><b>{d.numero ?? d.nomusExternalId}</b><br /><span className="text-[#6B7280]">{formatFiscal360Date(d.issueDate)}</span></>) },
              { key: "p", header: "Emitente → destino", render: (d) => `${fiscal360CompanyLabel(d.companyCnpj)} → ${d.recipientGroupCnpj ? fiscal360CompanyLabel(d.recipientGroupCnpj) : "?"}` },
              { key: "v", header: "vNF", align: "right", render: (d) => money(d.vNF) },
              { key: "t", header: "Tributos", align: "right", render: (d) => money(d.highlightedTaxTotal) },
            ]}
          />
          <Pagination page={data.documents.page} pageSize={data.documents.pageSize} total={data.documents.total} onPage={setPage} />
        </Section>
        <Section title="Títulos AP entre empresas" subtitle={data.apTitles.total > data.apTitles.rows.length ? `Mostrando ${data.apTitles.rows.length} de ${data.apTitles.total}` : undefined}>
          <DataTable
            rows={data.apTitles.rows}
            rowKey={(a) => String(a.apExternalId)}
            empty="Sem títulos AP entre empresas no período."
            columns={[
              { key: "id", header: "AP Nomus", render: (a) => <b>{a.apExternalId}</b> },
              { key: "p", header: "Pagador → credor", render: (a) => `${fiscal360CompanyLabel(a.companyCnpj)} → ${a.intercompanyCounterpartyCnpj ? fiscal360CompanyLabel(a.intercompanyCounterpartyCnpj) : a.personName ?? "?"}` },
              { key: "m", header: "Competência", render: (a) => formatFiscal360Month(a.competenceMonth) },
              { key: "v", header: "Valor", align: "right", render: (a) => money(a.amountOriginal) },
              { key: "pg", header: "Pago", align: "right", render: (a) => money(a.amountPaid) },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
