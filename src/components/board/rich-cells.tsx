"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { asColor } from "@/lib/constants";
import { displayName } from "@/lib/format";
import { PopoverButton } from "@/components/ui/popover";
import { Avatar } from "@/components/ui/misc";
import { IconAlert, IconCheck, IconLink, IconPaperclip, IconPlus, IconSearch, IconTrash, IconX } from "@/components/ui/icons";
import { browserClient, FILES_BUCKET } from "@/lib/supabase/browser";
import {
  checklistProgress,
  isChecklist,
  isFileList,
  newOptionId,
  readValues,
  stringList,
  valueLabel,
  type BoardColumn,
  type CellValue,
  type CheckItem,
  type FileRef,
} from "@/lib/columns";
import { useCellContext, type LinkedItem } from "./cell-context";
import type { Member, Task } from "./types";

type Base = { label: string; disabled?: boolean; cell: boolean; onChange: (v: CellValue | null) => void };

const trigger = (cell: boolean) =>
  cn(
    "flex w-full min-w-0 items-center gap-1.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-60",
    cell ? "h-8 justify-center rounded-lg px-2 hover:bg-surface" : "min-h-10 rounded-lg border border-line bg-surface px-3 hover:border-line-strong",
  );

/* ------------------------------------------------------------------ archivos */

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function FilesCell({ value, taskId, label, disabled, cell, onChange }: Base & { value: CellValue | undefined; taskId: string }) {
  const files = isFileList(value) ? value : [];
  return (
    <PopoverButton
      label={`${label}: ${files.length} archivos. Ver`}
      width={320}
      className={trigger(cell)}
      panel={() => <FilesPanel files={files} taskId={taskId} disabled={disabled} onChange={onChange} />}
    >
      {files.length === 0 ? (
        <span className="text-subtle">{cell ? <IconPaperclip size={14} /> : "Sin archivos"}</span>
      ) : (
        <>
          <IconPaperclip size={14} className="shrink-0 text-muted" />
          <span className="truncate">{files.length === 1 ? files[0].name : `${files.length} archivos`}</span>
        </>
      )}
    </PopoverButton>
  );
}

