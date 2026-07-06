import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type { PricingCommissionBand, PricingMarginBand, PricingSortKey } from "@/src/lib/pricingListFilters";
import type { CommercialPublishedPricesApiResponse } from "@/src/lib/pricing/commercialPublishedPrices.types";
import {
  buildCommercialPublishedPricesSearchParams,
  COMMERCIAL_PUBLISHED_PRICES_ENDPOINT,
  filterCommercialPublishedRows,
  mapPricingSortToPublishedApiSort,
  needsClientBandFiltering,
  paginateRows,
} from "@/src/lib/pricing/commercialPublishedPricesUi";

export type CommercialPublishedPricesFilters = {
  search: string;
  taxRuleId: string;
  marginBand: PricingMarginBand;
  commissionBand: PricingCommissionBand;
  sortBy: PricingSortKey;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 50;

export function useCommercialPublishedPrices(filters: CommercialPublishedPricesFilters) {
  const [data, setData] = useState<CommercialPublishedPricesApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clientBandFiltering = needsClientBandFiltering({
    marginBand: filters.marginBand,
    commissionBand: filters.commissionBand,
  });

  const requestUrl = useMemo(() => {
    const query = buildCommercialPublishedPricesSearchParams({
      search: filters.search,
      taxRuleId: filters.taxRuleId,
      sort: mapPricingSortToPublishedApiSort(filters.sortBy),
      page: clientBandFiltering ? 1 : filters.page,
      pageSize: clientBandFiltering ? 200 : filters.pageSize,
    });
    return `${COMMERCIAL_PUBLISHED_PRICES_ENDPOINT}${query}`;
  }, [
    clientBandFiltering,
    filters.commissionBand,
    filters.marginBand,
    filters.page,
    filters.pageSize,
    filters.search,
    filters.sortBy,
    filters.taxRuleId,
  ]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommercialPublishedPricesApiResponse>(requestUrl);
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(e instanceof Error ? e.message : "Não foi possível carregar preços comerciais publicados.");
    } finally {
      setLoading(false);
    }
  }, [requestUrl]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const bandFilteredRows = useMemo(() => {
    if (!data) return [];
    return filterCommercialPublishedRows(data.rows, {
      marginBand: filters.marginBand,
      commissionBand: filters.commissionBand,
    });
  }, [data, filters.commissionBand, filters.marginBand]);

  const view = useMemo(() => {
    if (!data) {
      return {
        tables: [],
        rows: [],
        pagination: {
          page: filters.page,
          limit: filters.pageSize || DEFAULT_PAGE_SIZE,
          total: 0,
          totalPages: 1,
        },
        totals: null,
        message: null as string | null,
      };
    }

    if (clientBandFiltering) {
      const paged = paginateRows(bandFilteredRows, filters.page, filters.pageSize || DEFAULT_PAGE_SIZE);
      return {
        tables: data.tables,
        rows: paged.rows,
        pagination: paged.pagination,
        totals: data.totals,
        message: data.message,
      };
    }

    return {
      tables: data.tables,
      rows: data.rows,
      pagination: data.pagination,
      totals: data.totals,
      message: data.message,
    };
  }, [bandFilteredRows, clientBandFiltering, data, filters.page, filters.pageSize]);

  return {
    data,
    loading,
    error,
    reload,
    tables: view.tables,
    rows: view.rows,
    pagination: view.pagination,
    totals: view.totals,
    message: view.message,
    bandFilteredTotal: bandFilteredRows.length,
  };
}
