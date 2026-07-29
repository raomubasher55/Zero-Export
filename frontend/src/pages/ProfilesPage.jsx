import { ProfilesView } from "@/features/profiles/ProfilesView";

export function ProfilesPage({ data, onCreateProfile, onEditProfile, onDeleteProfile }) {
  return (
    <ProfilesView
      profiles={data.profiles}
      onCreate={onCreateProfile}
      onEdit={onEditProfile}
      onDelete={onDeleteProfile}
    />
  );
}
