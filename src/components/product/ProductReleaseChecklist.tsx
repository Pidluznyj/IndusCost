/**
 * Checklist visual de liberação do produto.
 *
 * Lê o action plan já existente (read-only) e mostra um checklist guiado
 * para a Engenharia ver, sem entender enums técnicos, se o produto está
 * pronto para ser liberado para custeio.
 */
import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Loader2,
  ShieldAlert,
  ShieldOff,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchEngineeringEqualizationActionPlan } from "@/src/lib/nomusEngineeringEqualizationActionPlanClient";
import type { EngineeringEqualizationActionPlanResult } from "@/src/lib/nomusEngineeringEqualizationActionPlanTypes";

type CheckStatus = "OK" | "ATTENTION" | "BLOCKED" | "NOT_APPLICABLE" | "PENDING";

type ChecklistItem = {
  key: string;
  label: string;
  status: CheckStatus;
  message: string;
};

function statusIcon(status: CheckStatus) {
  switch (status) {
    case "OK":
      return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    case "ATTENTION":
      return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    case "BLOCKED":
      return <ShieldAlert className="h-4 w-4 text-red-600" />;
    case "NOT_APPLICABLE":
      return <ShieldOff className="h-4 w-4 text-muted-foreground" />;
    case "PENDING":
      return <CircleDashed className="h-4 w-4 text-sky-600" />;
  }
}

function statusLabel(status: CheckStatus): string {
  switch (status) {
    case "OK":
      return "OK";
    case "ATTENTION":
      return "Atenção";
    case "BLOCKED":
      return "Bloqueado";
    case "NOT_APPLICABLE":
      return "Não aplicável";
    case "PENDING":
      return "Pendente";
  }
}

function statusTone(status: CheckStatus): string {
  switch (status) {
    case "OK":
      return "bg-emerald-100 text-emerald-900";
    case "ATTENTION":
      return "bg-amber-100 text-amber-900";
    case "BLOCKED":
      return "bg-red-100 text-red-900";
    case "NOT_APPLICABLE":
      return "bg-muted text-muted-foreground";
    case "PENDING":
      return "bg-sky-100 text-sky-900";
  }
}

