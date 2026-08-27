"use client";
type Agent={id:string;profile?:string;group?:string;status:string;lastSeen?:string|null};
export default function OfficeView({agents}:{agents:Agent[]}){return <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{agents.map(a=><div className="panel p-4" key={a.id}><div className="eyebrow">{a.group||"Profile pod"}</div><div className="flex justify-between mt-2"><strong>{a.profile||a.id}</strong><span>{a.status}</span></div><p className="text-xs text-[var(--text-3)] mt-4">{a.lastSeen?`Heartbeat ${a.lastSeen}`:"No live heartbeat"}</p></div>)}</div>}
