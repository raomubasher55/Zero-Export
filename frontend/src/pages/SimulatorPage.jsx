import { SimulatorView } from "@/features/simulator/SimulatorView";

export function SimulatorPage({ data, onForwardProfile }) {
  return (
    <SimulatorView
      devices={data.devices}
      profiles={data.profiles}
      notify={data.notify}
      onForwardProfile={onForwardProfile}
    />
  );
}
