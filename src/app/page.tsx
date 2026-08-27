"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApprovalInbox } from "@/components/approval-inbox";
import { HermesBriefing } from "@/components/hermes-briefing";

type Status = "available" | "stale" | "unavailable";
type Evidence = { value: unknown; status: Status; source: string; updatedAt: string | null };
type Profile = { id: string; status: string; group: string };
type Domain = {
  id: string;
  title: string;
  description: string;
  href: string | null;
  evidence: Evidence[];
};
type DashboardData = {
  owner: string;
  profiles: Profile[];
  health: Evidence;
  profileMirror: Evidence;
  activeWork: Evidence;
  activity: Evidence;
  domains: Domain[];
};

const statusColor: Record<Status, string> = {
  available: "var(--up)",
  stale: "var(--warn)",
  unavailable: "var(--down)",
};

function StatusBadge({ status }: { status: Status }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: statusColor[status] }}>
      {status === "available" ? "●" : "○"} {status}
    </span>
  );
}

function EvidenceCard({ title, evidence }: { title: string; evidence: Evidence }) {
  return (
    <article className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-[var(--text)]">{title}</h3>
        <StatusBadge status={evidence.status} />
      </div>
      <dl className="mt-5 grid grid-cols-[4.5rem_1fr] gap-y-2 text-xs text-[var(--text-3)]">
        <dt>Source</dt>
        <dd className="break-words">{evidence.source}</dd>
        <dt>Updated</dt>
        <dd>{evidence.updatedAt ? new Date(evidence.updatedAt).toLocaleString() : "No evidence"}</dd>
      </dl>
    </article>
  );
}

function EvidenceValue({ evidence }: { evidence: Evidence }) {
  if (evidence.status === "unavailable" || evidence.value === null) {
    return <p className="text-sm text-[var(--text-3)]">No evidence available.</p>;
  }
  if (Array.isArray(evidence.value)) {
    const values = evidence.value as Array<{ id?: string; title?: string; status?: string }>;
    return values.length ? (
      <ul className="space-y-1.5 text-sm">
        {values.slice(0, 6).map((value, index) => (
          <li key={value.id ?? index} className="flex justify-between gap-3">
            <span className="truncate">{value.title ?? value.id ?? "Recorded item"}</span>
            {value.status && <span className="text-[var(--text-3)]">{value.status}</span>}
          </li>
        ))}
      </ul>
    ) : <p className="text-sm text-[var(--text-3)]">No matching records.</p>;
  }
  if (typeof evidence.value === "object") {
    const entries = Object.entries(evidence.value as Record<string, unknown>);
    return (
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
        {entries.map(([key, value]) => (
          <div className="contents" key={key}>
            <dt className="text-[var(--text-3)]">{key.replace(/([A-Z])/g, " $1")}</dt>
            <dd className="text-right font-medium">
              {Array.isArray(value) ? (value.length ? value.join(", ") : "None") : value === null ? "—" : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <p className="text-sm">{String(evidence.value)}</p>;
}

function DomainCard({ domain }: { domain: Domain }) {
  const status: Status = domain.evidence.some((item) => item.status === "stale")
    ? "stale"
    : domain.evidence.some((item) => item.status === "available")
      ? "available"
      : "unavailable";
  const content = (
    <article className="panel h-full p-5 transition-colors hover:border-[var(--line-strong)] motion-reduce:transition-none">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{domain.title}</h2>
        <StatusBadge status={status} />
      </div>
      <p className="mt-2 min-h-10 text-xs leading-relaxed text-[var(--text-3)]">{domain.description}</p>
      <div className="mt-5 space-y-4">
        {domain.evidence.map((evidence) => (
          <div key={evidence.source} className="border-t border-[var(--line)] pt-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-[10px] uppercase tracking-wide text-[var(--text-4)]">
              <span className="truncate">{evidence.source}</span>
              <span>{evidence.status}</span>
            </div>
            <EvidenceValue evidence={evidence} />
          </div>
        ))}
      </div>
    </article>
  );
  if (!domain.href) return content;
  if (/^https?:\/\//.test(domain.href)) return <a href={domain.href} target="_blank" rel="noreferrer" className="block h-full">{content}</a>;
  return <Link href={domain.href} className="block h-full">{content}</Link>;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/home", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Home request failed (${response.status})`);
        return response.json() as Promise<DashboardData>;
      })
      .then(setData)
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError")) setError(true);
      });
    return () => controller.abort();
  }, []);

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-3xl font-semibold">Cockpit unavailable</h1>
        <p className="mt-3 text-[var(--text-3)]">Retry after checking database and bridge connectivity.</p>
      </main>
    );
  }
  if (!data) return <main className="p-8 text-[var(--text-3)]" aria-busy="true">Loading operating evidence…</main>;

  return (
    <main className="space-y-8 pb-16">
      <header className="pt-4">
        <div className="eyebrow">Hermy HQ / Turbo main</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">Operating cockpit</h1>
        <p className="mt-4 max-w-2xl text-[var(--text-3)]">
          Decisions first. Every operational claim identifies its source and freshness; missing or old evidence stays explicit.
        </p>
      </header>

      <section aria-labelledby="command-heading">
        <div id="command-heading" className="eyebrow mb-3">Command / approvals and brief</div>
        <div className="grid gap-4 xl:grid-cols-2"><ApprovalInbox /><HermesBriefing /></div>
      </section>

      <section aria-labelledby="freshness-heading">
        <div id="freshness-heading" className="eyebrow mb-3">Evidence & freshness</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <EvidenceCard title="Hermes health" evidence={data.health} />
          <EvidenceCard title="Profile mirror" evidence={data.profileMirror} />
          <EvidenceCard title="Active work" evidence={data.activeWork} />
          <EvidenceCard title="Recent activity" evidence={data.activity} />
        </div>
      </section>

      <section aria-labelledby="domains-heading">
        <div id="domains-heading" className="eyebrow mb-3">Operating domains</div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.domains.map((domain) => <DomainCard key={domain.id} domain={domain} />)}
        </div>
      </section>
    </main>
  );
}
