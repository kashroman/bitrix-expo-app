import { Component, ErrorInfo, ReactNode, useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initBitrix } from "@/lib/bitrix";
import NotFound from "@/pages/not-found";
import InstallPage from "@/pages/install";
import CalendarPage from "@/pages/calendar";
import EventDetailPage from "@/pages/event-detail";
import EntityListPage from "@/pages/entity-list";
import { DealTabPage, LeadTabPage } from "@/pages/crm-tab";
import ExpoTabPage from "@/pages/expo-tab";
import PlacementListPage from "@/pages/placement-list";
import PlacementDetailPage from "@/pages/placement-detail";
import PlacementMenuPage from "@/pages/placement-menu";
import { Shell, PageTitle } from "@/pages/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

class RouteErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route render error", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <Shell>
          <PageTitle
            eyebrow="Ошибка"
            title="Не удалось отобразить страницу"
            description="Произошла непредвиденная ошибка при рендере маршрута. Данные CRM не сохраняются."
          />
          <Card className="border-destructive/40" data-testid="status-route-error">
            <CardHeader>
              <CardTitle className="text-lg">Ошибка рендеринга</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-destructive break-words">
                {this.state.error.message || String(this.state.error)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="default" size="sm" onClick={this.reset} data-testid="button-route-retry">
                  Попробовать снова
                </Button>
                <Link href="/calendar">
                  <a>
                    <Button variant="outline" size="sm" data-testid="button-route-calendar">
                      К списку выставок
                    </Button>
                  </a>
                </Link>
              </div>
            </CardContent>
          </Card>
        </Shell>
      );
    }
    return this.props.children;
  }
}

function bitrixLocationHook(): [string, (to: string) => void] {
  const matchPath = () => {
    const match = window.location.pathname.match(/\/(install|deal-tab|lead-tab|expo-tab|calendar|event|placement-list|placement-detail|placement-menu)(\/[^?#]*)?/);
    if (!match) return undefined;
    return `/${match[1]}${match[2] ?? ""}`;
  };
  const normalize = () => {
    const hash = window.location.hash.replace(/^#/, "");
    const hashRoute = hash.startsWith("/") ? hash.split("?")[0] || "/" : undefined;
    const pathRoute = matchPath();
    if (pathRoute && (!hashRoute || hashRoute === "/")) return pathRoute;
    if (hashRoute) return hashRoute;
    return pathRoute ?? "/";
  };

  const [location, setLocationState] = useState(normalize);
  useEffect(() => {
    const update = () => setLocationState(normalize());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  const navigate = (to: string) => {
    const nextRoute = to.startsWith("/") ? to : `/${to}`;
    window.location.hash = nextRoute;
    setLocationState(nextRoute);
  };
  return [location, navigate];
}

function HomePage() {
  return (
    <Shell>
      <PageTitle
        eyebrow="Приложение"
        title="Внешнее приложение Bitrix24 для выставок"
        description="Откройте /calendar для основного рабочего экрана, /install — для регистрации placement-ов."
      />
      <div className="grid gap-4 md:grid-cols-3">
        <LinkCard href="/calendar" title="Календарь" text="Gantt, Calendar, List." />
        <LinkCard href="/install" title="Установка" text="placement.bind + installFinish." />
        <LinkCard href="/deal-tab" title="Вкладка сделки" text="Воронки по выставке сделки." />
      </div>
    </Shell>
  );
}

function LinkCard({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <Link href={href}>
      <a className="block rounded-xl border bg-card p-5 transition hover:bg-accent">
        <div className="font-semibold">{title}</div>
        <div className="mt-2 text-sm text-muted-foreground">{text}</div>
      </a>
    </Link>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/install" component={InstallPage} />
      <Route path="/calendar" component={CalendarPage} />
      <Route path="/event/:eventId" component={EventDetailPage} />
      <Route path="/event/:eventId/leads">
        {(params) => <EntityListPage params={params} entity="lead" />}
      </Route>
      <Route path="/event/:eventId/deals">
        {(params) => <EntityListPage params={params} entity="deal" />}
      </Route>
      <Route path="/deal-tab" component={DealTabPage} />
      <Route path="/lead-tab" component={LeadTabPage} />
      <Route path="/expo-tab" component={ExpoTabPage} />
      <Route path="/placement-list" component={PlacementListPage} />
      <Route path="/placement-detail" component={PlacementDetailPage} />
      <Route path="/placement-menu" component={PlacementMenuPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    initBitrix();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={bitrixLocationHook}>
          <RouteErrorBoundary>
            <AppRouter />
          </RouteErrorBoundary>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
