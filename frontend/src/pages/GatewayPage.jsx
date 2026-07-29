import { GatewayView } from "@/features/gateway/GatewayView";

export function GatewayPage({ data }) {
  return (
    <GatewayView
      devices={data.devices}
      profiles={data.profiles}
      notify={data.notify}
    />
  );
}