function buildChecklist(plan: EngineeringEqualizationActionPlanResult): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  // 1. Cadastro existe no IndusCost
  items.push({
    key: "product_exists",
    label: "Cadastro existe no IndusCost",
    status: plan.existsInIndusCost ? "OK" : "BLOCKED",
    message: plan.existsInIndusCost
      ? `Product ${plan.product.productSku ?? plan.parentCode} cadastrado.`
      : "Produto novo no Nomus — abrir Importação do produto.",
  });

  // 2. Cadastro mestre alinhado
  const isControlledByNomus =
    plan.product.costingMode != null &&
    (plan.product.productSku ?? "").trim().length > 0 &&
    plan.existsInIndusCost;
  if (!plan.existsInIndusCost) {
    items.push({
      key: "master_aligned",
      label: "Cadastro mestre alinhado com o Nomus",
      status: "NOT_APPLICABLE",
      message: "Aguardando importação do cadastro mestre.",
    });
  } else {
    items.push({
      key: "master_aligned",
      label: "Cadastro mestre alinhado com o Nomus",
      status: isControlledByNomus ? "OK" : "ATTENTION",
      message: isControlledByNomus
        ? "Cadastro mestre OK (Product cadastrado no IndusCost)."
        : "Verifique se o produto está marcado como Nomus (Igualar bases pode regularizar).",
    });
  }

  // 3. Materiais / componentes existem
  const missingMat = plan.applyPreviewSummary?.actionClass === "BLOCKED_MISSING_NOMUS_COMPONENT";
  items.push({
    key: "components_exist",
    label: "Materiais e componentes existem",
    status: missingMat ? "BLOCKED" : "OK",
    message: missingMat
      ? "Há componentes Nomus sem Material/Product. Rode Carga Mestre Nomus."
      : "Todos os componentes Nomus estão cadastrados.",
  });

  // 4. Opcionais tratados
  const optionalPending = plan.optionalSummary.hasOptionalPending;
  items.push({
    key: "optional_handled",
    label: "Opcionais tratados",
    status: optionalPending ? "ATTENTION" : "OK",
    message: optionalPending
      ? "Há opcionais pendentes. Abrir aba Opcionais de Precificação."
      : "Sem opcionais pendentes neste produto.",
  });

  // 5. BOM efetiva sem bloqueio
  const bomBlocked = plan.applyPreviewSummary?.isBlocked === true;
  items.push({
    key: "effective_bom_ok",
    label: "BOM efetiva sem bloqueio",
    status: bomBlocked ? "BLOCKED" : "OK",
    message: bomBlocked
      ? "BOM efetiva bloqueada — abrir Diagnóstico técnico."
      : "BOM efetiva pronta para preview/aplicação.",
  });

  // 6. Impacto de custo revisado
  if (plan.costImpactSummary) {
    const hasStructural = plan.costImpactSummary.hasStructuralChanges;
    items.push({
      key: "cost_impact",
      label: "Impacto de custo revisado",
      status: hasStructural ? "ATTENTION" : "OK",
      message: hasStructural
        ? "Há mudanças estruturais — confira o delta no painel Impacto de Custo."
        : "Sem mudanças estruturais — delta esperado zero.",
    });
  } else {
    items.push({
      key: "cost_impact",
      label: "Impacto de custo revisado",
      status: "PENDING",
      message: "Impacto de custo ainda não foi calculado para este produto.",
    });
  }

  // 7. BOM aplicada ou sem ação necessária
  const readiness = plan.readiness;
  let bomAppliedStatus: CheckStatus = "PENDING";
  let bomAppliedMessage = "Revisar plano de aplicação.";
  if (readiness === "NO_ACTION_REQUIRED") {
    bomAppliedStatus = "OK";
    bomAppliedMessage = "Nenhuma ação necessária — ProductBOM já reflete a BOM efetiva.";
  } else if (readiness === "READY_FOR_CONTROLLED_APPLY") {
    bomAppliedStatus = "ATTENTION";
    bomAppliedMessage = "Pronto para aplicação controlada — abrir aba Plano de aplicação.";
  } else if (readiness === "READY_FOR_MANUAL_REVIEW") {
    bomAppliedStatus = "ATTENTION";
    bomAppliedMessage = "Pronto para revisão manual — abrir BOM efetiva.";
  } else if (
    readiness === "BLOCKED" ||
    readiness === "NEEDS_MATERIAL_MAPPING" ||
    readiness === "NEEDS_CHILD_PRODUCT_IMPORT" ||
    readiness === "NEEDS_OPTIONAL_SELECTION" ||
    readiness === "NEEDS_PRODUCT_IMPORT"
  ) {
    bomAppliedStatus = "BLOCKED";
    bomAppliedMessage = "Bloqueado — resolver pendências antes de aplicar a BOM.";
  } else if (readiness === "NEEDS_ENGINEERING_REVIEW") {
    bomAppliedStatus = "ATTENTION";
    bomAppliedMessage = "Precisa revisão da Engenharia (caso ambíguo).";
  } else if (readiness === "ERROR") {
    bomAppliedStatus = "BLOCKED";
    bomAppliedMessage = "Erro ao gerar plano — abrir Diagnóstico técnico.";
  }
  items.push({
    key: "bom_applied",
    label: "BOM aplicada ou sem ação necessária",
    status: bomAppliedStatus,
    message: bomAppliedMessage,
  });

  // 8. Histórico registrado — o checklist não tem acesso direto, mas o action plan
  //    sabe se há `EngineeringChangeLog` para o produto via aba Histórico. Aqui
  //    usamos uma heurística: se o produto existe e está cadastrado, considerar
  //    "registrado" como PENDING até a aba Histórico ser aberta.
  items.push({
    key: "history_logged",
    label: "Histórico registrado",
    status: plan.existsInIndusCost ? "PENDING" : "NOT_APPLICABLE",
    message: plan.existsInIndusCost
      ? "Abra a aba Histórico do produto para conferir as alterações."
      : "Sem histórico — produto ainda não cadastrado.",
  });

  return items;
}

export const ProductReleaseChecklist: React.FC<{ parentCode: string | null | undefined }> = ({
  parentCode,
}) => {
  const [plan, setPlan] = useState<EngineeringEqualizationActionPlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!parentCode || !parentCode.trim()) {
      setPlan(null);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchEngineeringEqualizationActionPlan(
      { parentCode, includeCostImpact: true, includeApplyPreview: true },
      { signal: controller.signal }
    )
      .then((res) => {
        if (cancelled) return;
        setPlan(res);
      })
      .catch((e) => {
        if (cancelled || controller.signal.aborted) return;
        setError(
          e instanceof Error
            ? `${e.message} Tente recarregar a tela.`
            : "Erro ao montar checklist do produto."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [parentCode]);

  if (!parentCode || !parentCode.trim()) {
    return null;
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase font-bold text-primary">
          Checklist de liberação para custeio
        </p>
        {plan ? (
          <span className="text-[10px] text-muted-foreground">
            Readiness: <strong>{plan.readinessLabel}</strong>
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          Calculando checklist…
        </p>
      ) : null}

      {error ? (
        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 flex items-start gap-2">
          <CircleHelp className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {plan ? (
        <ul className="space-y-1.5">
          {buildChecklist(plan).map((item, idx) => (
            <li key={item.key} className="flex items-start gap-2">
              <span className="mt-0.5">{statusIcon(item.status)}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">
                    {idx + 1}. {item.label}
                  </span>
                  <span
                    className={cn(
                      "inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                      statusTone(item.status)
                    )}
                  >
                    {statusLabel(item.status)}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-tight">{item.message}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {plan && plan.blockers.length > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-900">
          <p className="font-bold">Bloqueios deste produto</p>
          <ul className="mt-0.5 space-y-0 list-disc list-inside">
            {plan.blockers.slice(0, 5).map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};
