"use client";

import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";

function greetingKey(hour: number): string {
  if (hour < 12) return "greeting.morning";
  if (hour < 18) return "greeting.afternoon";
  return "greeting.evening";
}

export function DashboardGreeting() {
  const { user } = useAuth();
  const { t, lang } = useI18n();

  const now = new Date();
  const firstName = user?.name?.split(" ")[0] ?? "";
  const date = now.toLocaleDateString(lang === "th" ? "th-TH" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex items-baseline gap-3">
      <h1 className="text-[20px] font-bold tracking-[-0.01em] text-ink">
        {t(greetingKey(now.getHours()))}
        {firstName ? `, ${firstName}` : ""}
      </h1>
      <span className="text-[13px] text-faint">{date}</span>
    </div>
  );
}
