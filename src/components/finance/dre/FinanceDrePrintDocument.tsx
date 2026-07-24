import React from "react";
import type { FinanceDreReport } from "@/src/lib/financeDreTypes";
import { FinanceDreGrid } from "@/src/components/finance/dre/FinanceDreGrid";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";

type Props = {
  report: FinanceDreReport;
};

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR");
}

/**
 * Documento dedicado de impressão/PDF do DRE Gerencial (A4 paisagem).
 * Montado via portal em document.body — fora do #root — para não cair no
 * visibility:hidden global de reports-print.css.
 */
export function FinanceDrePrintDocument({ report }: Props) {
  const opPositive = report.kpis.resultadoOperacional >= 0;

  return (
    <div id="finance-dre-print-root" data-testid="finance-dre-print-root">
      <article className="finance-dre-print-document" lang="pt-BR">
        <header className="finance-dre-print-header">
          <div className="finance-dre-print-eyebrow">Financeiro · Conselho</div>
          <h1 className="finance-dre-print-title">{report.title}</h1>
          <p className="finance-dre-print-subtitle">{report.subtitle}</p>
          <p className="finance-dre-print-meta">
            {report.companyLabel} · Gerado em {formatGeneratedAt(report.generatedAt)}
          </p>
        </header>

        <section className="finance-dre-print-kpi-grid" aria-label="Indicadores do mês">
          <div className="finance-dre-print-kpi">
            <div className="finance-dre-print-kpi-label">Receita líquida (mês)</div>
            <div className="finance-dre-print-kpi-value">
              {formatFinanceKpiCurrency(report.kpis.receitaLiquida)}
            </div>
          </div>
          <div className="finance-dre-print-kpi">
            <div className="finance-dre-print-kpi-label">Lucro bruto (mês)</div>
            <div className="finance-dre-print-kpi-value">
              {formatFinanceKpiCurrency(report.kpis.lucroBruto)}
            </div>
          </div>
          <div
            className={
              opPositive
                ? "finance-dre-print-kpi finance-dre-print-kpi--positive"
                : "finance-dre-print-kpi finance-dre-print-kpi--negative"
            }
          >
            <div className="finance-dre-print-kpi-label">Resultado operacional</div>
            <div className="finance-dre-print-kpi-value">
              {formatFinanceKpiCurrency(report.kpis.resultadoOperacional)}
            </div>
          </div>
          <div
            className={
              report.kpis.lucroLiquidoAproximado >= 0
                ? "finance-dre-print-kpi finance-dre-print-kpi--positive"
                : "finance-dre-print-kpi finance-dre-print-kpi--negative"
            }
          >
            <div className="finance-dre-print-kpi-label">Lucro líquido após IRPJ e CSLL</div>
            <div className="finance-dre-print-kpi-value">
              {formatFinanceKpiCurrency(report.kpis.lucroLiquidoAproximado)}
            </div>
          </div>
        </section>

        <section className="finance-dre-print-section">
          <h2 className="finance-dre-print-section-title">Demonstrativo mensal</h2>
          <FinanceDreGrid report={report} showAllMonths expandAll className="finance-dre-print-grid" />
        </section>

        {report.qualityAlerts.length > 0 ? (
          <section className="finance-dre-print-section finance-dre-print-alerts">
            <h2 className="finance-dre-print-section-title">Alertas de qualidade</h2>
            <ul>
              {report.qualityAlerts.map((alert) => (
                <li key={alert.code}>{alert.message}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {report.informativeReport.items.length > 0 ? (
          <section className="finance-dre-print-section finance-dre-print-info">
            <h2 className="finance-dre-print-section-title">{report.informativeReport.title}</h2>
            <p className="finance-dre-print-info-sub">{report.informativeReport.subtitle}</p>
            <table className="finance-dre-print-info-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="col-money">Mês</th>
                  <th className="col-money">YTD</th>
                </tr>
              </thead>
              <tbody>
                {report.informativeReport.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="finance-dre-print-info-label">{item.label}</div>
                      {item.reason ? (
                        <div className="finance-dre-print-info-note">{item.reason}</div>
                      ) : null}
                    </td>
                    <td className="col-money">{formatFinanceKpiCurrency(item.highlightAmount)}</td>
                    <td className="col-money">{formatFinanceKpiCurrency(item.ytdAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <footer className="finance-dre-print-footer">
          <p>{report.disclaimer}</p>
          <p>
            IndusCost · DRE Gerencial · {report.companyLabel} · {report.filters.year}
          </p>
        </footer>
      </article>
    </div>
  );
}
