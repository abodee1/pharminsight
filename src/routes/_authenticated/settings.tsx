import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { z } from "zod";
import { User as UserIcon, Lock, Building2, FileText, Search, Check, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

const profileSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(100, "Max 100 characters"),
  role: z.enum(["owner_manager", "consultant_analyst"]),
});

const emailSchema = z.string().trim().email("Invalid email").max(255);
const passwordSchema = z.string().min(8, "Min 8 characters").max(72, "Max 72 characters");

function SettingsPage() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [pharms, setPharms] = useState<any[]>([]);
  const [mine, setMine] = useState<any>(null);
  const [uploads, setUploads] = useState<any[]>([]);

  // Profile
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [role, setRole] = useState<"owner_manager" | "consultant_analyst">(
    profile?.role || "owner_manager"
  );

  // Security
  const [newEmail, setNewEmail] = useState(user?.email || "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Pharmacy search
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState<"all" | "England" | "Scotland" | "Wales" | "Northern Ireland">("all");

  const initials = (profile?.full_name || user?.email || "?")
    .split(/\s+|@/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  useEffect(() => {
    setFullName(profile?.full_name || "");
    if (profile?.role) setRole(profile.role);
  }, [profile]);

  useEffect(() => { setNewEmail(user?.email || ""); }, [user]);

  useEffect(() => {
    (async () => {
      const [p, ups] = await Promise.all([
        fetchAll<any>((from, to) =>
          supabase.from("pharmacies").select("*").order("name").range(from, to)
        ),
        user
          ? supabase.from("private_uploads").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).then((r) => r.data || [])
          : Promise.resolve([] as any[]),
      ]);
      setPharms(p);
      setUploads(ups);
      if (user) {
        const { data: up } = await supabase
          .from("user_pharmacy").select("pharmacy_id").eq("user_id", user.id).maybeSingle();
        if (up) setMine((p || []).find((x: any) => x.id === up.pharmacy_id));
      }
    })();
  }, [user]);

  const countries = useMemo(() => {
    const set = new Set<string>();
    pharms.forEach((p) => p.country && set.add(p.country));
    return Array.from(set).sort();
  }, [pharms]);

  const filtered = useMemo(() => {
    const base = countryFilter === "all" ? pharms : pharms.filter((p) => p.country === countryFilter);
    const q = search.toLowerCase().trim().replace(/\s+/g, " ");
    if (!q) return base.slice(0, 50);
    const qNoSpace = q.replace(/\s+/g, "");
    const scored = base
      .map((p) => {
        const name = (p.name || "").toLowerCase();
        const ods = (p.ods_code || "").toLowerCase();
        const postcode = (p.postcode || "").toLowerCase();
        const postcodeNoSpace = postcode.replace(/\s+/g, "");
        const outward = postcode.split(" ")[0] || "";
        const region = (p.region || "").toLowerCase();
        const address = (p.address || "").toLowerCase();

        let score = 0;
        if (ods === q) score = 1000;
        else if (postcodeNoSpace === qNoSpace) score = 900;
        else if (outward === q) score = 800;
        else if (postcodeNoSpace.startsWith(qNoSpace)) score = 700;
        else if (ods.startsWith(q)) score = 600;
        else if (name.startsWith(q)) score = 500;
        else if (name.includes(q)) score = 300;
        else if (region.includes(q)) score = 200;
        else if (address.includes(q)) score = 100;
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
      .slice(0, 50)
      .map((x) => x.p);
    return scored;
  }, [pharms, search, countryFilter]);

  const setPharmacy = async (id: string) => {
    if (!user) return;
    await supabase.from("user_pharmacy").delete().eq("user_id", user.id);
    const { error } = await supabase.from("user_pharmacy").insert({ user_id: user.id, pharmacy_id: id, is_primary: true });
    if (error) return toast.error(error.message);
    const ph = pharms.find((x) => x.id === id);
    setMine(ph);
    toast.success(`Primary pharmacy set to ${ph?.name}`);
  };

  const saveProfile = async () => {
    if (!user) return;
    const parsed = profileSchema.safeParse({ full_name: fullName, role });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: parsed.data.full_name, role: parsed.data.role })
      .eq("id", user.id);
    if (error) return toast.error(error.message);
    await refreshProfile();
    toast.success("Profile saved");
  };

  const changeEmail = async () => {
    const parsed = emailSchema.safeParse(newEmail);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    if (parsed.data === user?.email) return toast.info("That's already your email.");
    const { error } = await supabase.auth.updateUser({ email: parsed.data });
    if (error) return toast.error(error.message);
    toast.success("Check your inbox to confirm the new email.");
  };

  const changePassword = async () => {
    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    if (newPassword !== confirmPassword) return toast.error("Passwords don't match");
    const { error } = await supabase.auth.updateUser({ password: parsed.data });
    if (error) return toast.error(error.message);
    setNewPassword(""); setConfirmPassword("");
    toast.success("Password updated");
  };

  const deleteUpload = async (id: string) => {
    const { error } = await supabase.from("private_uploads").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setUploads(uploads.filter((u) => u.id !== id));
    toast.success("Upload deleted");
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <PageHeader title="My Account" subtitle="Manage your profile, security, and pharmacy preferences." />

      {/* Header card */}
      <div className="rounded-xl bg-card border border-border p-6 shadow-sm mb-6 flex items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-semibold">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-semibold truncate">{profile?.full_name || user?.email}</p>
          <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {profile?.role === "owner_manager" ? "Owner / Manager" : profile?.role === "consultant_analyst" ? "Consultant / Analyst" : "No role"}
            </Badge>
            {mine && <Badge variant="outline">{mine.name}</Badge>}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={signOut}>Sign out</Button>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="profile" className="gap-2"><UserIcon className="h-4 w-4" />Profile</TabsTrigger>
          <TabsTrigger value="security" className="gap-2"><Lock className="h-4 w-4" />Security</TabsTrigger>
          <TabsTrigger value="pharmacy" className="gap-2"><Building2 className="h-4 w-4" />Pharmacy</TabsTrigger>
          <TabsTrigger value="uploads" className="gap-2"><FileText className="h-4 w-4" />Data</TabsTrigger>
        </TabsList>

        {/* PROFILE */}
        <TabsContent value="profile" className="mt-6">
          <section className="rounded-xl bg-card border border-border p-6 shadow-sm space-y-5">
            <div>
              <h2 className="font-semibold">Personal details</h2>
              <p className="text-sm text-muted-foreground">Used to personalise your dashboard and insights.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" value={fullName} maxLength={100} onChange={(e) => setFullName(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={user?.email || ""} disabled className="mt-1.5 bg-secondary text-muted-foreground" />
                <p className="text-xs text-muted-foreground mt-1">Change your email in the Security tab.</p>
              </div>
            </div>
            <div>
              <Label>Role</Label>
              <div className="mt-2 grid sm:grid-cols-2 gap-3">
                {([
                  { v: "owner_manager", t: "Pharmacy Owner / Manager", d: "I run one or more pharmacies." },
                  { v: "consultant_analyst", t: "Consultant / Analyst", d: "I advise pharmacies or work in industry." },
                ] as const).map((opt) => {
                  const active = role === opt.v;
                  return (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setRole(opt.v)}
                      className={[
                        "text-left rounded-lg border p-4 transition-colors relative",
                        active ? "border-primary bg-secondary" : "border-border hover:border-foreground/30",
                      ].join(" ")}
                    >
                      {active && <Check className="absolute top-3 right-3 h-4 w-4 text-primary" />}
                      <p className="font-medium text-sm">{opt.t}</p>
                      <p className="text-xs text-muted-foreground mt-1">{opt.d}</p>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={saveProfile}>Save changes</Button>
            </div>
          </section>
        </TabsContent>

        {/* SECURITY */}
        <TabsContent value="security" className="mt-6 space-y-6">
          <section className="rounded-xl bg-card border border-border p-6 shadow-sm space-y-4">
            <div>
              <h2 className="font-semibold">Email address</h2>
              <p className="text-sm text-muted-foreground">We'll send a confirmation link to the new address.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1">
                <Label htmlFor="newEmail">New email</Label>
                <Input id="newEmail" type="email" value={newEmail} maxLength={255} onChange={(e) => setNewEmail(e.target.value)} className="mt-1.5" />
              </div>
              <Button onClick={changeEmail}>Update email</Button>
            </div>
          </section>

          <section className="rounded-xl bg-card border border-border p-6 shadow-sm space-y-4">
            <div>
              <h2 className="font-semibold">Change password</h2>
              <p className="text-sm text-muted-foreground">Use at least 8 characters.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="np">New password</Label>
                <Input id="np" type="password" value={newPassword} maxLength={72} onChange={(e) => setNewPassword(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="cp">Confirm password</Label>
                <Input id="cp" type="password" value={confirmPassword} maxLength={72} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1.5" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={changePassword}>Update password</Button>
            </div>
          </section>
        </TabsContent>

        {/* PHARMACY */}
        <TabsContent value="pharmacy" className="mt-6">
          <section className="rounded-xl bg-card border border-border p-6 shadow-sm">
            <h2 className="font-semibold">Primary pharmacy</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {mine ? <>Currently set to <strong className="text-foreground">{mine.name}</strong> — {mine.region}</> : "No pharmacy set. Pick one to unlock benchmarking and insights."}
            </p>
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, ODS code, region or postcode"
                className="pl-9"
              />
            </div>
            <div className="mt-3 divide-y divide-border max-h-96 overflow-y-auto rounded-md border border-border">
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground p-4">No matches.</p>
              )}
              {filtered.map((p) => {
                const isMine = mine?.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setPharmacy(p.id)}
                    className={[
                      "w-full text-left px-4 py-3 text-sm hover:bg-secondary flex justify-between items-center gap-3 transition-colors",
                      isMine ? "bg-secondary" : "",
                    ].join(" ")}
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[p.region, p.country, p.postcode].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground font-mono">{p.ods_code}</span>
                      {isMine && <Check className="h-4 w-4 text-primary" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </TabsContent>

        {/* UPLOADS */}
        <TabsContent value="uploads" className="mt-6">
          <section className="rounded-xl bg-card border border-border p-6 shadow-sm">
            <h2 className="font-semibold">My private uploads</h2>
            <p className="text-sm text-muted-foreground mt-1">Files you've uploaded stay in your private workspace.</p>
            {uploads.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-4">No uploads yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {uploads.map((u) => (
                  <li key={u.id} className="py-3 flex justify-between items-center gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{u.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {u.upload_type} · {new Date(u.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => deleteUpload(u.id)} className="text-rose-600 hover:text-rose-700 hover:bg-rose-50">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
