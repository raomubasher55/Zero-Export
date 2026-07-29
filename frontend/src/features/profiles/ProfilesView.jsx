import { CirclePlus, Pencil, Trash2 } from "lucide-react";
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

export function ProfilesView({ profiles, onCreate, onEdit, onDelete }) {
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
        <Button onClick={onCreate}>
          <CirclePlus className="h-4 w-4" />
          New profile
        </Button>
      </section>
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
