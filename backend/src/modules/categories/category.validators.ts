import { z } from "zod";
import { freeText, TEXT_MAX } from "../../shared/text";

/**
 * Creating a category, which today has exactly one caller: promoting a
 * description somebody typed under "Other" into a category of its own.
 *
 * `code` is accepted but optional. `categoryCode(name)` is the suggestion the
 * form pre-fills, and a person may override it — the whole point of the column
 * is that it survives the name being renamed or translated, so deriving it on
 * every write would defeat it. See category.code.ts.
 */
export const createCategoryBody = z.object({
  name: freeText({ min: 2, max: TEXT_MAX.SUBJECT }),
  /**
   * Which tenant gets the category.
   *
   * Required, and never inferred from the actor. Only platform staff reach this
   * endpoint and they belong to no customer, so there is nothing to infer from —
   * and a promotion is always ABOUT a particular customer's tickets, so the
   * caller already knows which.
   */
  customerId: z.coerce.number().int().positive(),
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    // The shape the backfill and `categoryCode()` both produce. Enforced rather
    // than normalised so a caller who sends something else is told, instead of
    // having their value silently rewritten into one they did not choose.
    .regex(/^[A-Z0-9_]+$/, "A code is upper-case letters, digits and underscores")
    .optional(),
});

/**
 * Listing what people have typed under "Other".
 *
 * `customerId` narrows it to one tenant; without it a platform-wide reader gets
 * every tenant's, which is the view that makes a recurring theme visible in the
 * first place.
 */
export const otherDescriptionsQuery = z.object({
  customerId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