function FilesPanel({ files, taskId, disabled, onChange }: { files: FileRef[]; taskId: string; disabled?: boolean; onChange: (v: CellValue | null) => void }) {
  const ctx = useCellContext();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState(files);

  const open = async (f: FileRef) => {
    const { data, error: err } = await browserClient().storage.from(FILES_BUCKET).createSignedUrl(f.path, 300);
    if (err || !data) return setError("No se pudo abrir el archivo.");
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const upload = async (picked: FileList | null) => {
    if (!picked?.length || !ctx || taskId.startsWith("tmp-")) return;
    setBusy(true);
    setError(null);
    const added: FileRef[] = [];
    for (const file of Array.from(picked).slice(0, 20)) {
      if (file.size > 25 * 1024 * 1024) {
        setError(`“${file.name}” supera los 25 MB.`);
        continue;
      }
      const safe = file.name.normalize("NFD").replace(/[^\w.\-]+/g, "_").slice(-120) || "archivo";
      const path = `${ctx.workspaceId}/${ctx.boardId}/${taskId}/${crypto.randomUUID()}-${safe}`;
      const { error: err } = await browserClient().storage.from(FILES_BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (err) {
        setError(`No se pudo subir “${file.name}”.`);
        continue;
      }
      added.push({ id: path, name: file.name.slice(0, 200), path, size: file.size, type: file.type });
    }
    setBusy(false);
    if (added.length) {
      const next = [...list, ...added];
      setList(next);
      onChange(next);
    }
    if (input.current) input.current.value = "";
  };

  const remove = async (f: FileRef) => {
    setBusy(true);
    await browserClient().storage.from(FILES_BUCKET).remove([f.path]);
    setBusy(false);
    const next = list.filter((x) => x.path !== f.path);
    setList(next);
    onChange(next.length ? next : null);
  };

  return (
    <div className="space-y-2">
      {list.length === 0 && <p className="px-1 py-2 text-sm text-muted">Todavía no hay archivos.</p>}
      <ul className="space-y-1">
        {list.map((f) => (
          <li key={f.path} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2">
            <IconPaperclip size={14} className="shrink-0 text-muted" />
            <button type="button" onClick={() => open(f)} className="min-w-0 flex-1 truncate text-left text-sm text-accent hover:underline" title={f.name}>
              {f.name}
            </button>
            <span className="shrink-0 text-xs text-subtle">{fmtSize(f.size)}</span>
            {!disabled && (
              <button type="button" onClick={() => remove(f)} disabled={busy} aria-label={`Quitar ${f.name}`} className="shrink-0 rounded p-1 text-subtle hover:bg-danger-soft hover:text-danger">
                <IconTrash size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger">{error}</p>}
      {!disabled && (
        <label className={cn("flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-[13px] font-semibold text-muted hover:bg-surface-2 hover:text-fg", busy && "opacity-60")}>
          <IconPlus size={14} /> {busy ? "Subiendo…" : "Subir archivos (hasta 25 MB c/u)"}
          <input ref={input} type="file" multiple className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files)} />
        </label>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ personas */

export function PeopleCell({ value, members, label, disabled, cell, onChange }: Base & { value: CellValue | undefined; members: Member[] }) {
  const ids = stringList(value);
  const chosen = ids.map((id) => members.find((m) => m.user_id === id)).filter((m): m is Member => Boolean(m));
  return (
    <PopoverButton
      label={`${label}: ${chosen.map(displayName).join(", ") || "nadie"}. Cambiar`}
      disabled={disabled}
      width={280}
      className={trigger(cell)}
      panel={() => <PeoplePanel ids={ids} members={members} onChange={onChange} />}
    >
      {chosen.length === 0 ? (
        <span className="text-subtle">{cell ? "" : "Sin asignar"}</span>
      ) : (
        <span className="flex min-w-0 items-center">
          <span className="flex -space-x-1.5">
            {chosen.slice(0, 3).map((m) => (
              <Avatar key={m.user_id} name={displayName(m)} size="sm" className="ring-2 ring-surface" />
            ))}
          </span>
          {chosen.length > 3 && <span className="ml-1 text-xs text-muted">+{chosen.length - 3}</span>}
          {!cell || chosen.length === 1 ? <span className="ml-1.5 truncate">{chosen.length === 1 ? displayName(chosen[0]) : `${chosen.length} personas`}</span> : null}
        </span>
      )}
    </PopoverButton>
  );
}

function PeoplePanel({ ids, members, onChange }: { ids: string[]; members: Member[]; onChange: (v: CellValue | null) => void }) {
  const [sel, setSel] = useState(ids);
  const [q, setQ] = useState("");
  const list = members.filter((m) => !q.trim() || displayName(m).toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    setSel(next);
    onChange(next.length ? next : null);
  };
  return (
    <div className="space-y-1.5">
      <SearchBox value={q} onChange={setQ} placeholder="Buscar persona" />
      <ul className="max-h-64 overflow-y-auto">
        {list.map((m) => (
          <li key={m.user_id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-surface-2">
              <input type="checkbox" checked={sel.includes(m.user_id)} onChange={() => toggle(m.user_id)} className="h-4 w-4 accent-[var(--accent)]" />
              <Avatar name={displayName(m)} size="sm" />
              <span className="truncate">{displayName(m)}</span>
            </label>
          </li>
        ))}
        {list.length === 0 && <li className="px-1.5 py-2 text-sm text-muted">Sin resultados.</li>}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- checklist */

export function ChecklistCell({ value, label, disabled, cell, onChange }: Base & { value: CellValue | undefined }) {
  const items = isChecklist(value) ? value : [];
  const { done, total } = checklistProgress(value);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <PopoverButton
      label={`${label}: ${done} de ${total} pasos. Abrir`}
      width={320}
      className={trigger(cell)}
      panel={() => <ChecklistPanel items={items} disabled={disabled} onChange={onChange} />}
    >
      {total === 0 ? (
        <span className="text-subtle">{cell ? "" : "Sin pasos"}</span>
      ) : (
        <span className="flex w-full items-center gap-2">
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
            <span className={cn("block h-full rounded-full", pct === 100 ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} />
          </span>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
            {done}/{total}
          </span>
        </span>
      )}
    </PopoverButton>
  );
}

function ChecklistPanel({ items, disabled, onChange }: { items: CheckItem[]; disabled?: boolean; onChange: (v: CellValue | null) => void }) {
  const [list, setList] = useState(items);
  const [text, setText] = useState("");
  const save = (next: CheckItem[]) => {
    setList(next);
    onChange(next.length ? next : null);
  };
  return (
    <div className="space-y-2">
      {list.length === 0 && <p className="px-1 text-sm text-muted">Agregá los pasos de este elemento.</p>}
      <ul className="max-h-72 space-y-0.5 overflow-y-auto">
        {list.map((i) => (
          <li key={i.id} className="group/i flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-2">
            <input
              type="checkbox"
              checked={i.done}
              disabled={disabled}
              aria-label={i.text}
              onChange={(e) => save(list.map((x) => (x.id === i.id ? { ...x, done: e.target.checked } : x)))}
              className="h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span className={cn("min-w-0 flex-1 text-sm", i.done && "text-muted line-through")}>{i.text}</span>
            {!disabled && (
              <button type="button" onClick={() => save(list.filter((x) => x.id !== i.id))} aria-label={`Quitar ${i.text}`} className="rounded p-0.5 text-subtle opacity-0 hover:text-danger focus-visible:opacity-100 group-hover/i:opacity-100">
                <IconX size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            save([...list, { id: newOptionId(), text: text.trim().slice(0, 200), done: false }]);
            setText("");
          }}
        >
          <input data-autofocus value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Nuevo paso y Enter" aria-label="Nuevo paso" className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm" />
          <button type="submit" disabled={!text.trim()} className="h-8 rounded-md bg-accent px-2.5 text-xs font-semibold text-accent-fg disabled:opacity-50">
            Agregar
          </button>
        </form>
      )}
    </div>
  );
}

/* --------------------------------------------- depende de · conectar tableros */

type Pickable = { id: string; title: string; done: boolean; href?: string; boardName?: string };

export function LinkItemsCell({
  column,
  value,
  taskId,
  label,
  disabled,
  cell,
  onChange,
}: Base & { column: BoardColumn; value: CellValue | undefined; taskId: string }) {
  const ctx = useCellContext();
  const ids = stringList(value);
  const dependency = column.kind === "dependency";
  const options: Pickable[] = dependency
    ? (ctx?.tasks ?? []).filter((t) => t.id !== taskId && !t.id.startsWith("tmp-")).map((t) => ({ id: t.id, title: t.title, done: Boolean(t.status_id && ctx?.doneIds.has(t.status_id)) }))
    : [...(ctx?.linkedItems.values() ?? [])]
        .filter((i) => i.board_id === column.settings.boardId)
        .map((i) => {
          const b = ctx?.linkedBoards.get(i.board_id);
          return { id: i.id, title: i.title, done: Boolean(b?.statuses.find((s) => s.id === i.status_id)?.is_done), href: `/t/${i.board_id}?item=${i.id}`, boardName: b?.name };
        });
  const chosen = ids.map((id) => options.find((o) => o.id === id)).filter((o): o is Pickable => Boolean(o));
  const blocked = dependency && chosen.some((c) => !c.done);
  const noBoard = !dependency && !column.settings.boardId;

  return (
    <PopoverButton
      label={`${label}: ${chosen.map((c) => c.title).join(", ") || "sin vincular"}. Cambiar`}
      width={340}
      className={trigger(cell)}
      panel={() =>
        noBoard ? (
          <p className="p-2 text-sm text-muted">Elegí el tablero a conectar en “Configurar columna”.</p>
        ) : (
          <LinkPanel options={options} ids={ids} disabled={disabled} onChange={onChange} dependency={dependency} />
        )
      }
    >
      {chosen.length === 0 ? (
        <span className="text-subtle">{cell ? "" : "Sin vincular"}</span>
      ) : (
        <span className="flex min-w-0 items-center gap-1">
          {blocked && <IconAlert size={13} className="shrink-0 text-warning" aria-label="Hay tareas previas sin terminar" />}
          {dependency ? null : <IconLink size={13} className="shrink-0 text-muted" />}
          <span className={cn("truncate rounded-full bg-surface-2 px-2 py-0.5 text-[12px]", chosen[0].done && "line-through text-muted")}>{chosen[0].title}</span>
          {chosen.length > 1 && <span className="shrink-0 text-xs text-muted">+{chosen.length - 1}</span>}
        </span>
      )}
    </PopoverButton>
  );
}

function LinkPanel({ options, ids, disabled, onChange, dependency }: { options: Pickable[]; ids: string[]; disabled?: boolean; onChange: (v: CellValue | null) => void; dependency: boolean }) {
  const [sel, setSel] = useState(ids);
  const [q, setQ] = useState("");
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const list = options.filter((o) => sel.includes(o.id) || !q.trim() || norm(o.title).includes(norm(q.trim()))).slice(0, 200);
  const toggle = (id: string) => {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    setSel(next);
    onChange(next.length ? next : null);
  };
  return (
    <div className="space-y-1.5">
      <p className="px-1 text-xs text-muted">{dependency ? "Elementos que tienen que terminarse antes:" : "Elementos vinculados:"}</p>
      <SearchBox value={q} onChange={setQ} placeholder="Buscar elemento" />
      <ul className="max-h-72 overflow-y-auto">
        {list.map((o) => (
          <li key={o.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-surface-2">
            <input type="checkbox" checked={sel.includes(o.id)} disabled={disabled} onChange={() => toggle(o.id)} aria-label={o.title} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
            <span className={cn("min-w-0 flex-1 truncate text-sm", o.done && "text-muted line-through")}>{o.title}</span>
            {o.done && <IconCheck size={13} className="shrink-0 text-success" aria-label="Terminado" />}
            {o.href && (
              <Link href={o.href} className="shrink-0 text-xs font-semibold text-accent hover:underline">
                Abrir
              </Link>
            )}
          </li>
        ))}
        {list.length === 0 && <li className="px-1.5 py-2 text-sm text-muted">No hay elementos para vincular.</li>}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------------- espejo */

export function MirrorCell({ column, task, columns, members, cell }: { column: BoardColumn; task: Task; columns: BoardColumn[]; members: Member[]; cell: boolean }) {
  const ctx = useCellContext();
  const connect = columns.find((c) => c.id === column.settings.connectColumnId);
  const items = connect
    ? stringList(readValues(task.custom_values)[connect.id])
        .map((id) => ctx?.linkedItems.get(id))
        .filter((i): i is LinkedItem => Boolean(i))
    : [];
  const board = connect?.settings.boardId ? ctx?.linkedBoards.get(connect.settings.boardId) : undefined;
  const key = column.settings.mirrorKey ?? "status";
  const cls = cn("flex min-w-0 items-center gap-1 text-[13px]", cell ? "h-8 justify-center px-1" : "min-h-10 px-1");
  if (!connect) return <span className={cn(cls, "text-xs text-subtle")}>{cell ? "" : "Configurá la columna"}</span>;
  if (!items.length) return <span className={cls} />;

  if (key === "status") {
    const sts = items.map((i) => board?.statuses.find((s) => s.id === i.status_id)).filter(Boolean);
    return (
      <span className={cls}>
        {sts.slice(0, 2).map((s, i) => (
          <span key={i} className={cn(`solid-${asColor(s!.color)}`, "truncate rounded-full px-2 py-0.5 text-[11px] font-semibold")}>
            {s!.label}
          </span>
        ))}
        {sts.length > 2 && <span className="text-xs text-muted">+{sts.length - 2}</span>}
      </span>
    );
  }
  const values = items.map((i) => {
    if (key === "title") return i.title;
    if (key === "due") return i.due_date ?? "";
    if (key === "assignee") {
      const m = members.find((x) => x.user_id === i.assignee_id);
      return m ? displayName(m) : "";
    }
    const col = board?.columns.find((c) => `c:${c.id}` === key);
    return col ? valueLabel(col, readValues(i.custom_values)[col.id], members) : "";
  });
  const col = board?.columns.find((c) => `c:${c.id}` === key);
  if (col?.kind === "number") {
    const sum = items.reduce((n, i) => n + (Number(readValues(i.custom_values)[col.id]) || 0), 0);
    return <span className={cn(cls, "justify-end tabular-nums")}>{sum.toLocaleString("es-AR", { maximumFractionDigits: 2 })}</span>;
  }
  const text = values.filter(Boolean).join(", ");
  return (
    <span className={cls} title={text}>
      <span className="truncate">{text}</span>
    </span>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
      <input data-autofocus value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-8 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-sm" />
    </div>
  );
}
