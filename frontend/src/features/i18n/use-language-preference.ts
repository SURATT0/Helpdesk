"use client";

import * as React from "react";
import { useAuth } from "@/features/auth/context";
import { useUpdateMyProfile } from "@/features/users/queries";
import { useI18n } from "./context";
import type { Lang } from "./dictionary";

/**
 * Changing the language, everywhere it can be changed.
 *
 * The choice lives in two places on purpose and they answer different
 * questions. `localStorage` remembers what THIS BROWSER was last set to, which
 * is all there is to go on before anyone has signed in — the login screen has a
 * toggle and nobody to attribute it to. `users.language` remembers what THIS
 * PERSON reads, which is the one the server needs, because the mail it sends
 * them is composed hours later by a background sweep with no browser anywhere
 * in sight.
 *
 * So a signed-in change writes both: the local copy keeps the next first paint
 * right, and the stored copy is what their email arrives in.
 *
 * The server write is deliberately not awaited and its failure is deliberately
 * not surfaced. Switching language is an instant, obvious, trivially repeatable
 * action; blocking the UI on a round trip would make it feel broken, and an
 * error toast for a preference nobody has lost is noise.
 */
export function useLanguagePreference(): {
  lang: Lang;
  setLanguage: (next: Lang) => void;
} {
  const { lang, setLang } = useI18n();
  const { user, patchUser } = useAuth();
  const update = useUpdateMyProfile();

  const setLanguage = React.useCallback(
    (next: Lang) => {
      setLang(next);
      if (!user || user.language === next) return;
      // Patch the session copy first so a re-render (and the sync below) sees
      // the new value rather than briefly snapping back to the stored one.
      patchUser({ language: next });
      update.mutate({ language: next });
    },
    [setLang, user, patchUser, update],
  );

  return { lang, setLanguage };
}

/**
 * Adopt the signed-in person's stored language.
 *
 * Mounted inside the auth provider, because the language provider sits ABOVE it
 * — the toggle on the login screen has to work before there is a session, so the
 * provider order cannot be reversed. This is the seam that lets the stored
 * preference win once we know whose browser this is: sign in on a colleague's
 * machine and you get your language, not theirs.
 */
export function LanguageSync(): null {
  const { user } = useAuth();
  const { lang, setLang } = useI18n();
  const stored = user?.language;

  React.useEffect(() => {
    if (stored && stored !== lang) setLang(stored);
  }, [stored, lang, setLang]);

  return null;
}
