import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

type MarketGlobalIndicatorsRefreshValue = {
  revision: number;
  notifyPersistedRefresh: () => void;
};

const MarketGlobalIndicatorsRefreshContext =
  createContext<MarketGlobalIndicatorsRefreshValue | null>(null);

export function MarketGlobalIndicatorsRefreshProvider({ children }: { children: React.ReactNode }) {
  const [revision, setRevision] = useState(0);
  const notifyPersistedRefresh = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);
  const value = useMemo(
    () => ({ revision, notifyPersistedRefresh }),
    [revision, notifyPersistedRefresh]
  );
  return (
    <MarketGlobalIndicatorsRefreshContext.Provider value={value}>
      {children}
    </MarketGlobalIndicatorsRefreshContext.Provider>
  );
}

export function useMarketGlobalIndicatorsRefresh(): MarketGlobalIndicatorsRefreshValue | null {
  return useContext(MarketGlobalIndicatorsRefreshContext);
}
