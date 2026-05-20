import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

function SettingsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const [pharms, setPharms] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState<any>(null);
  const [uploads, setUploads] = useState<any[]>([]);
  const [fullName, setFullName] = useState(profile?.full_name || "");

  useEffect(() => { setFullName(profile?.full_name || ""); }, [profile]);

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: ups }] = await Promise.all([
        supabase.from("pharmacies").select("*"),
        user ? supabase.from("private_uploads").select("*").eq("user_id", user.id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] as any[] }),
      ]);
      setPharms(p || []);
      setUploads(ups || []);
      if (user) {
        const { data: up } = await supabase.from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
        if (up) setMine((p || []).find((x: any) => x.id === up.pharmacy_id));
      }
    })();
  }, [user]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return pharms.slice(0, 8);
    return pharms.filter((p) => p.name.toLowerCase().includes(q) || p.ods_code.toLowerCase().includes(q) || (p.postcode || "").toLowerCase().includes(q)).slice(0, 12);
  }, [pharms, search]);

  const setPharmacy = async (id: string) => {
    if (!user) return;
    await supabase.from("user_pharmacy").delete().eq("user_id", user.id);
    const { error } = await supabase.from("user_pharmacy").insert({ user_id: user.id, pharmacy_id: id, is_primary: true });
    if (error) return toast.error(error.message);
    const ph = pharms.find((x) => x.id === id);
    setMine(ph);
    toast.success(`Set primary pharmacy to ${ph?.name}`);
  };

  const saveProfile = async () => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
    if (error) return toast.error(error.message);
    await refreshProfile();
    toast.success("Profile saved");
  };

  const deleteUpload = async (id: string) => {
    const { error } = await supabase.from("private_uploads").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setUploads(uploads.filter((u) => u.id !== id));
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Settings" />

      <section className="rounded-lg bg-card border border-border p-6 shadow-sm">
        <h2 className="font-semibold">My pharmacy</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {mine ? <>Currently set to <strong>{mine.name}</strong> ({mine.region})</> : "No pharmacy set."}
        </p>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, ODS code, or postcode"
          className="mt-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <div className="mt-3 space-y-1">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => setPharmacy(p.id)}
              className="w-full text-left rounded-md px-3 py-2 text-sm hover:bg-secondary flex justify-between items-center"
            >
              <span>
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground"> · {p.region}</span>
              </span>
              <span className="text-xs text-muted-foreground">{p.ods_code}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-lg bg-card border border-border p-6 shadow-sm">
        <h2 className="font-semibold">Profile</h2>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-sm font-medium">Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium">Email</label>
            <input value={user?.email || ""} disabled className="mt-1 w-full rounded-md border border-input bg-secondary px-3 py-2 text-sm text-muted-foreground" />
          </div>
          <div>
            <label className="text-sm font-medium">Role</label>
            <p className="mt-1 text-sm text-muted-foreground">
              {profile?.role === "owner_manager" ? "Pharmacy Owner / Manager" : "Consultant / Analyst"}
            </p>
          </div>
          <button onClick={saveProfile} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90">
            Save profile
          </button>
        </div>
      </section>

      <section className="rounded-lg bg-card border border-border p-6 shadow-sm">
        <h2 className="font-semibold">My private uploads</h2>
        {uploads.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-2">No uploads yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {uploads.map((u) => (
              <li key={u.id} className="py-2 flex justify-between items-center text-sm">
                <span>
                  <span className="font-medium">{u.file_name}</span>{" "}
                  <span className="text-muted-foreground">· {u.upload_type} · {new Date(u.created_at).toLocaleDateString("en-GB")}</span>
                </span>
                <button onClick={() => deleteUpload(u.id)} className="text-rose-600 text-xs font-medium hover:underline">Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
