import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ForcedPasswordForm } from "@/components/password-forms";
import { signOutAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Elegí tu contraseña" };

export default async function ForcedPasswordPage() {
  const user = await requireUser("/cambiar-clave");
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, must_change_password")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.must_change_password) redirect("/inicio");

  const firstName = profile.full_name?.split(" ")[0];
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">{firstName ? `Hola, ${firstName}` : "Elegí tu contraseña"}</h1>
      <p className="mb-6 mt-1.5 text-sm text-muted">
        Estás usando una contraseña temporal. Elegí una propia para empezar a trabajar con {user.email}.
      </p>
      <ForcedPasswordForm />
      <form action={signOutAction} className="mt-6 text-center">
        <button type="submit" className="text-sm text-muted hover:text-fg hover:underline">
          Salir sin cambiar
        </button>
      </form>
    </>
  );
}
