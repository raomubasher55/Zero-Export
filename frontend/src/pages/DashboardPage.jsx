import { useNavigate } from "react-router-dom";
import { Dashboard } from "@/features/dashboard/Dashboard";

export function DashboardPage({ data, onCreateDevice }) {
  const navigate = useNavigate();

  return (
    <Dashboard
      stats={data.stats}
      devices={data.devices}
      scheduler={data.scheduler}
      onOpenDevice={(device) => navigate(`/devices/${device._id}`)}
      onCreate={onCreateDevice}
    />
  );
}
