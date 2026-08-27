"use client";

import { useEffect, useState } from "react";

type Profile = {
  id: string;
  profile: string;
  group: string;
  status: "online" | "offline" | "unknown" | "error";
  lastSeen: string | null;
  source: string;
};

const tone = { online: "#59D6A2", offline: "#707680", unknown: "#F0B35A", error: "#FF7272" };
const labels: Record<string, { name: string; role: string }> = {
  default: { name: "Hermes Command", role: "Primary command profile" },
  opsbrain: { name: "Ops Brain", role: "Operations memory and coordination" },
  backtestvalidator: { name: "Backtest Validator", role: "Strategy validation" },
  polymarketstructure: { name: "Polymarket Structure", role: "Prediction-market structure" },
  quantresearch: { name: "Quant Research", role: "Quantitative research" },
  tradingmanager: { name: "Trading Manager", role: "Trading coordination" },
  tradingrisk: { name: "Trading Risk", role: "Risk review and controls" },
  ailab: { name: "AI Lab", role: "AI experiments" },
  builder: { name: "Builder", role: "Product engineering" },
  contentmanager: { name: "Content Manager", role: "Content operations" },
  contentqa: { name: "Content QA", role: "Content quality review" },
  editorialstrategy: { name: "Editorial Strategy", role: "Editorial direction" },
  scriptcopy: { name: "Script & Copy", role: "Scripts and copywriting" },
  ofmcompliance: { name: "OFM Compliance", role: "Compliance review" },
  ofmeditorial: { name: "OFM Editorial", role: "Editorial production" },
  ofmmanager: { name: "OFM Manager", role: "OFM coordination" },
  brandcanon: { name: "Brand Canon", role: "Brand standards" },
  personacanon: { name: "Persona Canon", role: "Persona standards" },
};

export default function AgentsPage() {
  const [data, setData] = useState<{ profiles: Profile[]; syncedAt: string | null; chat: { reason: string } } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/agents")
      .then((response) => {
        if (!response.ok) throw new Error(`Profiles request failed (${response.status})`);
        return response.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return <main className="p-8"><h1 className="text-3xl font-semibold">Profile pods unavailable</h1><p className="mt-3 text-[var(--text-3)]">Check the bridge and retry this page.</p></main>;
  if (!data) return <main className="p-8 text-[var(--text-3)]">Loading profile evidence…</main>;
  const groups = data.profiles.reduce<Record<string, Profile[]>>((result, profile) => {
    (result[profile.group] ??= []).push(profile);
    return result;
  }, {});

  return (
    <main className="p-6 md:p-10 space-y-8">
      <header>
        <div className="eyebrow">Turbo / Hermes control plane</div>
        <h1 className="text-4xl font-semibold mt-2">Profile pods</h1>
        <p className="text-[var(--text-3)] mt-3">Configuration is inventory, not proof of life. Status stays unknown until the bridge mirrors runtime evidence.</p>
      </header>
      <div className="panel p-4 flex flex-wrap gap-5 text-xs">
        <span>Mirror <b>{data.syncedAt ? new Date(data.syncedAt).toLocaleString() : "Unavailable"}</b></span>
        <span>Chat <b>Unavailable</b></span>
        <span className="text-[var(--text-3)]">{data.chat.reason}</span>
      </div>
      {Object.entries(groups).map(([group, profiles]) => (
        <section key={group}>
          <div className="eyebrow mb-3">{group}</div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {profiles.map((profile) => {
              const label = labels[profile.id] ?? { name: profile.profile, role: "Hermes profile" };
              return (
                <article key={profile.id} className="panel p-5 focus-within:ring-2" tabIndex={0}>
                  <div className="flex justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-lg">{label.name}</h2>
                      <p className="text-xs text-[var(--text-2)] mt-1">{label.role}</p>
                      <p className="text-[11px] text-[var(--text-4)] mt-2">ID · {profile.id}</p>
                    </div>
                    <span className="text-xs uppercase font-semibold flex items-center gap-2 self-start" style={{ color: tone[profile.status] }}>
                      <span aria-hidden>{profile.status === "online" ? "●" : profile.status === "error" ? "▲" : "○"}</span>{profile.status}
                    </span>
                  </div>
                  <div className="mt-5 pt-3 border-t border-white/10 text-xs text-[var(--text-3)] flex justify-between gap-3">
                    <span>{profile.source === "hermes-profile-list" ? "Runtime mirror" : "Configured roster"}</span>
                    <span>{profile.lastSeen ? new Date(profile.lastSeen).toLocaleString() : "No heartbeat"}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
