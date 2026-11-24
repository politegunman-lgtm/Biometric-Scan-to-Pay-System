"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { apiJson } from "@/lib/client";
import { CATEGORY_META, money, timeLabel } from "@/lib/format";
import type { MerchantCategory, PayerField, PaymentReason } from "@/lib/types";

/**
 * Business portal.
 *
 * This is the payee's own seat: a business signs in with its payee code and an
 * access PIN, and from then on sees nothing but its own records — payments,
 * reasons, and the students or customers behind them. No student database is
 * needed: the rows carry the reason and the class/faculty/department/year that
 * were captured at payment time, and the portal groups and filters them.
 */

const SESSION_KEY = "bsp.business";

interface PortalPayee {
  id: string;
  name: string;
  code: string;
  kind: string;
  category: MerchantCategory;
  city: string;
  tagline: string | null;
  verified: boolean;
  enrolledAt: string | null;
  schoolLevel?: "primary" | "secondary" | "university" | null;
  pinIsOwn?: boolean;
}

interface GroupBucket {
  key: string;
  label: string;
  count: number;
  totalXAF: number;
}

interface PortalPayment {
  id: string;
  receiptNo: string;
  createdAt: string;
  amountXAF: number;
  status: string;
  channel: string;
  offline: boolean;
  reason: string | null;
  payerFor: string | null;
  payerDetails: { class?: string; faculty?: string; department?: string; year?: string } | null;
  payerName: string | null;
  provider: string;
}

interface PortalData {
  payee: PortalPayee;
  reasons: PaymentReason[];
  filters: { groupBy?: GroupKey };
  stats: {
    received: number;
    volumeXAF: number;
    todayCount: number;
    todayVolumeXAF: number;
    beneficiaries: number;
    rows: number;
  };
  groups: GroupBucket[];
  facets: {
    reasons: { value: string; count: number; totalXAF: number }[];
    class: { value: string; count: number; totalXAF: number }[];
    faculty: { value: string; count: number; totalXAF: number }[];
    department: { value: string; count: number; totalXAF: number }[];
    year: { value: string; count: number; totalXAF: number }[];
  };
  payments: PortalPayment[];
}

type GroupKey = "reason" | "class" | "faculty" | "department" | "year" | "day";

const GROUP_BY: { id: GroupKey; label: string }[] = [
  { id: "reason", label: "Reason" },
  { id: "class", label: "Class" },
  { id: "faculty", label: "Faculty" },
  { id: "department", label: "Department" },
  { id: "year", label: "Year" },
  { id: "day", label: "Day" },
];

const FIELD_LABEL: Record<PayerField, string> = {
  class: "Class",
  faculty: "Faculty",
  department: "Department",
  year: "Year",
};

interface Session {
  token: string;
  name: string;
  code: string;
  expiresAt: string;
}

