import cors from "cors";
import { env } from "../../config/env";

/**
 * A SEPARATE, non-credentialed CORS policy for `/api/v1/public/tickets` alone —
 * never added to `env.corsOrigins`, the main API's allow-list, which carries
 * `credentials: true` for the refresh-token cookie.
 *
 * That distinction is the whole point (see the phase-1 compatibility
 * review): the intake form's real deployment serves it from THIS SAME origin
 * (see app.ts's `/intake` static route), where no CORS header is needed at
 * all. `PUBLIC_FORM_ORIGIN` exists only for a form hosted elsewhere. Adding
 * that origin to the credentialed allow-list instead would let it ride the
 * refresh cookie on `credentials: 'include'` requests to every OTHER
 * endpoint too — cookies attach by their own domain scope regardless of
 * CORS, so the credentialed allow-list is what decides whether the browser
 * lets a script on that origin READ the response back, and a public
 * marketing page has no business reading `/api/v1/auth/refresh`'s.
 *
 * No `credentials: true` here at all: this endpoint takes no cookie and
 * needs none — an anonymous POST is exactly what it is for.
 */
export const intakeCors = cors({
  // A function, not a fixed value, so this reads the LIVE setting on every
  // request rather than whatever it was when this module first loaded — the
  // same reason the rate limiters in intake.rate-limit.ts use `limit: () =>`
  // instead of a plain number, and what lets a test flip
  // `env.publicIntake.formOrigin` and see the new behaviour immediately.
  origin: (_origin, callback) => callback(null, env.publicIntake.formOrigin ?? false),
  methods: ["POST"],
});
