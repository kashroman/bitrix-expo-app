import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callBx, CrmItem } from "@/lib/bitrix";
import { queryClient } from "@/lib/queryClient";
import { EXPO_ENTITY_TYPE_ID } from "@/lib/config";

export type InlineEditValue = string | undefined;

export function DateFieldEdit({
  label,
  value,
  expoId,
  fieldCode,
  onSaved,
}: {
  label: string;
  value: InlineEditValue;
  expoId: number;
  fieldCode: string;
  onSaved?: () => void;
}) {
  const initial = value ?? "";
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(initial);
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; message?: string }>({
    kind: "idle",
  });

  useEffect(() => {
    setInput(initial);
    setStatus({ kind: "idle" });
  }, [initial, expoId]);

  const mutation = useMutation({
    mutationFn: async (nextValue: string) => {
      const fields: Record<string, unknown> = {};
      // Send both camelCase and uppercase variants for compatibility
      const camel = fieldCode.charAt(0).toLowerCase() + fieldCode.slice(1);
      fields[camel] = nextValue || null;
      fields[fieldCode.toUpperCase()] = nextValue || null;

      await callBx("crm.item.update", {
        entityTypeId: EXPO_ENTITY_TYPE_ID,
        id: expoId,
        fields,
      });
    },
    onSuccess: () => {
      setStatus({ kind: "ok", message: "Сохранено" });
      queryClient.invalidateQueries({ queryKey: ["expo-list-month"] });
      queryClient.invalidateQueries({ queryKey: ["expo-aggregate", expoId] });
      setEditing(false);
      onSaved?.();
      setTimeout(() => setStatus({ kind: "idle" }), 1500);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: "err", message });
    },
  });

  const trimmed = input.trim();
  const isDirty = trimmed !== initial;
  const isValidDate = !trimmed || /^\d{4}-\d{2}-\d{2}/.test(trimmed);
  const canSave = isDirty && isValidDate && !mutation.isPending;

  if (!editing) {
    return (
      <div className="text-xs">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="block text-muted-foreground hover:text-foreground underline truncate max-w-full"
          title={value || "Не заполнено"}
        >
          {value ? value : "—"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <Input
          type="date"
          value={input}
          onChange={(ev) => {
            setInput(ev.target.value);
            if (status.kind !== "idle") setStatus({ kind: "idle" });
          }}
          className="h-7 w-32 text-xs"
          data-testid={`input-${fieldCode}`}
          aria-invalid={!isValidDate}
        />
        <Button
          size="sm"
          variant="default"
          onClick={() => mutation.mutate(trimmed)}
          disabled={!canSave}
          className="h-7 px-2"
          data-testid={`button-save-${fieldCode}`}
        >
          {mutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(false);
            setInput(initial);
            setStatus({ kind: "idle" });
          }}
          className="h-7 px-2"
          data-testid={`button-cancel-${fieldCode}`}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      {status.kind === "ok" ? (
        <div className="text-xs text-emerald-700">{status.message}</div>
      ) : status.kind === "err" ? (
        <div className="text-xs text-destructive">{status.message}</div>
      ) : !isValidDate ? (
        <div className="text-xs text-destructive">Формат: YYYY-MM-DD</div>
      ) : null}
    </div>
  );
}

export function TextFieldEdit({
  value,
  expoId,
  fieldCode,
  onSaved,
}: {
  value: InlineEditValue;
  expoId: number;
  fieldCode: string;
  onSaved?: () => void;
}) {
  const initial = value ?? "";
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(initial);
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; message?: string }>({
    kind: "idle",
  });

  useEffect(() => {
    setInput(initial);
    setStatus({ kind: "idle" });
  }, [initial, expoId]);

  const mutation = useMutation({
    mutationFn: async (nextValue: string) => {
      const fields: Record<string, unknown> = {};
      const camel = fieldCode.charAt(0).toLowerCase() + fieldCode.slice(1);
      fields[camel] = nextValue || null;
      fields[fieldCode.toUpperCase()] = nextValue || null;

      await callBx("crm.item.update", {
        entityTypeId: EXPO_ENTITY_TYPE_ID,
        id: expoId,
        fields,
      });
    },
    onSuccess: () => {
      setStatus({ kind: "ok", message: "Сохранено" });
      queryClient.invalidateQueries({ queryKey: ["expo-list-month"] });
      queryClient.invalidateQueries({ queryKey: ["expo-aggregate", expoId] });
      setEditing(false);
      onSaved?.();
      setTimeout(() => setStatus({ kind: "idle" }), 1500);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: "err", message });
    },
  });

  const trimmed = input.trim();
  const isDirty = trimmed !== initial;
  const canSave = isDirty && !mutation.isPending;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-sm text-muted-foreground hover:text-foreground underline truncate max-w-full block"
        title={value}
      >
        {value || "—"}
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <Input
          type="text"
          value={input}
          onChange={(ev) => {
            setInput(ev.target.value);
            if (status.kind !== "idle") setStatus({ kind: "idle" });
          }}
          className="h-7 text-xs flex-1"
          data-testid={`input-${fieldCode}`}
        />
        <Button
          size="sm"
          variant="default"
          onClick={() => mutation.mutate(trimmed)}
          disabled={!canSave}
          className="h-7 px-2"
          data-testid={`button-save-${fieldCode}`}
        >
          {mutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Save className="h-3 w-3" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(false);
            setInput(initial);
            setStatus({ kind: "idle" });
          }}
          className="h-7 px-2"
          data-testid={`button-cancel-${fieldCode}`}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      {status.kind === "ok" ? (
        <div className="text-xs text-emerald-700">{status.message}</div>
      ) : status.kind === "err" ? (
        <div className="text-xs text-destructive">{status.message}</div>
      ) : null}
    </div>
  );
}
