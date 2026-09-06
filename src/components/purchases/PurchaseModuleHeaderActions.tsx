import React from "react";
import { ModuleIndicatorsButton } from "@/src/components/contextual/ModuleIndicatorsButton";
import { PurchaseIndusCostRequestsMenuButton } from "@/src/components/purchases/PurchaseIndusCostRequestsMenuButton";

export function PurchaseModuleHeaderActions() {
  return (
    <>
      <ModuleIndicatorsButton to="/purchases/indicators" />
      <PurchaseIndusCostRequestsMenuButton />
    </>
  );
}
