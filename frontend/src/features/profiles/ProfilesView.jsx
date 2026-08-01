import { useRef, useState } from "react";
import {
  CirclePlus,
  Download,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState, KeyValue } from "@/components/common/Feedback";

export function ProfilesView({
  profiles,
  onCreate,
  onEdit,
  onDelete,
  onImport,
  onExport,
  onRestoreBuiltins,
}) {
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState("");
  const [restoring, setRestoring] = useState(false);

  const builtInMissing = !profiles.some((profile) => profile.builtIn);

  const restoreBuiltIns = async () => {
    setRestoring(true);
    try {
      await onRestoreBuiltins();
    } catch {
      // The application-level handler displays the restore error.
    } finally {
      setRestoring(false);
    }
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      await onImport(file);
    } catch {
      // The application-level handler displays the API or file validation error.
    } finally {
      setImporting(false);
    }
  };

  const exportFile = async (profile = null) => {
    const key = profile?._id || "all";
    setExporting(key);
    try {
      await onExport(profile);
    } catch {
      // The application-level handler displays the export error.
    } finally {
      setExporting("");
    }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-indigo-600">
            Decoding library
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">
            Register profiles
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Maintain reusable Modbus maps, data types, byte/word order, and
            scaling rules.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={importFile}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing || Boolean(exporting)}
          >
            {importing ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Import JSON
          </Button>
          {builtInMissing && onRestoreBuiltins && (
            <Button
              variant="outline"
              onClick={restoreBuiltIns}
              disabled={restoring || importing || Boolean(exporting)}
            >
              {restoring ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Restore built-ins
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => exportFile()}
            disabled={profiles.length === 0 || importing || Boolean(exporting)}
          >
            {exporting === "all" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export all
          </Button>
          <Button onClick={onCreate}>
            <CirclePlus className="h-4 w-4" />
            New profile
          </Button>
        </div>
      </section>
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Import or export portable JSON files containing complete register addresses, data types,
        byte/word order, scale, offset, units, writable flags, and profile metadata. Existing
        identifiers can be updated after confirmation.
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {profiles.length === 0 ? (
          <Card className="md:col-span-2 xl:col-span-3">
            <EmptyState
              title="No register profiles"
              description="Create a decoding profile before assigning it to a field device."
            />
          </Card>
        ) : (
          profiles.map((profile) => (
            <Card key={profile._id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{profile.name}</CardTitle>
                    <CardDescription className="mt-1 font-mono">
                      {profile.identifier}
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {profile.builtIn && (
                      <Badge
                        variant="outline"
                        className="border-indigo-200 bg-indigo-50 text-indigo-700"
                      >
                        Built-in
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={
                        profile.isActive
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-100 text-slate-600"
                      }
                    >
                      {profile.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <div className="space-y-2 text-sm">
                  <KeyValue
                    label="Registers"
                    value={profile.registers?.length || 0}
                  />
                  <KeyValue
                    label="Manufacturer"
                    value={profile.manufacturer || "—"}
                  />
                  <KeyValue label="Model" value={profile.model || "—"} />
                </div>
                <div className="mt-5 flex gap-2">
                  <Button
                    className="flex-1"
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(profile)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportFile(profile)}
                    disabled={importing || Boolean(exporting)}
                  >
                    {exporting === profile._id ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Export
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    onClick={() => {
                      void onDelete(profile).catch(() => undefined);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
