import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EmptyState, InlineLoader } from "@/components/common/Feedback";
import { DeviceMonitor } from "@/features/devices/DeviceMonitor";
import { api } from "@/lib/api";

export function DeviceMonitorPage({ data }) {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const listedDevice = data.devices.find((device) => device._id === deviceId);
  const [loadedDevice, setLoadedDevice] = useState(null);
  const [loading, setLoading] = useState(!listedDevice);

  useEffect(() => {
    if (listedDevice) {
      setLoadedDevice(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    api
      .getDevice(deviceId)
      .then((response) => {
        if (active) setLoadedDevice(response.data);
      })
      .catch(() => {
        if (active) setLoadedDevice(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [deviceId, listedDevice]);

  const device = listedDevice || loadedDevice;
  if (loading) return <InlineLoader />;
  if (!device) {
    return (
      <EmptyState
        title="Device not found"
        description="The requested device does not exist or is no longer available."
        action={
          <button
            type="button"
            className="text-sm font-semibold text-indigo-600"
            onClick={() => navigate("/devices")}
          >
            Return to devices
          </button>
        }
      />
    );
  }

  return (
    <DeviceMonitor
      device={device}
      scheduler={data.scheduler}
      onBack={() => navigate("/devices")}
      onRefresh={data.refresh}
      notify={data.notify}
    />
  );
}
