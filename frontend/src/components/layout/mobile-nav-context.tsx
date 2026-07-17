"use client";

import * as React from "react";

/**
 * Drives the mobile off-canvas sidebar: the Topbar hamburger toggles it, the
 * Sidebar renders as a slide-in drawer + backdrop when open. On `lg+` the
 * sidebar is static and this state is unused.
 */
type MobileNavValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

const MobileNavContext = React.createContext<MobileNavValue | null>(null);

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const toggle = React.useCallback(() => setOpen((o) => !o), []);
  const value = React.useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);
  return (
    <MobileNavContext.Provider value={value}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav(): MobileNavValue {
  const ctx = React.useContext(MobileNavContext);
  if (!ctx) throw new Error("useMobileNav must be used within MobileNavProvider");
  return ctx;
}
