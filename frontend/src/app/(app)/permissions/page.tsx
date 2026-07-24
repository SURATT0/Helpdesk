import { Topbar } from "@/components/layout/topbar";
import { PermissionsView } from "@/features/permissions/permissions-view";

export default function PermissionsPage() {
  return (
    <>
      <Topbar titleKey="nav.permissions" showSearch={false} />
      <main className="flex-1 overflow-y-auto">
        <PermissionsView />
      </main>
    </>
  );
}
