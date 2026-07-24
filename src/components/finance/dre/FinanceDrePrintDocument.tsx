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
function formatDreMarginPct(pct: number | null | undefined): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  return `Margem ${pct.toFixed(1).replace(".", ",")}%`;
}

export function FinanceDrePrintDocument({ report }: Props) {
  const ytd = report.kpis.ytd;
  const opPositive = ytd.resultadoOperacional >= 0;
  const receitaPct = formatDreMarginPct(ytd.receitaLiquidaPct);
  const brutoPct = formatDreMarginPct(ytd.margemBrutaPct);
  const opPct = formatDreMarginPct(ytd.margemOperacionalPct);
  const liquidoPct = formatDreMarginPct(ytd.margemLiquidaAproximadaPct);

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

        <section className="finance-dre-print-kpi-grid" aria-label="Indicadores acumulados (YTD)">
          <div className="finance-dre-print-kpi">
            <div className="finance-dre-print-kpi-label">Receita líquida (YTD)</div>
            <div className="finance-dre-print-kpi-value">
              {formatFinanceKpiCurrency(ytd.receitaLiquida)}
            </div>
            {receitaPct ? <div className="finance-dre-print-kpi-hint">{receitaPct}</div> : null}
          </div>
          <div
            className={
              ytd.lucroBruto >= 0
                ? "finance-dre-print-kpi finance-dre-print-kpi--positive"
                : "finance-dre-print-kpi finance-dre-print-kpi--negative"
            }
          >
            <div className="finance-dre-print-kpi-label">Lucro bruto (YTD)</div>
            <div className="finance-dre-print-kpi-value">
              {formatFinanceKpiCurrency(ytd.lucroBruto)}
            </div>
            {brutoPct ? <div className="finance-dre-print-kpi-hint">{brutoPct}</div> : null}
          </div>
          <div
            className={
              opPositive
                ? "finance-dre-print-kpi finance-dre-print-kpi--positive"
                : "finance-dre-print-kpi finance-dre-print-kpi--negative"
            }
          >
            <div className="finance-dre-print-kpi-label">Resultado operacional (YTD)</div>
            <div className="finance-dre-print-kpi-value">
              {formatFinanceKpiCurrency(ytd.resultadoOperacional)}
            </div>
            {opPct ? <div className="finance-dre-print-kpi-hint">{opPct}</div> : null}
          </div>
          <div
            className={
              ytd.lucroLiquidoAproximado >= 0
                ? "finance-dre-print-kpi finance-dre-print-kpi--positive"
                : "finance-dre-print-kpi finance-dre-print-kpi--negative"
            }
          >
            <div className="finance-dre-print-kpi-label">
              Lucro líquido após IRPJ e CSLL (YTD)
            </div>
            <div className="finance-dre-print-kpi-value">
              {formatFinanceKpiCurrency(ytd.lucroLiquidoAproximado)}
            </div>
            {liquidoPct ? <div className="finance-dre-print-kpi-hint">{liquidoPct}</div> : null}
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
