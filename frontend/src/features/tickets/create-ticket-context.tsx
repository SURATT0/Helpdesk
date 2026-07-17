"use client";

import * as React from "react";
import { CreateTicketModal } from "./components/create-ticket-modal";

type Ctx = { open: () => void; close: () => void; isOpen: boolean };

const CreateTicketContext = React.createContext<Ctx | null>(null);

export function CreateTicketProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const value = React.useMemo<Ctx>(
    () => ({
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      isOpen,
    }),
    [isOpen],
  );

  return (
    <CreateTicketContext.Provider value={value}>
      {children}
      <CreateTicketModal open={isOpen} onClose={() => setIsOpen(false)} />
    </CreateTicketContext.Provider>
  );
}

export function useCreateTicket(): Ctx {
  const ctx = React.useContext(CreateTicketContext);
  if (!ctx)
    throw new Error("useCreateTicket must be used within CreateTicketProvider");
  return ctx;
}
