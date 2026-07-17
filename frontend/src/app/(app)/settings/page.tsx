import { Topbar } from "@/components/layout/topbar";
import { SettingsView } from "@/features/settings/settings-view";

export default function SettingsPage() {
  return (
    <>
      <Topbar titleKey="nav.settings" showSearch={false} />
      <main className="flex-1 overflow-y-auto">
        <SettingsView />
      </main>
    </>
  );
}
