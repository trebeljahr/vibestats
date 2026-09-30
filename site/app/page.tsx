import Link from "next/link";
import type { ReactNode } from "react";

type Feature = {
  title: string;
  body: string;
};

const features: Feature[] = [
  {
    title: "Sees your archived projects",
    body: "Reads the archived projects that the built-in /stats widget can't see, so your full history actually shows up.",
  },
  {
    title: "Every tool, every day",
    body: "Per-day token and cost breakdown across Claude Code, Codex, and claude.ai web chats — side by side in one timeline.",
  },
  {
    title: "Local-only by design",
    body: "No telemetry, no auto-update ping, no analytics. Your transcripts never leave your machine.",
  },
];

function Hero(): ReactNode {
  return (
    <header className="relative overflow-hidden border-b border-fd-border bg-fd-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--color-fd-primary)/15%,_transparent_60%)]" />
      <div className="relative mx-auto max-w-5xl px-6 pt-24 pb-20 sm:pt-32 sm:pb-28">
        <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-muted/40 px-3 py-1 text-xs font-medium text-fd-muted-foreground">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-fd-primary"
          />
          vibestats · open source
        </p>
        <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-fd-foreground sm:text-6xl">
          Your full Claude Code and Codex usage,
          <br className="hidden sm:block" />{" "}
          <span className="text-fd-primary">in one dashboard.</span>
        </h1>
        <p className="mt-6 max-w-3xl text-balance text-lg leading-relaxed text-fd-muted-foreground sm:text-xl">
          100% local. Zero outbound network calls. A GitHub-style heatmap of
          your entire usage history, with per-model token counts, prompt cache
          breakdown, and a value multiple that compares your usage against
          what you actually pay.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 rounded-md bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90"
          >
            Get started
            <span aria-hidden>→</span>
          </Link>
          <Link
            href="https://github.com/trebeljahr/vibestats"
            className="inline-flex items-center gap-2 rounded-md border border-fd-border bg-fd-card px-5 py-2.5 text-sm font-medium text-fd-foreground transition hover:bg-fd-muted"
          >
            View on GitHub
          </Link>
        </div>
      </div>
    </header>
  );
}

function Features(): ReactNode {
  return (
    <section className="border-b border-fd-border bg-fd-background">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-fd-foreground sm:text-4xl">
            What the built-in widget leaves out.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-fd-muted-foreground">
            vibestats stitches together every transcript on disk — past and
            present — so you can see how you actually use the model.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <article
              key={f.title}
              className="rounded-lg border border-fd-border bg-fd-card p-6 transition hover:border-fd-primary/40"
            >
              <h3 className="mb-3 text-lg font-semibold text-fd-foreground">
                {f.title}
              </h3>
              <p className="text-sm leading-relaxed text-fd-muted-foreground">
                {f.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Screenshot(): ReactNode {
  return (
    <section className="border-b border-fd-border bg-fd-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-fd-foreground sm:text-4xl">
            One page, your whole history.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-fd-muted-foreground">
            Heatmap on top, model breakdown and per-day cost on the bottom.
            Open it in a browser tab and treat it like a dashboard.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-fd-border bg-fd-muted/40 px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-red-400/70" />
            <span className="h-3 w-3 rounded-full bg-amber-400/70" />
            <span className="h-3 w-3 rounded-full bg-emerald-400/70" />
            <span className="ml-3 truncate text-xs text-fd-muted-foreground">
              dashboard.html
            </span>
          </div>
          <iframe
            src="/demo/index.html"
            title="Vibestats dashboard with fictional usage data"
            className="block h-[620px] w-full"
            sandbox="allow-scripts"
          />
        </div>
      </div>
    </section>
  );
}

function Install(): ReactNode {
  return (
    <section className="border-b border-fd-border bg-fd-background">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-fd-foreground sm:text-4xl">
            Install it however you install things.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-fd-muted-foreground">
            Both routes generate the same static dashboard from the JSONL logs
            already sitting in your home directory.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <InstallCard
            label="npm"
            command="npx @trebeljahr/vibestats"
            hint="No install. Runs in place, drops the dashboard in the current folder."
          />
          <InstallCard
            label="Homebrew"
            command="brew install trebeljahr/tap/vibestats"
            hint="Installs the CLI globally so you can re-run it later."
          />
        </div>
      </div>
    </section>
  );
}

function InstallCard({
  label,
  command,
  hint,
}: {
  label: string;
  command: string;
  hint: string;
}): ReactNode {
  return (
    <div className="overflow-hidden rounded-lg border border-fd-border bg-fd-card">
      <div className="flex items-center justify-between border-b border-fd-border bg-fd-muted/30 px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-fd-muted-foreground">
          {label}
        </span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-sm leading-relaxed text-fd-foreground">
        <code>
          <span className="select-none text-fd-muted-foreground">$ </span>
          {command}
        </code>
      </pre>
      <p className="border-t border-fd-border px-4 py-3 text-xs text-fd-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function Footer(): ReactNode {
  return (
    <footer className="bg-fd-background">
      <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-4 px-6 py-10 text-sm text-fd-muted-foreground sm:flex-row sm:items-center">
        <p>
          vibestats · MIT licensed · built by{" "}
          <Link
            href="https://github.com/trebeljahr"
            className="text-fd-foreground underline-offset-4 hover:underline"
          >
            trebeljahr
          </Link>
        </p>
        <div className="flex items-center gap-5">
          <Link
            href="/demo"
            className="hover:text-fd-foreground"
          >
            Demo
          </Link>
          <Link
            href="https://github.com/trebeljahr/vibestats"
            className="hover:text-fd-foreground"
          >
            GitHub
          </Link>
        </div>
      </div>
    </footer>
  );
}

export default function Page(): ReactNode {
  return (
    <main className="flex min-h-screen flex-col bg-fd-background text-fd-foreground">
      <Hero />
      <Features />
      <Screenshot />
      <Install />
      <Footer />
    </main>
  );
}
