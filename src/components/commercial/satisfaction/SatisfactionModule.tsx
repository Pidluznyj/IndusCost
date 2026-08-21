/**
 * Comercial → Satisfação. Shell com as duas abas do módulo: Dashboard e
 * Pesquisas. Rotas internas (resultados, convites, resposta) são páginas
 * próprias, para não transformar o menu principal em dezenas de itens.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/src/contexts/AuthContext.js";
import {
  satisfactionApi,
  type SatisfactionCampaignRow,
} from "./satisfactionApi.js";
import { SatisfactionDashboardPanel } from "./SatisfactionDashboardPanel.js";
import { SatisfactionSurveysPanel } from "./SatisfactionSurveysPanel.js";

type TabId = "dashboard" | "surveys";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "surveys", label: "Pesquisas" },
];

export function SatisfactionModule() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<TabId>("dashboard");

  const [campaigns, setCampaigns] = useState<SatisfactionCampaignRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await satisfactionApi.listCampaigns({
        page,
        pageSize,
        search: search || null,
        status: status || null,
      });
      setCampaigns(result.rows);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar as pesquisas.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // A visibilidade real é decidida pelo backend; isto só evita oferecer botão
  // que resultaria em 403.
  const canManage = hasPermission("commercial.satisfaction.manage");
  const canPublish = hasPermission("commercial.satisfaction.publish");

  return (
    <div className="space-y-4">
      <div
        className="flex gap-1 border-b border-[#E2E8F0]"
        role="tablist"
        aria-label="Seções de Satisfação"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`-mb-px border-b-2 px-4 py-2 text-[14px] font-semibold transition-colors ${
              tab === entry.id
                ? "border-[#1D4ED8] text-[#1D4ED8]"
                : "border-transparent text-[#64748B] hover:text-[#334155]"
            }`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" ? (
        <SatisfactionDashboardPanel campaigns={campaigns} />
      ) : (
        <SatisfactionSurveysPanel
          campaigns={campaigns}
          total={total}
          page={page}
          pageSize={pageSize}
          loading={loading}
          error={error}
          canManage={canManage}
          canPublish={canPublish}
          onPageChange={setPage}
          onSearch={(nextSearch, nextStatus) => {
            setPage(1);
            setSearch(nextSearch);
            setStatus(nextStatus);
          }}
          onRefresh={() => void load()}
        />
      )}
    </div>
  );
}
