import { useEffect } from "react";
import { Link } from "wouter";

export function useLightThemeLock() {
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light";
  }, []);
}

export function Shell({ children, embedded }: { children: React.ReactNode; embedded?: boolean }) {
  useLightThemeLock();
  if (embedded) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto max-w-6xl px-3 py-3" id="main-content">
          {children}
        </main>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <div className="text-sm font-semibold leading-none" data-testid="text-app-name">
                Календарь выставок
              </div>
              <div className="text-xs text-muted-foreground" data-testid="text-company-name">
                interpro.pro · Bitrix24 CRM
              </div>
            </div>
          </div>
          <nav className="hidden items-center gap-2 md:flex" aria-label="Основная навигация">
            <NavLink href="/calendar">Календарь</NavLink>
            <NavLink href="/install">Установка</NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6" id="main-content">
        {children}
      </main>
    </div>
  );
}

function Logo() {
  return (
    <svg aria-label="interpro expo" className="h-10 w-10 text-primary" viewBox="0 0 64 64" fill="none">
      <rect x="7" y="9" width="50" height="46" rx="12" stroke="currentColor" strokeWidth="4" />
      <path d="M18 24h28M18 34h28M18 44h20" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M24 14v36M42 14v28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".45" />
    </svg>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href}>
      <a className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground" data-testid={`link-${href.slice(1)}`}>
        {children}
      </a>
    </Link>
  );
}

export function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="mb-6 grid gap-2">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary">{eyebrow}</div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="status-empty">
      {text}
    </div>
  );
}

export function LoadingRows() {
  return (
    <div className="space-y-3" data-testid="status-loading">
      <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
      <div className="h-5 w-5/6 animate-pulse rounded bg-muted" />
    </div>
  );
}
