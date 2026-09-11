import { redirect } from "next/navigation";

/**
 * The customer list moved under `/admin`, where it now sits beside the projects
 * that belong to each customer.
 *
 * A redirect rather than a deletion: this path is in people's history, their
 * bookmarks and any link somebody pasted into a chat before today. A 404 would
 * make all of those look like the feature was removed.
 *
 * Server-side, so the browser never renders a page only to replace it — and
 * permanent: the old path is not coming back.
 */
export default function CustomersRedirect() {
  redirect("/admin/customers");
}
