import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/data";
import { listCompaniesAction } from "@/app/actions/companies";
import { Card, PageHeader } from "@/components/ui/misc";
import { CompaniesPanel } from "./companies-panel";

export const metadata: Metadata = { title: "Superadmin" };

export default async function SuperadminPage() {
  const user = await requireUser("/superadmin");
  if (!(await isPlatformAdmin(user.id))) notFound();
  const res = await listCompaniesAction();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow="Superadministrador"
        title="Empresas"
        description="Cada empresa tiene sus propios usuarios, tableros y reglas, sin mezclarse con las demás. Al dar de alta una empresa, en el mismo paso se crea su administrador."
      />
      {res.ok ? (
        <CompaniesPanel companies={res.data} />
      ) : (
        <Card>
          <p className="text-sm text-danger">{res.error}</p>
        </Card>
      )}
    </div>
  );
}
