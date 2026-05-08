import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Search, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shell, PageTitle } from "./shell";
import { apiRequest } from "@/lib/queryClient";

type Preview = {
  title?: string;
  beginDate?: string;
  endDate?: string;
  montageStart?: string;
  montageEnd?: string;
  dismantleStart?: string;
  dismantleEnd?: string;
  parser: string;
  host: string;
  notes: string[];
};

type PreviewResponse = {
  preview: Preview;
  confidence: number;
  calculatedApplied: boolean;
};

export default function PlacementListPage({ embedded = false }: { embedded?: boolean } = {}) {
  if (embedded) return <PlacementListBody />;
  return (
    <Shell embedded>
      <PageTitle
        eyebrow="Smart Enrichment"
        title="Добавить выставку по ссылке"
        description="Введите URL страницы организатора. Сервер распарсит даты, выведет превью, после подтверждения создаст карточку."
      />
      <PlacementListBody />
    </Shell>
  );
}

function PlacementListBody() {
  const [url, setUrl] = useState("");
  const [fillCalculated, setFillCalculated] = useState(true);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const check = useMutation({
    mutationFn: async (input: string) => {
      const res = await apiRequest("POST", "/api/smart-add", { url: input });
      return (await res.json()) as PreviewResponse;
    },
    onSuccess: setPreview,
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/smart-add/confirm", {
        url,
        fillCalculated,
        title: preview?.preview.title,
      });
      return await res.json();
    },
  });

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Источник</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <Label htmlFor="src-url">URL страницы выставки</Label>
            <Input
              id="src-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.expocentr.ru/ru/expoaroundtheworld/photonics/"
              data-testid="input-source-url"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={fillCalculated}
              onChange={(e) => setFillCalculated(e.target.checked)}
              data-testid="check-fill-calculated"
            />
            Заполнить монтаж/демонтаж по эвристике, если не найдены
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => check.mutate(url)}
              disabled={!url || check.isPending}
              data-testid="button-check-url"
            >
              {check.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Проверить
            </Button>
            <Button
              variant="default"
              onClick={() => create.mutate()}
              disabled={!preview || create.isPending}
              data-testid="button-create-card"
            >
              {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Создать карточку
            </Button>
          </div>
          {check.isPending && (
            <div
              className="flex items-center gap-2 rounded border border-sky-300 bg-sky-50 p-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200"
              data-testid="status-checking"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Проверяем источник, парсим даты…
            </div>
          )}
          {check.error && (
            <div
              className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
              data-testid="status-check-error"
            >
              Не удалось проверить источник: {(check.error as Error).message}
            </div>
          )}
          {preview && <PreviewBlock data={preview} />}
          {create.data?.id && (
            <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
              Создана карточка #{create.data.id}. Verified: {create.data.verified ? "да" : "нет"}.
            </div>
          )}
          {create.error && (
            <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {(create.error as Error).message}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function PreviewBlock({ data }: { data: PreviewResponse }) {
  const p = data.preview;
  const c = data.confidence;
  const tone = c >= 1 ? "ok" : c >= 0.7 ? "warn" : "low";
  const toneClass =
    tone === "ok"
      ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20"
      : tone === "warn"
      ? "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20"
      : "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20";
  return (
    <div
      className={`rounded-md border p-3 ${toneClass}`}
      data-testid="preview-result"
      role="status"
      aria-live="polite"
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {tone === "ok" ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        )}
        <span>
          Превью · confidence <span data-testid="preview-confidence">{c.toFixed(2)}</span> · {p.parser}
        </span>
      </div>
      <div className="grid gap-1.5 text-sm">
        <Row label="Название" value={p.title} testId="preview-title" />
        <Row label="Даты проведения" value={joinRange(p.beginDate, p.endDate)} testId="preview-dates" />
        <Row label="Монтаж" value={joinRange(p.montageStart, p.montageEnd)} testId="preview-montage" />
        <Row label="Демонтаж" value={joinRange(p.dismantleStart, p.dismantleEnd)} testId="preview-dismantle" />
      </div>
      {data.calculatedApplied && (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Монтаж/демонтаж рассчитан эвристикой (3 рабочих дня до начала, +1/+2 после окончания).
        </div>
      )}
      {p.notes.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Заметки парсера ({p.notes.length})</summary>
          <ul className="mt-1 list-disc pl-4">
            {p.notes.map((n, i) => (
              <li key={i} className="break-all">{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Row({ label, value, testId }: { label: string; value?: string; testId?: string }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span data-testid={testId}>{value ?? "—"}</span>
    </div>
  );
}

function joinRange(a?: string, b?: string): string | undefined {
  if (!a && !b) return undefined;
  if (a && b && a !== b) return `${a} — ${b}`;
  return a ?? b;
}
