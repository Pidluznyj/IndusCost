import { useEffect, useState } from "react";
import { fetchPerformanceFeatureStatus } from "@/src/lib/hrPerformance/performanceClient";

let cached: Promise<boolean> | null = null;

export function loadPerformanceFeature(): Promise<boolean> {
  if (!cached) {
    cached = fetchPerformanceFeatureStatus()
      .then((status) => status.enabled === true)
      .catch(() => {
        cached = null;
        return false;
      });
  }
  return cached;
}

export function usePerformanceFeature(active = true): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void loadPerformanceFeature().then((value) => alive && setEnabled(value));
    return () => {
      alive = false;
    };
  }, [active]);
  return active ? enabled : false;
}
