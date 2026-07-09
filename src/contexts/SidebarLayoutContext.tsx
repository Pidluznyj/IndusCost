import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  persistSidebarCollapsed,
  readStoredSidebarCollapsed,
  SIDEBAR_MOBILE_MEDIA_QUERY,
} from "@/src/lib/sidebarLayout";

export type SidebarLayoutContextValue = {
  desktopCollapsed: boolean;
  mobileOpen: boolean;
  isMobile: boolean;
  toggleDesktopCollapsed: () => void;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  toggleMobileSidebar: () => void;
};

const SidebarLayoutContext = createContext<SidebarLayoutContextValue | null>(null);

export function SidebarLayoutProvider({ children }: { children: ReactNode }) {
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => readStoredSidebarCollapsed());
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(SIDEBAR_MOBILE_MEDIA_QUERY);
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!isMobile) setMobileOpen(false);
  }, [isMobile]);

  const toggleDesktopCollapsed = useCallback(() => {
    setDesktopCollapsed((current) => {
      const next = !current;
      persistSidebarCollapsed(next);
      return next;
    });
  }, []);

  const openMobileSidebar = useCallback(() => setMobileOpen(true), []);
  const closeMobileSidebar = useCallback(() => setMobileOpen(false), []);
  const toggleMobileSidebar = useCallback(() => setMobileOpen((current) => !current), []);

  const value = useMemo<SidebarLayoutContextValue>(
    () => ({
      desktopCollapsed,
      mobileOpen,
      isMobile,
      toggleDesktopCollapsed,
      openMobileSidebar,
      closeMobileSidebar,
      toggleMobileSidebar,
    }),
    [
      desktopCollapsed,
      mobileOpen,
      isMobile,
      toggleDesktopCollapsed,
      openMobileSidebar,
      closeMobileSidebar,
      toggleMobileSidebar,
    ]
  );

  return (
    <SidebarLayoutContext.Provider value={value}>{children}</SidebarLayoutContext.Provider>
  );
}

export function useSidebarLayout(): SidebarLayoutContextValue {
  const context = useContext(SidebarLayoutContext);
  if (!context) {
    throw new Error("useSidebarLayout deve ser usado dentro de SidebarLayoutProvider.");
  }
  return context;
}
