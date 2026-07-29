import { ProfilesView } from "@/features/profiles/ProfilesView";

export function ProfilesPage({
  data,
  onCreateProfile,
  onEditProfile,
  onDeleteProfile,
  onImportProfiles,
  onExportProfiles,
}) {
  return (
    <ProfilesView
      profiles={data.profiles}
      onCreate={onCreateProfile}
      onEdit={onEditProfile}
      onDelete={onDeleteProfile}
      onImport={onImportProfiles}
      onExport={onExportProfiles}
    />
  );
}
