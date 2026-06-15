import React, { useEffect, useState } from "react";
import { Beaker, Box, Loader2, Package, Puzzle } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { PROJECT_GUIDED_MASTER_NOTICE } from "@/src/lib/projectsGuidedFlow";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";

export type ProjectAddItemKind =
  | "OFFICIAL_PRODUCT"
  | "OFFICIAL_COMPONENT"
  | "SIMULATION";

type ProductLookupRow = { id: string; sku: string; name: string };

type SimulationLookupRow = {
  id: string;
  name: string;
  productName: string;
  productSku: string | null;
  unitCost: number | null;
};

type Props = {
  open: boolean;
  projectId: string;
  projectLabel: string;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onAdded: () => Promise<void>;
};

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const KIND_OPTIONS: {
  id: ProjectAddItemKind;
  title: string;
  description: string;
  icon: typeof Package;
}[] = [
  {
    id: "OFFICIAL_PRODUCT",
    title: "Produto oficial",
    description: "Selecione um produto do cadastro oficial de engenharia.",
    icon: Package,
  },
  {
    id: "OFFICIAL_COMPONENT",
    title: "Componente oficial",
    description: "Selecione um componente/subproduto do cadastro oficial.",
    icon: Puzzle,
  },
  {
    id: "SIMULATION",
    title: "Produto simulado",
    description: "Selecione uma simulação salva em Simulações → Simular novo produto.",
    icon: Beaker,
  },
];

export function ProjectAddItemModal({
  open,
  projectId,
  projectLabel,
  saving,
  error,
  onClose,
  onAdded,
}: Props) {
  const [kind, setKind] = useState<ProjectAddItemKind | null>(null);
  const [search, setSearch] = useState("");
  const [productRows, setProductRows] = useState<ProductLookupRow[]>([]);
  const [simulationRows, setSimulationRows] = useState<SimulationLookupRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedSimulationId, setSelectedSimulationId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(null);
    setSearch("");
    setProductRows([]);
    setSimulationRows([]);
    setSelectedProductId("");
    setSelectedSimulationId("");
    setLocalError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !kind) return;
    const q = search.trim();
    if (q.length < 2) {
      setProductRows([]);
      setSimulationRows([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        if (kind === "SIMULATION") {
          const res = await fetchJsonOk<{ rows: SimulationLookupRow[] }>(
            `/api/projects/lookup/simulations?q=${encodeURIComponent(q)}`
          );
          setSimulationRows(res.rows ?? []);
        } else {
          const res = await fetchJsonOk<{ rows: ProductLookupRow[] }>(
            `/api/projects/lookup/products?q=${encodeURIComponent(q)}`
          );
          setProductRows(res.rows ?? []);
        }
      } catch {
        setProductRows([]);
        setSimulationRows([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, kind, search]);

  if (!open) return null;

  const displayError = localError ?? error;
  const busy = saving || submitting;

  const handleSubmit = async () => {
    setLocalError(null);
    setSubmitting(true);
    try {
      if (kind === "OFFICIAL_PRODUCT" || kind === "OFFICIAL_COMPONENT") {
        if (!selectedProductId) {
          setLocalError("Selecione um item oficial.");
          return;
        }
        await fetchJsonOk(`/api/projects/${projectId}/import-product-snapshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: selectedProductId,
            includeBom: true,
            includeRouting: kind === "OFFICIAL_PRODUCT",
            replaceExisting: false,
          }),
        });
      } else if (kind === "SIMULATION") {
        if (!selectedSimulationId) {
          setLocalError("Selecione uma simulação.");
          return;
        }
        await fetchJsonOk(`/api/projects/${projectId}/simulation-references`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ simulationId: selectedSimulationId }),
        });
      }
      await onAdded();
      onClose();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Erro ao adicionar item.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ProjectModalShell
      title="Adicionar item ao projeto"
      subtitle={projectLabel}
      onClose={onClose}
      wide
    >
      <p className="mb-4 text-xs text-muted-foreground">{PROJECT_GUIDED_MASTER_NOTICE}</p>

      {!kind ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {KIND_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                className="flex flex-col rounded-xl border border-border bg-card p-4 text-left hover:border-primary/40 hover:bg-muted/30"
                onClick={() => setKind(opt.id)}
              >
                <Icon className="mb-2 h-5 w-5 text-primary" />
                <span className="font-medium">{opt.title}</span>
                <span className="mt-1 text-sm text-muted-foreground">{opt.description}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={() => {
              setKind(null);
              setSearch("");
              setSelectedProductId("");
              setSelectedSimulationId("");
            }}
          >
            ← Voltar
          </button>

          <p className="text-sm font-medium">
            {KIND_OPTIONS.find((k) => k.id === kind)?.title}
          </p>

          <input
            type="search"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder={
              kind === "SIMULATION"
                ? "Buscar simulação por nome ou produto..."
                : "Buscar por SKU ou nome..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {searching ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando...
            </div>
          ) : null}

          {kind === "SIMULATION" ? (
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border">
              {simulationRows.length === 0 && search.trim().length >= 2 ? (
                <li className="px-3 py-4 text-sm text-muted-foreground">Nenhuma simulação encontrada.</li>
              ) : null}
              {simulationRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted/50 ${
                      selectedSimulationId === row.id ? "bg-primary/10" : ""
                    }`}
                    onClick={() => setSelectedSimulationId(row.id)}
                  >
                    <span className="font-medium">{row.productName}</span>
                    <span className="text-muted-foreground">
                      {row.name}
                      {row.productSku ? ` · ${row.productSku}` : ""}
                      {" · "}
                      {formatMoney(row.unitCost)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border">
              {productRows.length === 0 && search.trim().length >= 2 ? (
                <li className="px-3 py-4 text-sm text-muted-foreground">Nenhum produto encontrado.</li>
              ) : null}
              {productRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 ${
                      selectedProductId === row.id ? "bg-primary/10" : ""
                    }`}
                    onClick={() => setSelectedProductId(row.id)}
                  >
                    <span>
                      <span className="font-medium">{row.sku}</span>
                      <span className="text-muted-foreground"> — {row.name}</span>
                    </span>
                    <Box className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {displayError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {displayError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-lg border px-4 py-2 text-sm" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
              onClick={() => void handleSubmit()}
            >
              {busy ? "Adicionando..." : "Adicionar ao projeto"}
            </button>
          </div>
        </div>
      )}
    </ProjectModalShell>
  );
}