export default function BusinessPortalPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<{ id: string; name: string; code: string }[]>([]);

  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("all");
  const [status, setStatus] = useState("paid");
  const [groupBy, setGroupBy] = useState<GroupKey>("reason");
  const [constraint, setConstraint] = useState<{ field: PayerField; value: string } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Session;
        if (parsed.token) setSession(parsed);
      }
    } catch {
      /* ignore */
    }
    setReady(true);
    void apiJson<{ demo: { id: string; name: string; code: string }[] }>("/api/business")
      .then((res) => setDemo(res.demo))
      .catch(() => setDemo([]));
  }, []);

  const load = useCallback(
    async (token: string) => {
      setLoading(true);
      try {
        const next = await apiJson<PortalData>("/api/business", {
          method: "POST",
          body: JSON.stringify({
            action: "data",
            token,
            filters: {
              q: query || undefined,
              reason,
              status,
              groupBy,
              field: constraint?.field ?? "any",
              value: constraint?.value,
            },
          }),
        });
        setData(next);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not load records";
        setError(message);
        if (/expired|sign in again/i.test(message)) {
          localStorage.removeItem(SESSION_KEY);
          setSession(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [query, reason, status, groupBy, constraint],
  );

  useEffect(() => {
    if (!session) return;
    const id = window.setTimeout(() => void load(session.token), query ? 220 : 0);
    return () => window.clearTimeout(id);
  }, [session, load, query]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    setError(null);
    try {
      const res = await apiJson<{ token: string; expiresAt: string; payee: { name: string; code: string } }>(
        "/api/business",
        { method: "POST", body: JSON.stringify({ action: "signin", code, pin }) },
      );
      const next: Session = { token: res.token, name: res.payee.name, code: res.payee.code, expiresAt: res.expiresAt };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      setSession(next);
      setPin("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setData(null);
  };

  const csvHref = useMemo(() => {
    if (!session) return "#";
    const params = new URLSearchParams({ token: session.token, groupBy, status, reason });
    if (query) params.set("q", query);
    if (constraint) {
      params.set("field", constraint.field);
      params.set("value", constraint.value);
    }
    return `/api/business/export?${params.toString()}`;
  }, [session, groupBy, status, reason, query, constraint]);

  if (!ready) {
    return (
      <div className="merchant-shell">
        <p className="small muted">Opening the business portal…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="merchant-shell">
        <div className="merchant-header">
          <div className="row gap-11">
            <span
              style={{
                width: 42,
                height: 42,
                borderRadius: 13,
                display: "grid",
                placeItems: "center",
                background: "linear-gradient(160deg,#FFE270,#FFCB05)",
                color: "#171200",
              }}
            >
              <Icon name="store" size={20} />
            </span>
            <div>
              <div className="up">Business portal</div>
              <h1 style={{ fontSize: 21, marginTop: 1 }}>Sign in as the payee</h1>
            </div>
          </div>
          <Link href="/" className="btn ghost sm">
            <Icon name="chevron-left" size={14} />
            Customer app
          </Link>
        </div>

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr)" }} className="join-grid">
          <section className="panel">
            <form className="stack gap-12" onSubmit={signIn}>
              <div className="field">
                <label htmlFor="payee-code">Payee code</label>
                <input
                  id="payee-code"
                  className="input"
                  placeholder="A2DE5"
                  value={code}
                  maxLength={8}
                  autoCapitalize="characters"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                />
                <span className="tiny muted">The five characters customers see next to your name.</span>
              </div>
              <div className="field">
                <label htmlFor="payee-pin">Access PIN</label>
                <input
                  id="payee-pin"
                  className="input"
                  placeholder="4 digits"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  required
                />
                <span className="tiny muted">Demo PIN for every seeded payee is 2468.</span>
              </div>
              {error && (
                <div className="row gap-8 tiny" style={{ color: "var(--coral)", alignItems: "center" }}>
                  <Icon name="alert" size={13} /> {error}
                </div>
              )}
              <button className="btn primary block" type="submit" disabled={signingIn || code.length < 4 || pin.length !== 4}>
                <Icon name="lock" size={15} />
                {signingIn ? "Checking…" : "Open my records"}
              </button>
              <p className="tiny muted" style={{ lineHeight: 1.5 }}>
                This seat shows only payments addressed to this payee. Customer wallets, biometrics and history stay in the
                customer app.
              </p>
            </form>
          </section>

          <section className="panel">
            <div className="section-head" style={{ marginBottom: 8 }}>
              <h2 style={{ fontSize: 14 }}>Demo payees</h2>
              <span className="badge muted">code · PIN 2468</span>
            </div>
            <div className="stack gap-8">
              {demo.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="row-between"
                  style={{ fontSize: 12.5, background: "none", border: "none", padding: "4px 0", cursor: "pointer", color: "inherit" }}
                  onClick={() => {
                    setCode(m.code);
                    setPin("2468");
                  }}
                >
                  <span style={{ color: "var(--text-2)" }}>{m.name}</span>
                  <span className="mono tiny" style={{ color: "var(--accent)" }}>{m.code}</span>
                </button>
              ))}
              {demo.length === 0 && <span className="tiny muted">Loading…</span>}
            </div>
            <div className="hairline" style={{ margin: "14px 0" }} />
            <p className="tiny muted" style={{ lineHeight: 1.55 }}>
              Enrolled a business? Its code is on the confirmation screen, and the access PIN is the one chosen at enrolment
              (demo default 2468).
            </p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="merchant-shell">
      <div className="merchant-header">
        <div className="row gap-11">
          <span
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(160deg,#FFE270,#FFCB05)",
              color: "#171200",
            }}
          >
            <Icon name="store" size={20} />
          </span>
          <div>
            <div className="up">Business portal</div>
            <h1 style={{ fontSize: 21, marginTop: 1 }}>{data?.payee.name ?? session.name}</h1>
            <div className="tiny muted" style={{ marginTop: 2 }}>
              {session.code} · {data ? `${data.payee.city} · ${CATEGORY_META[data.payee.category].label}` : ""}
              {data?.payee.schoolLevel ? ` · ${data.payee.schoolLevel}` : ""}
              {data?.payee.verified ? " · verified" : data ? " · pending review" : ""}
            </div>
          </div>
        </div>
        <div className="row gap-8">
          <a className="btn soft sm" href={csvHref} download>
            <Icon name="download" size={13} />
            Export view
          </a>
          <button className="btn ghost sm" type="button" onClick={signOut}>
            <Icon name="lock" size={13} />
            Sign out
          </button>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat">
          <div className="k">Received</div>
          <div className="v">{data?.stats.received ?? 0}</div>
          <div className="s">in this view</div>
        </div>
        <div className="stat">
          <div className="k">Volume</div>
          <div className="v" style={{ fontSize: 17 }}>{money(data?.stats.volumeXAF ?? 0, { compact: true, suffix: false })}</div>
          <div className="s">FCFA</div>
        </div>
        <div className="stat">
          <div className="k">Today</div>
          <div className="v">{data?.stats.todayCount ?? 0}</div>
          <div className="s">{money(data?.stats.todayVolumeXAF ?? 0, { compact: true })}</div>
        </div>
        <div className="stat">
          <div className="k">Students / payers</div>
          <div className="v">{data?.stats.beneficiaries ?? 0}</div>
          <div className="s">named on receipts</div>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 14 }}>
        <div className="row gap-8" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="search" style={{ flex: "1 1 220px", position: "relative" }}>
            <Icon name="search" size={14} />
            <input
              className="input"
              placeholder="Student, customer, receipt…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search records"
            />
          </div>
          <select className="select" style={{ maxWidth: 190 }} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
            <option value="all">All reasons</option>
            {(data?.facets.reasons ?? []).map((r) => (
              <option key={r.value} value={r.value}>
                {r.value} ({r.count})
              </option>
            ))}
          </select>
          <select className="select" style={{ maxWidth: 150 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="paid">Paid</option>
            <option value="queued">Queued</option>
            <option value="declined">Declined</option>
            <option value="all">Everything</option>
          </select>
          <span className="tiny muted" style={{ marginLeft: "auto" }}>
            {loading ? "loading…" : `${data?.stats.rows ?? 0} rows`}
          </span>
        </div>

        <div className="row gap-6" style={{ flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          <span className="tiny muted" style={{ marginRight: 2 }}>Group by</span>
          {GROUP_BY.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`chip ${groupBy === g.id ? "active" : ""}`}
              onClick={() => {
                setGroupBy(g.id);
                setConstraint(null);
              }}
            >
              {g.label}
            </button>
          ))}
          {constraint && (
            <button
              type="button"
              className="chip active"
              onClick={() => setConstraint(null)}
              title="Clear filter"
              style={{ gap: 6 }}
            >
              {FIELD_LABEL[constraint.field]} · {constraint.value}
              <Icon name="x" size={10} />
            </button>
          )}
        </div>

        {(data?.groups ?? []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="up" style={{ marginBottom: 6 }}>
              {groupBy === "day" ? "Per day" : `Per ${groupBy}`}
            </div>
            <div className="stack gap-6">
              {(data?.groups ?? []).slice(0, 8).map((g) => {
                const active = constraint?.value === g.key && constraint.field === groupBy;
                const share = data && data.stats.volumeXAF > 0 ? g.totalXAF / data.stats.volumeXAF : 0;
                return (
                  <button
                    key={g.key}
                    type="button"
                    disabled={groupBy === "day"}
                    onClick={() =>
                      setConstraint(groupBy === "day" ? null : { field: groupBy as PayerField, value: g.key })
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(90px, 1.1fr) 3fr auto",
                      gap: 10,
                      alignItems: "center",
                      background: "none",
                      border: "none",
                      padding: "4px 0",
                      cursor: groupBy === "day" ? "default" : "pointer",
                      color: "inherit",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 12, color: active ? "var(--accent)" : "var(--text-2)" }} className="truncate">
                      {g.label}
                    </span>
                    <span style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
                      <span
                        style={{
                          display: "block",
                          height: "100%",
                          width: `${Math.max(4, Math.round(share * 100))}%`,
                          background: active ? "var(--accent)" : "rgba(255,203,5,.45)",
                        }}
                      />
                    </span>
                    <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>
                      {g.count}× · {money(g.totalXAF, { compact: true, suffix: false })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="panel" style={{ marginBottom: 14 }}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h2 style={{ fontSize: 15 }}>Payments</h2>
          <span className="badge muted">{data?.payments.length ?? 0} shown</span>
        </div>
        {(data?.payments ?? []).length === 0 && (
          <div className="small muted" style={{ padding: "8px 0" }}>
            No records match this view yet.
          </div>
        )}
        {(data?.payments ?? []).length > 0 && (
          <div style={{ display: "grid", gap: 0 }}>
            <div
              className="tiny muted"
              style={{
                display: "grid",
                gridTemplateColumns: "1.5fr 1.4fr 1.1fr 0.9fr 0.8fr",
                gap: 8,
                padding: "0 0 6px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span>Student / customer</span>
              <span>Reason</span>
              <span>Class · Faculty · Dept · Year</span>
              <span style={{ textAlign: "right" }}>Amount</span>
              <span style={{ textAlign: "right" }}>Receipt</span>
            </div>
            {(data?.payments ?? []).map((p) => {
              const meta = [p.payerDetails?.class, p.payerDetails?.faculty, p.payerDetails?.department, p.payerDetails?.year]
                .filter(Boolean)
                .join(" · ");
              return (
                <div
                  key={p.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.5fr 1.4fr 1.1fr 0.9fr 0.8fr",
                    gap: 8,
                    alignItems: "center",
                    padding: "8px 0",
                    borderBottom: "1px solid var(--line)",
                    opacity: p.status === "declined" ? 0.55 : 1,
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ display: "block", fontSize: 12.5 }}>
                      {p.payerFor ?? p.payerName ?? "—"}
                    </span>
                    <span className="tiny muted">{timeLabel(p.createdAt)}</span>
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ display: "block", fontSize: 12 }}>
                      {p.reason ?? "—"}
                    </span>
                    {p.payerFor && p.payerName && (
                      <span className="tiny muted">paid by {p.payerName}</span>
                    )}
                  </span>
                  <span className="tiny" style={{ color: "var(--text-2)", lineHeight: 1.4 }}>
                    {meta || "—"}
                  </span>
                  <span className="num tiny" style={{ textAlign: "right", color: p.status === "declined" ? "var(--muted)" : undefined }}>
                    {money(p.amountXAF, { suffix: false })}
                  </span>
                  <span className="mono tiny muted" style={{ textAlign: "right" }}>
                    {p.receiptNo.replace("BSP-", "")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="row-between">
          <div>
            <h2 style={{ fontSize: 15 }}>Reasons customers can pick</h2>
            <p className="tiny muted" style={{ marginTop: 3, lineHeight: 1.5 }}>
              The list the app shows when someone pays {data?.payee.name ?? "this payee"}. Reasons that ask for a student also
              collect the class or faculty details you enable.
            </p>
          </div>
          <button className="btn ghost sm" type="button" onClick={() => setEditorOpen((v) => !v)}>
            <Icon name={editorOpen ? "chevron-left" : "plus"} size={13} />
            {editorOpen ? "Close" : "Manage"}
          </button>
        </div>
        {!editorOpen && (
          <div className="row gap-6" style={{ flexWrap: "wrap", marginTop: 10 }}>
            {(data?.reasons ?? []).map((r) => (
              <span key={r.id} className="chip">
                {r.label}
                {r.askFields?.length ? <span className="tiny muted"> · {r.askFields.length} field(s)</span> : null}
              </span>
            ))}
            {(data?.reasons ?? []).length === 0 && <span className="tiny muted">No reasons published.</span>}
          </div>
        )}
        {editorOpen && data && (
          <ReasonsEditor merchantId={data.payee.id} initial={data.reasons} onSaved={() => void load(session.token)} />
        )}
      </section>

      <p className="tiny muted" style={{ marginTop: 14, lineHeight: 1.5 }}>
        Records are the payments themselves — no separate student database. Filter by reason, class, faculty, department or
        year, then export exactly that view as CSV.
      </p>
    </div>
  );
}

function ReasonsEditor({
  merchantId,
  initial,
  onSaved,
}: {
  merchantId: string;
  initial: PaymentReason[];
  onSaved: () => void;
}) {
  const [list, setList] = useState<PaymentReason[]>(initial);
  const [label, setLabel] = useState("");
  const [askStudent, setAskStudent] = useState(true);
  const [fields, setFields] = useState<PayerField[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setList(initial), [initial]);

  const add = () => {
    if (label.trim().length < 2 || list.length >= 8) return;
    setList((current) => [
      ...current,
      {
        id: `draft_${current.length + 1}`,
        label: label.trim(),
        ...(askStudent ? { askStudent: true } : {}),
        ...(fields.length ? { askFields: fields } : {}),
      },
    ]);
    setLabel("");
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await apiJson<{ message: string }>("/api/reasons", {
        method: "POST",
        body: JSON.stringify({ merchantId, reasons: list }),
      });
      setMessage(res.message);
      onSaved();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack gap-10" style={{ marginTop: 12 }}>
      <div className="stack gap-8">
        {list.map((r) => (
          <div key={r.id} className="row gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12.5, minWidth: 150 }}>{r.label}</span>
            <label className="tiny muted row gap-5" style={{ alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={Boolean(r.askStudent)}
                onChange={(e) =>
                  setList((current) =>
                    current.map((x) => (x.id === r.id ? { ...x, askStudent: e.target.checked || undefined } : x)),
                  )
                }
              />
              asks student
            </label>
            {(["class", "faculty", "department", "year"] as PayerField[]).map((f) => (
              <label key={f} className="tiny muted row gap-5" style={{ alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(r.askFields?.includes(f))}
                  onChange={(e) =>
                    setList((current) =>
                      current.map((x) => {
                        if (x.id !== r.id) return x;
                        const set = new Set(x.askFields ?? []);
                        if (e.target.checked) set.add(f);
                        else set.delete(f);
                        const askFields = [...set];
                        return { ...x, askFields: askFields.length ? askFields : undefined };
                      }),
                    )
                  }
                />
                {FIELD_LABEL[f]}
              </label>
            ))}
            <button
              type="button"
              className="btn ghost xs"
              style={{ marginLeft: "auto" }}
              onClick={() => setList((current) => current.filter((x) => x.id !== r.id))}
              aria-label={`Remove ${r.label}`}
            >
              <Icon name="x" size={11} />
            </button>
          </div>
        ))}
      </div>

      <div className="row gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="input"
          placeholder="New reason, e.g. Bus pass"
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          style={{ flex: "1 1 200px" }}
        />
        <label className="tiny muted row gap-5" style={{ alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={askStudent} onChange={(e) => setAskStudent(e.target.checked)} />
          asks student
        </label>
        {(["class", "faculty", "department", "year"] as PayerField[]).map((f) => (
          <label key={f} className="tiny muted row gap-5" style={{ alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={fields.includes(f)}
              onChange={(e) =>
                setFields((current) => (e.target.checked ? [...current, f] : current.filter((x) => x !== f)))
              }
            />
            {FIELD_LABEL[f]}
          </label>
        ))}
        <button className="btn ghost sm" type="button" onClick={add} disabled={label.trim().length < 2 || list.length >= 8}>
          <Icon name="plus" size={13} />
          Add
        </button>
      </div>

      <div className="row gap-8" style={{ alignItems: "center" }}>
        <button className="btn primary sm" type="button" onClick={() => void save()} disabled={busy}>
          <Icon name="check" size={13} />
          {busy ? "Saving…" : "Save reasons"}
        </button>
        {message && <span className="tiny muted">{message}</span>}
      </div>
    </div>
  );
}
