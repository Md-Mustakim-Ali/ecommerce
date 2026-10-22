import type { Metadata } from "next";
import { requirePlatformPermission } from "@/lib/auth/access";
import { getPlatformSettings } from "@/lib/settings";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  await requirePlatformPermission("platform.settings.manage");
  const settings = await getPlatformSettings();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Applied to new orders. Nothing here restates what a past order earned.
        </p>
      </div>

      <SettingsForm settings={settings} />
    </div>
  );
}
