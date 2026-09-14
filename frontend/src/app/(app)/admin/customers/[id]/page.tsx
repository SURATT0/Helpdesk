"use client";

import { useParams } from "next/navigation";
import { CustomersAdminView } from "@/features/admin-customers/components/customers-admin-view";

export default function AdminCustomerPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  // A non-numeric id is not a customer. Passed through as null rather than NaN
  // so the view shows the list instead of an empty detail pane.
  return <CustomersAdminView selectedId={Number.isFinite(id) ? id : null} />;
}
