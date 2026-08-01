import { ZeroExportView } from "@/features/zeroexport/ZeroExportView";

export function ZeroExportPage({ data }) {
  return (
    <ZeroExportView
      devices={data.devices}
      profiles={data.profiles}
      notify={data.notify}
    />
  );
}
