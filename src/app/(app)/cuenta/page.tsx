import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui/misc";
import { ProfileForm } from "./profile-form";
import { ChangePasswordForm } from "@/components/password-forms";

export const metadata: Metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const user = await requireUser("/cuenta");
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-8">
      <PageHeader title="Mi cuenta" description={user.email} />
      <div className="space-y-6">
        <Card>
          <h2 className="mb-4 font-bold">Perfil</h2>
          <ProfileForm fullName={profile?.full_name ?? ""} />
        </Card>
        <Card>
          <h2 className="mb-4 font-bold">Cambiar contraseña</h2>
          <ChangePasswordForm />
        </Card>
      </div>
    </div>
  );
}
