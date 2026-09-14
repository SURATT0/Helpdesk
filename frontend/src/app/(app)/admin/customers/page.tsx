"use client";

import { CustomersAdminView } from "@/features/admin-customers/components/customers-admin-view";

/**
 * The list with nothing selected.
 *
 * On a phone this IS the page; on a desktop the detail pane invites a choice.
 * Two routes rather than one with a query parameter, so a customer can be linked
 * to and reloaded onto — see the view.
 */
export default function AdminCustomersPage() {
  return <CustomersAdminView selectedId={null} />;
}
