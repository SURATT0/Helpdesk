import type { AuthUser } from "../shared/auth";

// Augment Express's Request with the authenticated principal set by requireAuth.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
