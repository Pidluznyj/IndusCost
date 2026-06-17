import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import {
  buildSoldProductsPrintFilterSummary,
  formatSoldProductsPrintDate,
  formatSoldProductsPrintDateTime,
  formatSoldProductsPrintLeader,
  formatSoldProductsPrintMoney,
  formatSoldProductsPrintPercent,
  formatSoldProductsPrintQty,
  SOLD_PRODUCTS_COMPANY_DOC_FALLBACK,
  SOLD_PRODUCTS_PRINT_FOOTER_NOTE,
  SOLD_PRODUCTS_PRINT_SUBTITLE,
  SOLD_PRODUCTS_PRINT_TITLE,
} from "@/src/lib/soldProductsPrintMeta.js";
import type { SoldProductsDashboardPayload } from "@/src/lib/salesProductRankingTypes.js";

function resolvePrintLogoSrc(branding: BrandingSettingsDTO): string | null {
  const candidates = [
    branding.proposalLogoDataUrl,
    branding.systemExpandedLogoDataUrl,
    branding.systemCompactLogoDataUrl,
  ];
  for (const src of candidates) {
    if (typeof src === "string" && src.trim().toLowerCase().startsWith("data:image/")) {
      return src.trim();
    }
  }
  return null;
}

export function SoldProductsPrintDocument({
  payload,
  branding,
  emitterName,
}: {
  payload: SoldProductsDashboardPayload;
  branding: BrandingSettingsDTO;
  emitterName?: string | null;
}) {
  const { filters, summary, ranking } = payload;
  const logoSrc = useMemo(() => resolvePrintLogoSrc(branding), [branding]);
  const filterSummary = useMemo(() => buildSoldProductsPrintFilterSummary(filters), [filters]);
  const slogan = branding.slogan?.trim() || null;

  return (
    <div id="sold-products-print-root">
      <article className="sold-products-print-document" lang="pt-BR">
        <header className="sold-products-print-doc-header">
          <div className="sold-products-print-header-row">
            <div className="sold-products-print-company">
              {logoSrc ? (
                <img
                  src={logoSrc}
                  alt={branding.companyName}
                  className="sold-products-print-logo"
                />
              ) : null}
              <div className="sold-products-print-company-text">
                <p className="sold-products-print-company-name">{branding.companyName}</p>
                {slogan ? <p className="sold-products-print-company-slogan">{slogan}</p> : null}
                <p>
                  <span className="sold-products-print-label">CNPJ:</span>{" "}
                  {SOLD_PRODUCTS_COMPANY_DOC_FALLBACK.taxId}
                </p>
                <p>{SOLD_PRODUCTS_COMPANY_DOC_FALLBACK.addressLine}</p>
                <p>
                  <span className="sold-products-print-label">E-mail:</span>{" "}
                  {SOLD_PRODUCTS_COMPANY_DOC_FALLBACK.email}
                </p>
              </div>
            </div>
            <div className="sold-products-print-report-meta">
              <p className="sold-products-print-report-kind">Relatório gerencial</p>
              <p className="sold-products-print-report-title">{SOLD_PRODUCTS_PRINT_TITLE}</p>
              <p>
                <span className="sold-products-print-label">Emitido em:</span>{" "}
                {formatSoldProductsPrintDateTime(payload.generatedAt)}
              </p>
              {emitterName?.trim() ? (
                <p>
                  <span className="sold-products-print-label">Emitido por:</span> {emitterName.trim()}
                </p>
              ) : null}
              <p>
                <span className="sold-products-print-label">Período:</span> {filters.periodLabel}
              </p>
              <p>
                <span className="sold-products-print-label">Ordenação:</span> {filters.sortByLabel}
              </p>
            </div>
          </div>
          <p className="sold-products-print-doc-subtitle">{SOLD_PRODUCTS_PRINT_SUBTITLE}</p>
          <table className="sold-products-print-meta-table">
            <tbody>
              <tr>
                <th>Tipo de data</th>
                <td>{filters.dateBasisLabel}</td>
                <th>Status pedido</th>
                <td>{filters.orderStatusLabel}</td>
              </tr>
              <tr>
                <th>Tipo de cliente</th>
                <td>{filters.customerScopeLabel}</td>
                <th>Empresa</th>
                <td>{filters.companyLabel}</td>
              </tr>
              <tr>
                <th>Escopo</th>
                <td colSpan={3}>{filterSummary}</td>
              </tr>
            </tbody>
          </table>
        </header>

        <section className="sold-products-print-section">
          <h2 className="sold-products-print-section-title">Resumo executivo</h2>
          <table className="sold-products-print-kpi-table">
            <tbody>
              <tr>
                <th>Quantidade total</th>
                <td>{formatSoldProductsPrintQty(summary?.totalQuantity)}</td>
                <th>Valor total</th>
                <td>{formatSoldProductsPrintMoney(summary?.totalAmount)}</td>
                <th>Produtos no ranking</th>
                <td>{summary?.productsCount ?? "—"}</td>
              </tr>
              <tr>
                <th>Pedidos</th>
                <td>{summary?.ordersCount ?? "—"}</td>
                <th>Clientes compradores</th>
                <td>{summary?.customersCount ?? "—"}</td>
                <th>Preço médio</th>
                <td>{formatSoldProductsPrintMoney(summary?.averageUnitPrice)}</td>
              </tr>
              <tr>
                <th>Líder em quantidade</th>
                <td colSpan={2}>{formatSoldProductsPrintLeader(summary?.topProductByQuantity ?? null)}</td>
                <th>Líder em valor</th>
                <td colSpan={2}>{formatSoldProductsPrintLeader(summary?.topProductByAmount ?? null)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="sold-products-print-section sold-products-print-ranking-section">
          <h2 className="sold-products-print-section-title">
            Ranking de produtos ({ranking.length} · ordenado por {filters.sortByLabel.toLowerCase()})
          </h2>
          {ranking.length === 0 ? (
            <p className="sold-products-print-empty">Nenhum produto vendido no período selecionado.</p>
          ) : (
            <table className="sold-products-print-ranking-table">
              <colgroup>
                <col className="col-rank" />
                <col className="col-code" />
                <col className="col-product" />
                <col className="col-qty" />
                <col className="col-money" />
                <col className="col-money" />
                <col className="col-count" />
                <col className="col-count" />
                <col className="col-date" />
                <col className="col-pct" />
                <col className="col-pct" />
              </colgroup>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Código</th>
                  <th>Produto</th>
                  <th className="col-num">Qtd.</th>
                  <th className="col-money">Valor vendido</th>
                  <th className="col-money">Preço médio</th>
                  <th className="col-num">Pedidos</th>
                  <th className="col-num">Clientes</th>
                  <th className="col-date">Última venda</th>
                  <th className="col-num">% qtd</th>
                  <th className="col-num">% valor</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((row) => (
                  <tr key={row.productId}>
                    <td className="col-num">{row.rank}</td>
                    <td className="col-code">{row.productCode ?? "—"}</td>
                    <td className="col-product">{row.productName}</td>
                    <td className="col-num col-nowrap">{formatSoldProductsPrintQty(row.quantitySold)}</td>
                    <td className="col-money col-nowrap">{formatSoldProductsPrintMoney(row.amountSold)}</td>
                    <td className="col-money col-nowrap">
                      {formatSoldProductsPrintMoney(row.averageUnitPrice)}
                    </td>
                    <td className="col-num">{row.ordersCount}</td>
                    <td className="col-num">{row.customersCount}</td>
                    <td className="col-date col-nowrap">
                      {formatSoldProductsPrintDate(row.lastSaleDate)}
                    </td>
                    <td className="col-num col-nowrap">
                      {formatSoldProductsPrintPercent(row.quantitySharePercent)}
                    </td>
                    <td className="col-num col-nowrap">
                      {formatSoldProductsPrintPercent(row.amountSharePercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <footer className="sold-products-print-doc-footer">
          <p>
            Relatório gerado pelo IndusCost · {formatSoldProductsPrintDateTime(payload.generatedAt)}
          </p>
          <p className="sold-products-print-footer-note">{SOLD_PRODUCTS_PRINT_FOOTER_NOTE}</p>
        </footer>
      </article>
    </div>
  );
}
