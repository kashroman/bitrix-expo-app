import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Wand2, FileText, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shell, PageTitle } from "./shell";
import { apiRequest } from "@/lib/queryClient";
import PlacementListPage from "./placement-list";

export default function PlacementMenuPage() {
  return (
    <Shell embedded>
      <PageTitle
        eyebrow="Smart Enrichment"
        title="Календарь выставок · добавление"
        description="Создание карточек по ссылке или вручную, плюс единый запуск автопроверки всех активных выставок."
      />
      <Tabs defaultValue="link" className="space-y-4">
        <TabsList>
          <TabsTrigger value="link" data-testid="tab-link"><Globe className="mr-2 h-4 w-4" />По ссылке</TabsTrigger>
          <TabsTrigger value="manual" data-testid="tab-manual"><FileText className="mr-2 h-4 w-4" />Вручную</TabsTrigger>
          <TabsTrigger value="recheck" data-testid="tab-recheck"><Wand2 className="mr-2 h-4 w-4" />Автопроверка</TabsTrigger>
        </TabsList>
        <TabsContent value="link">
          {/* Reuse the placement-list page body — it's already built around
           *  the smart-add API and Shell embedded. */}
          <PlacementListPage />
        </TabsContent>
        <TabsContent value="manual"><ManualForm /></TabsContent>
        <TabsContent value="recheck"><RecheckAllPanel /></TabsContent>
      </Tabs>
    </Shell>
  );
}

function ManualForm() {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [beginDate, setBeginDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/manual-add", {
        title,
        url: url || undefined,
        beginDate: beginDate || undefined,
        endDate: endDate || undefined,
      });
      return await res.json();
    },
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Создать карточку вручную</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2">
          <Label htmlFor="m-title">Название</Label>
          <Input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-manual-title" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="m-url">URL источника (необязательно)</Label>
          <Input id="m-url" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="input-manual-url" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="m-begin">Дата начала</Label>
            <Input id="m-begin" type="date" value={beginDate} onChange={(e) => setBeginDate(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="m-end">Дата окончания</Label>
            <Input id="m-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <Button onClick={() => create.mutate()} disabled={!title || create.isPending} data-testid="button-manual-create">
          {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Создать
        </Button>
        {create.data?.id && (
          <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            Карточка #{create.data.id} создана. {create.data.needsRecheck ? "Запланирована автопроверка." : ""}
          </div>
        )}
        {create.error && (
          <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {(create.error as Error).message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecheckAllPanel() {
  const run = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/recheck-all", {});
      return await res.json();
    },
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Запустить проверку всех</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Перепарсит все активные карточки с заполненным «Источник (URL)» и датой окончания в будущем.
          Не перезаписывает уже заполненные поля. По умолчанию обрабатывается до 25 карточек за один вызов.
        </p>
        <Button onClick={() => run.mutate()} disabled={run.isPending} data-testid="button-recheck-all">
          {run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
          Запустить проверку всех сейчас
        </Button>
        {run.data && (
          <pre className="whitespace-pre-wrap rounded border bg-muted/30 p-2 text-[11px]">{JSON.stringify(run.data, null, 2)}</pre>
        )}
        {run.error && (
          <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {(run.error as Error).message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
