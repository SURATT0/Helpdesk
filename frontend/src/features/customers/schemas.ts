import { z } from "zod";

/**
 * A tenant, as a picker needs it. Name and id only — the list is scoped
 * server-side to the customers the caller reaches, so it is safe to show
 * whole but never contains more than that.
 */
export const customerSchema = z.object({
  id: z.number(),
  name: z.string(),
});

export const customerListSchema = z.object({ data: z.array(customerSchema) });

export type Customer = z.infer<typeof customerSchema>;
