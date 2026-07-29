import { useNavigate } from "react-router-dom";
import { DevicesView } from "@/features/devices/DevicesView";
import { api } from "@/lib/api";

export function DevicesPage({ data, onCreateDevice, onEditDevice, onDeleteDevice }) {
  const navigate = useNavigate();

  return (
    <DevicesView
      devices={data.filteredDevices}
      profiles={data.profiles}
      search={data.deviceSearch}
      onSearch={data.setDeviceSearch}
      onCreate={onCreateDevice}
      onEdit={onEditDevice}
      onDelete={onDeleteDevice}
      onOpen={(device) => navigate(`/devices/${device._id}`)}
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
  );
}
