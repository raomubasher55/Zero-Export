import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingScreen, Toast } from "@/components/common/Feedback";
import { DeviceDialog } from "@/features/devices/DeviceDialog";
import { ProfileDialog } from "@/features/profiles/ProfileDialog";
import {
  downloadProfileBlob,
  parseProfileFile,
  profileFilename,
} from "@/features/profiles/profileFiles";
import { useOperationsData } from "@/hooks/useOperationsData";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/formatters";
import { DashboardPage } from "@/pages/DashboardPage";
import { DeviceMonitorPage } from "@/pages/DeviceMonitorPage";
import { DevicesPage } from "@/pages/DevicesPage";
import { GatewayPage } from "@/pages/GatewayPage";
import { GatewayTrafficPage } from "@/pages/GatewayTrafficPage";
import { ProfilesPage } from "@/pages/ProfilesPage";
import { SystemPage } from "@/pages/SystemPage";

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

  const exportProfiles = async (profile = null) => {
    try {
      const blob = await api.exportRegisterProfiles(profile?._id);
      downloadProfileBlob(
        blob,
        profile ? profileFilename(profile) : "register-profiles.json",
      );
      data.notify(profile ? `Exported ${profile.name}.` : "Register profiles exported.");
    } catch (exportError) {
      data.notify(getErrorMessage(exportError), "error");
      throw exportError;
    }
  };

  const importProfiles = async (file) => {
    try {
      const document = await parseProfileFile(file);
      const existingIdentifiers = new Set(
        data.profiles.map((profile) => profile.identifier.toLowerCase()),
      );
      const conflicts = document.profiles.filter((profile) =>
        existingIdentifiers.has(String(profile.identifier).toLowerCase()),
      );
      if (
        conflicts.length > 0 &&
        !window.confirm(
          `${conflicts.length} profile identifier(s) already exist and will be updated: ${conflicts
            .map((profile) => profile.identifier)
            .join(", ")}. This immediately affects assigned devices and gateway mappings. Continue?`,
        )
      ) {
        return { cancelled: true };
      }

      const summary = { total: 0, created: 0, updated: 0, skipped: 0 };
      for (const profile of document.profiles) {
        const response = await api.importRegisterProfiles({
          format: document.format,
          version: document.version,
          conflictStrategy: "UPDATE",
          profiles: [profile],
        });
        summary.total += response.data.total;
        summary.created += response.data.created;
        summary.updated += response.data.updated;
        summary.skipped += response.data.skipped;
      }
      await data.refresh();
      data.notify(
        `Imported ${summary.total} profile(s): ${summary.created} created, ${summary.updated} updated.`,
      );
      return summary;
    } catch (importError) {
      data.notify(getErrorMessage(importError), "error");
      throw importError;
    }
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

  const restoreBuiltinProfiles = async () => {
    try {
      const response = await api.restoreBuiltinProfiles();
      const { restored, alreadyPresent } = response.data;
      await data.refresh();
      data.notify(
        restored.length > 0
          ? `Restored built-in profile(s): ${restored.join(", ")}.`
          : "Built-in profile already present.",
      );
      return response.data;
    } catch (restoreError) {
      data.notify(getErrorMessage(restoreError), "error");
      throw restoreError;
    }
  };

  const forwardProfileToGateway = async (profile) => {
    try {
      const device = data.devices.find(
        (item) => String(item.registerProfile?._id) === String(profile._id),
      );
      if (!device) {
        data.notify(
          `Assign “${profile.name}” to a device before forwarding its registers.`,
          "error",
        );
        return;
      }

      const gateway = await api.getGateway();
      const current = gateway.data.configuration;
      const generated = await api.generateGatewayMappings({
        sourceDeviceId: device._id,
      });
      const existingKeys = new Set(
        (current.mappings || []).map((mapping) => mapping.key),
      );
      const fresh = (generated.data.mappings || []).filter(
        (mapping) => !existingKeys.has(mapping.key),
      );

      if (fresh.length === 0) {
        data.notify(
          `All registers of “${profile.name}” are already in the forwarding map.`,
          "error",
        );
        return;
      }

      await api.updateGateway({
        enabled: current.enabled,
        unitId: current.unitId,
        tcp: current.tcp,
        rtu: current.rtu,
        mappings: [...(current.mappings || []), ...fresh],
      });
      data.notify(
        `${fresh.length} register(s) from “${profile.name}” added to the forwarding map at the same addresses. Review and start it in the Gateway page.`,
      );
    } catch (forwardError) {
      data.notify(getErrorMessage(forwardError), "error");
      throw forwardError;
    }
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
                onImportProfiles={importProfiles}
                onExportProfiles={exportProfiles}
                onRestoreBuiltins={restoreBuiltinProfiles}
                onForwardProfile={forwardProfileToGateway}
              />
            }
          />
          <Route path="/gateway" element={<GatewayPage data={data} />} />
          <Route
            path="/gateway/traffic"
            element={<GatewayTrafficPage data={data} />}
          />
          <Route path="/system" element={<SystemPage />} />
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
