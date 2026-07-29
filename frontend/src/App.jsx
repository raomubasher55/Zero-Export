import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingScreen, Toast } from "@/components/common/Feedback";
import { Dashboard } from "@/features/dashboard/Dashboard";
import { DeviceDialog } from "@/features/devices/DeviceDialog";
import { DeviceMonitor } from "@/features/devices/DeviceMonitor";
import { DevicesView } from "@/features/devices/DevicesView";
import { ProfileDialog } from "@/features/profiles/ProfileDialog";
import { ProfilesView } from "@/features/profiles/ProfilesView";
import { useOperationsData } from "@/hooks/useOperationsData";
import { api } from "@/lib/api";

function App() {
  const [activeView, setActiveView] = useState("dashboard");
  const [deviceDialog, setDeviceDialog] = useState({
    open: false,
    device: null,
  });
  const [profileDialog, setProfileDialog] = useState({
    open: false,
    profile: null,
  });
  const [monitorDevice, setMonitorDevice] = useState(null);
  const data = useOperationsData();

  const navigate = (view) => {
    setActiveView(view);
    setMonitorDevice(null);
  };

  const openMonitor = (device) => {
    setMonitorDevice(device);
    setActiveView("monitor");
  };

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
    if (monitorDevice?._id === device._id) navigate("devices");
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

  const currentMonitorDevice = monitorDevice
    ? data.devices.find((device) => device._id === monitorDevice._id) ||
      monitorDevice
    : null;

  return (
    <AppShell
      activeView={activeView}
      onNavigate={navigate}
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
        <>
          {activeView === "dashboard" && (
            <Dashboard
              stats={data.stats}
              devices={data.devices}
              scheduler={data.scheduler}
              onOpenDevice={openMonitor}
              onCreate={() => setDeviceDialog({ open: true, device: null })}
            />
          )}
          {activeView === "devices" && (
            <DevicesView
              devices={data.filteredDevices}
              profiles={data.profiles}
              search={data.deviceSearch}
              onSearch={data.setDeviceSearch}
              onCreate={() => setDeviceDialog({ open: true, device: null })}
              onEdit={(device) => setDeviceDialog({ open: true, device })}
              onDelete={deleteDevice}
              onOpen={openMonitor}
              onConnect={(device) =>
                data.perform(
                  () => api.connectDevice(device._id),
                  `${device.name} connected.`,
                )
              }
              onPoll={(device) =>
                data.perform(
                  () => api.pollDevice(device._id),
                  `${device.name} poll completed.`,
                )
              }
            />
          )}
          {activeView === "profiles" && (
            <ProfilesView
              profiles={data.profiles}
              onCreate={() => setProfileDialog({ open: true, profile: null })}
              onEdit={(profile) => setProfileDialog({ open: true, profile })}
              onDelete={deleteProfile}
            />
          )}
          {activeView === "monitor" && currentMonitorDevice && (
            <DeviceMonitor
              device={currentMonitorDevice}
              onBack={() => navigate("devices")}
              onRefresh={data.refresh}
              notify={data.notify}
            />
          )}
        </>
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
