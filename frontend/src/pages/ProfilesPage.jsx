import { useMemo } from "react";
import { ProfilesView } from "@/features/profiles/ProfilesView";

export function ProfilesPage({
  data,
  onCreateProfile,
  onEditProfile,
  onDeleteProfile,
  onImportProfiles,
  onExportProfiles,
  onRestoreBuiltins,
  onForwardProfile,
}) {
  const forwardCounts = useMemo(() => {
    const counts = new Map();
    for (const device of data.devices || []) {
      const profileId = String(device.registerProfile?._id || "");
      if (profileId) {
        counts.set(profileId, (counts.get(profileId) || 0) + 1);
      }
    }
    return counts;
  }, [data.devices]);

  return (
    <ProfilesView
      profiles={data.profiles}
      onCreate={onCreateProfile}
      onEdit={onEditProfile}
      onDelete={onDeleteProfile}
      onImport={onImportProfiles}
      onExport={onExportProfiles}
      onRestoreBuiltins={onRestoreBuiltins}
      onForward={onForwardProfile}
      forwardCounts={forwardCounts}
    />
  );
}
