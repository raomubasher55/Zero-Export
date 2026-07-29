import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingScreen, Toast } from "@/components/common/Feedback";
import { DeviceDialog } from "@/features/devices/DeviceDialog";
import { ProfileDialog } from "@/features/profiles/ProfileDialog";
import { useOperationsData } from "@/hooks/useOperationsData";
import { api } from "@/lib/api";
import { DashboardPage } from "@/pages/DashboardPage";
import { DeviceMonitorPage } from "@/pages/DeviceMonitorPage";
import { DevicesPage } from "@/pages/DevicesPage";
import { GatewayPage } from "@/pages/GatewayPage";
import { ProfilesPage } from "@/pages/ProfilesPage";

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [deviceDialog, setDeviceDialog] = useState({
    open: false,
    device: null,
  });
  const [profileDialog, setProfileDialog] = useState({
    open: false,
    profile: null,
  });
  const data = useOperationsData();

  const createDevice = () => setDeviceDialog({ open: true, device: null });
  const editDevice = (device) => setDeviceDialog({ open: true, device });
  const createProfile = () => setProfileDialog({ open: true, profile: null });
  const editProfile = (profile) => setProfileDialog({ open: true, profile });

  const saveDevice = async (payload, device) => {
    await data.perform(
      () =>
        device
          ? api.updateDevice(device._id, payload)
          : api.createDevice(payload),
      device ? "Device configuration saved." : "Device created.",
    );
  };

  const saveProfile = async (payload, profile) => {
    await data.perform(
      () =>
        profile
          ? api.updateRegisterProfile(profile._id, payload)
          : api.createRegisterProfile(payload),
      profile ? "Register profile saved." : "Register profile created.",
    );
  };

  const deleteDevice = async (device) => {
    if (
      !window.confirm(
        `Delete “${device.name}”? This also releases its active connection.`,
      )
    )
      return;
    await data.perform(() => api.deleteDevice(device._id), "Device deleted.");
    if (location.pathname === `/devices/${device._id}`) navigate("/devices");
  };

  const deleteProfile = async (profile) => {
    if (
      !window.confirm(
        `Delete “${profile.name}”? Profiles assigned to devices cannot be deleted.`,
      )
    )
      return;
    await data.perform(
      () => api.deleteRegisterProfile(profile._id),
      "Register profile deleted.",
    );
  };

  return (
    <AppShell
      health={data.health}
      scheduler={data.scheduler}
      refreshing={data.refreshing}
      onRefresh={() => data.refresh()}
    >
      {data.backendError && (
        <div className="mb-6 flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>Backend connection unavailable.</strong> {data.backendError}{" "}
            Start the API and MongoDB, then refresh this dashboard.
          </div>
        </div>
      )}

      {data.loading ? (
        <LoadingScreen />
      ) : (
        <Routes>
          <Route
            path="/"
            element={<DashboardPage data={data} onCreateDevice={createDevice} />}
          />
          <Route
            path="/devices"
            element={
              <DevicesPage
                data={data}
                onCreateDevice={createDevice}
                onEditDevice={editDevice}
                onDeleteDevice={deleteDevice}
              />
            }
          />
          <Route path="/devices/:deviceId" element={<DeviceMonitorPage data={data} />} />
          <Route
            path="/profiles"
            element={
              <ProfilesPage
                data={data}
                onCreateProfile={createProfile}
                onEditProfile={editProfile}
                onDeleteProfile={deleteProfile}
              />
            }
          />
          <Route path="/gateway" element={<GatewayPage data={data} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}

      <DeviceDialog
        open={deviceDialog.open}
        onOpenChange={(open) =>
          setDeviceDialog((current) => ({ ...current, open }))
        }
        device={deviceDialog.device}
        profiles={data.profiles}
        onSave={saveDevice}
      />
      <ProfileDialog
        open={profileDialog.open}
        onOpenChange={(open) =>
          setProfileDialog((current) => ({ ...current, open }))
        }
        profile={profileDialog.profile}
        onSave={saveProfile}
      />
      {data.toast && (
        <Toast toast={data.toast} onClose={() => data.setToast(null)} />
      )}
    </AppShell>
  );
}

export default App;
