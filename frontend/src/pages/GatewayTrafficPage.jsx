import { TrafficAnalyzerView } from "@/features/gateway/TrafficAnalyzerView";

export function GatewayTrafficPage({ data }) {
  return <TrafficAnalyzerView notify={data.notify} />;
}
