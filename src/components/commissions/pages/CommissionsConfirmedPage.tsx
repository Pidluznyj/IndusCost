import React from "react";
import { CommissionsRecordsPage } from "@/src/components/commissions/pages/CommissionsRecordsPage";

export function CommissionsConfirmedPage() {
  return (
    <CommissionsRecordsPage
      title="Comissões confirmadas"
      description="Comissões confirmadas por documento de saída, aguardando recebimento ou liberação."
      apiPath="/api/commissions/confirmed"
      emptyTitle="Nenhuma comissão confirmada"
      emptyDescription="Não há comissões confirmadas no período."
      testId="commissions-confirmed-page"
    />
  );
}
