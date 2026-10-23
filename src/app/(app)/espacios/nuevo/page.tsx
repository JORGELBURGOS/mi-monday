import { redirect } from "next/navigation";

// Las empresas las da de alta el superadministrador desde /superadmin.
export default function NewWorkspacePage() {
  redirect("/superadmin");
}
