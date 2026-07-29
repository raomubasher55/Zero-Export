import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/formatters";

export function useOperationsData() {
  const [devices, setDevices] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [health, setHealth] = useState(null);
  const [scheduler, setScheduler] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backendError, setBackendError] = useState("");
  const [toast, setToast] = useState(null);
  const [deviceSearch, setDeviceSearch] = useState("");

  const notify = useCallback((message, type = "success") => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timeout);
  }, [toast]);

  const refresh = useCallback(
    async ({ initial = false, background = false } = {}) => {
      if (initial) setLoading(true);
      else if (!background) setRefreshing(true);

      const [healthResult, devicesResult, profilesResult, schedulerResult] =
        await Promise.allSettled([
          api.getHealth(),
          api.listDevices({ limit: 100 }),
          api.listRegisterProfiles({ limit: 100 }),
          api.getPollingStatus(),
        ]);

      if (healthResult.status === "fulfilled") {
        setHealth(healthResult.value);
        setBackendError("");
      } else {
        setHealth(null);
        setBackendError(getErrorMessage(healthResult.reason));
      }
      if (devicesResult.status === "fulfilled")
        setDevices(devicesResult.value.data || []);
      if (profilesResult.status === "fulfilled")
        setProfiles(profilesResult.value.data || []);
      if (schedulerResult.status === "fulfilled")
        setScheduler(schedulerResult.value.data);

      setLoading(false);
      if (!background) setRefreshing(false);
    },
    [],
  );

  useEffect(() => {
    refresh({ initial: true });
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refresh({ background: true });
    }, 45000);
    return () => clearInterval(interval);
  }, [refresh]);

  const perform = useCallback(
    async (action, successMessage, { refreshAfter = true } = {}) => {
      try {
        const result = await action();
        if (successMessage) notify(successMessage);
        if (refreshAfter) await refresh();
        return result;
      } catch (error) {
        notify(getErrorMessage(error), "error");
        throw error;
      }
    },
    [notify, refresh],
  );

  const filteredDevices = useMemo(() => {
    const needle = deviceSearch.trim().toLowerCase();
    if (!needle) return devices;
    return devices.filter((device) =>
      [device.name, device.identifier, device.site, device.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [devices, deviceSearch]);

  const stats = useMemo(
    () => ({
      total: devices.length,
      online: devices.filter((device) => device.status === "ONLINE").length,
      alerting: devices.filter((device) =>
        ["ERROR", "TIMEOUT", "OFFLINE"].includes(device.status),
      ).length,
      profiles: profiles.filter((profile) => profile.isActive).length,
    }),
    [devices, profiles],
  );

  return {
    backendError,
    deviceSearch,
    devices,
    filteredDevices,
    health,
    loading,
    notify,
    perform,
    profiles,
    refresh,
    refreshing,
    scheduler,
    setDeviceSearch,
    setToast,
    stats,
    toast,
  };
}
