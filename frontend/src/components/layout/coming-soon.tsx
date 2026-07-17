"use client";

import { useI18n } from "@/features/i18n/context";
import { Topbar } from "./topbar";

export function ComingSoon({ titleKey }: { titleKey: string }) {
  const { t } = useI18n();
  return (
    <>
      <Topbar titleKey={titleKey} showSearch={false} />
      <main className="grid flex-1 place-items-center p-6">
        <div className="text-center">
          <div className="text-[15px] font-semibold text-ink">
            {t(titleKey)}
          </div>
          <div className="mt-1 text-[13px] text-faint">{t("comingSoon.body")}</div>
        </div>
      </main>
    </>
  );
}
