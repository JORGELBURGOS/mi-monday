"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormAlert, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { clearAiKeyAction, saveAiKeyAction } from "@/app/actions/ai";

/** Token de DeepSeek de la empresa (solo dueño o superadministrador). Nunca se muestra. */
export function AiSettings({ workspaceId, hint, dailyLimit, usedToday }: { workspaceId: string; hint: string | null; dailyLimit: number; usedToday: number }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [limit, setLimit] = useState(String(dailyLimit));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await saveAiKeyAction(workspaceId, key, Number(limit));
          if (!res.ok) setError(res.error);
          else {
            setKey("");
            toast.success(key ? "Token guardado." : "Límite actualizado.");
          }
        });
      }}
    >
      <div>
        <h2 className="font-bold">Reglas con inteligencia artificial (DeepSeek)</h2>
        <p className="mt-1 text-sm text-muted">
          Con un token de DeepSeek, quien administra un tablero puede escribir una regla con sus palabras y Vetta la arma. El token se guarda cifrado y no se vuelve a mostrar;
          la IA solo recibe la estructura del tablero, no el contenido de los elementos.
        </p>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
      <p className="text-sm">
        Estado:{" "}
        {hint ? (
          <span className="font-semibold text-success">Configurado ({hint})</span>
        ) : (
          <span className="font-semibold text-muted">Sin token</span>
        )}
        {hint && <span className="text-muted"> · {usedToday} pedidos en las últimas 24 h</span>}
      </p>
      <Field id="ai-key" label={hint ? "Reemplazar el token" : "Token de DeepSeek"} hint="Empieza con sk-… Lo sacás de platform.deepseek.com › API keys">
        <Input id="ai-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder={hint ? "Dejalo vacío para conservar el actual" : "sk-…"} />
      </Field>
      <Field id="ai-limit" label="Límite de pedidos por día" hint="Para controlar el gasto. 0 = pausado.">
        <Input id="ai-limit" type="number" min={0} max={1000} value={limit} onChange={(e) => setLimit(e.target.value)} className="max-w-32" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending || (!key.trim() && !hint)}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        {hint && (
          <Button
            type="button"
            variant="outline-danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await clearAiKeyAction(workspaceId);
                if (!res.ok) setError(res.error);
                else toast.success("Token quitado.");
              })
            }
          >
            Quitar token
          </Button>
        )}
      </div>
    </form>
  );
}
