import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { callForms } from "@/lib/forms-api";
import { PublicFormClient, type FormEnvelope } from "@/components/forms/public-form";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function load(slug: string): Promise<{ envelope: FormEnvelope | null; error: string | null }> {
  // Si la persona tiene sesión, se manda su token (para formularios solo de la empresa).
  let token: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? null;
  } catch {
    token = null;
  }
  const res = await callForms<FormEnvelope>({ action: "get", slug }, token);
  return res.ok ? { envelope: res.data, error: null } : { envelope: null, error: res.error };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { envelope } = await load(slug);
  return { title: envelope?.title ?? "Formulario", robots: { index: false, follow: false } };
}

export default async function PublicFormPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const { envelope, error } = await load(slug);
  const prefill: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "embed") prefill[k] = v.slice(0, 500);
  return <PublicFormClient slug={slug} initial={envelope} initialError={error} prefill={prefill} embed={sp.embed === "1"} />;
}
