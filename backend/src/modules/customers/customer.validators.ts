import { z } from "zod";

export const customerIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * A tenant name. Trimmed and bounded: it appears on invoices, in emailed
 * subject lines and in the audit trail, so it has to be a name rather than a
 * paragraph, and leading whitespace must not make two of them look distinct.
 */
const customerName = z.string().trim().min(1).max(120);

export const createCustomerBody = z.object({ name: customerName });
export const renameCustomerBody = z.object({ name: customerName });
