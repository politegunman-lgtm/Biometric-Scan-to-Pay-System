"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { apiJson } from "@/lib/client";
import { CATEGORY_META } from "@/lib/format";
import type { MerchantCategory } from "@/lib/types";

interface EnrolType {
  id: string;
  label: string;
  kind: "business" | "service";
  category: MerchantCategory;
  asksSchoolLevel?: boolean;
}

interface SchoolLevel {
  id: "primary" | "secondary" | "university";
  label: string;
  hint: string;
}

interface EnrolMeta {
  types: EnrolType[];
  levels: SchoolLevel[];
  cities: string[];
  newest: { id: string; name: string; category: MerchantCategory; tagline: string | null }[];
}

interface EnrolResult {
  merchant: {
    id: string;
    name: string;
    code: string;
    category: MerchantCategory;
    city: string;
    schoolLevel: string | null;
  };
  message: string;
}

const LEVEL_LABEL: Record<string, string> = {
  primary: "Primary school",
  secondary: "Secondary school",
  university: "University",
};

const EMPTY = {
  name: "",
  type: "shop",
  city: "Yaoundé",
  area: "",
  phone: "",
  about: "",
  schoolLevel: "secondary",
  pin: "",
  pinConfirm: "",
};

export default function JoinPage() {
  const [meta, setMeta] = useState<EnrolMeta | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<EnrolResult | null>(null);

  const needsLevel = meta?.types.find((t) => t.id === form.type)?.asksSchoolLevel ?? false;
  const pinMismatch = form.pinConfirm.length === 4 && form.pin !== form.pinConfirm;
  const canSubmit =
    form.name.trim().length >= 2 && /^\d{4}$/.test(form.pin) && form.pin === form.pinConfirm && !busy;

  useEffect(() => {
    void apiJson<EnrolMeta>("/api/enroll")
      .then((data) => {
        setMeta(data);
        setForm((f) => ({ ...f, city: data.cities[0] ?? "Yaoundé" }));
      })
      .catch(() =>
        setMeta({
          types: [],
          levels: [],
          cities: ["Yaoundé"],
          newest: [],
        }),
      );
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiJson<EnrolResult>("/api/enroll", { method: "POST", body: JSON.stringify(form) });
      setDone(res);
      setForm((f) => ({ ...f, pin: "", pinConfirm: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enrol this business");
    } finally {
      setBusy(false);
    }
  };

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
            <div className="up">Business enrolment</div>
            <h1 style={{ fontSize: 21, marginTop: 1 }}>Get listed as a payee</h1>
          </div>
        </div>
        <div className="row gap-8">
          <Link href="/merchant" className="btn ghost sm">
            <Icon name="store" size={13} />
            Terminal
          </Link>
          <Link href="/" className="btn ghost sm">
            <Icon name="chevron-left" size={14} />
            Wallet app
          </Link>
        </div>
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0,1.35fr) minmax(0,1fr)" }} className="join-grid">
        <section className="panel">
          {done ? (
            <div className="stack gap-12">
              <div className="row gap-10" style={{ alignItems: "center" }}>
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(75,221,160,.12)",
                    color: "var(--mint)",
                  }}
                >
                  <Icon name="shield-check" size={18} />
                </span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{done.merchant.name} is live</div>
                  <div className="tiny muted">
                    {done.merchant.city}
                    {done.merchant.schoolLevel ? ` · ${LEVEL_LABEL[done.merchant.schoolLevel] ?? done.merchant.schoolLevel}` : ""} · the
                    PIN you chose
                  </div>
                </div>
              </div>

              <div className="panel" style={{ padding: 14, background: "rgba(255,203,5,.06)", borderColor: "rgba(255,203,5,.28)" }}>
                <div className="row-between">
                  <div>
                    <div className="up">your payee code</div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 26, letterSpacing: ".16em", marginTop: 2 }}>
                      {done.merchant.code}
                    </div>
                  </div>
                  <span className="badge accent">issued by Scan to Pay</span>
                </div>
                <p className="tiny muted" style={{ marginTop: 8, lineHeight: 1.55 }}>
                  This code is generated for this organisation alone and is never reissued to another business. Sign in with
                  it and the 4-digit PIN you just set — we never ask anyone to pick their own code, and the PIN is yours to
                  change.
                </p>
              </div>
              <p className="small muted" style={{ lineHeight: 1.6 }}>
                Schools, clinics and utilities start with a ready-made list of <strong>reasons for payment</strong> — edit it
                in the merchant terminal under <em>Payment reasons</em>; reasons flagged <em>asks student</em> also prompt the
                payer for a student name. A university&rsquo;s reasons ask for faculty, department and year; a primary or
                secondary school&rsquo;s ask for the class. Customers can now find this business in the app&apos;s <strong>Bills</strong> tab,
                enter an amount and pay with a fingerprint. Nothing about the payment pipeline changes: a signed request is minted, the biometric match and the
                fraud engine run, and the receipt is issued. The listing shows a <em>new</em> badge until a reviewer confirms the
                registration.
              </p>
              <div className="btn-row">
                <Link className="btn primary sm" href={`/scan?tab=services&q=${encodeURIComponent(done.merchant.name)}`}>
                  <Icon name="fingerprint" size={13} />
                  Pay it as a customer
                </Link>
                <Link className="btn soft sm" href="/business">
                  <Icon name="store" size={13} />
                  Open the business portal
                </Link>
                <Link className="btn ghost sm" href="/merchant">
                  <Icon name="qr" size={13} />
                  Counter terminal
                </Link>
                <button
                  className="btn ghost sm"
                  type="button"
                  onClick={() => {
                    setDone(null);
                    setForm(EMPTY);
                  }}
                >
                  Enrol another
                </button>
              </div>
            </div>
          ) : (
            <form className="stack gap-12" onSubmit={submit}>
              <div className="row-between">
                <h2 style={{ fontSize: 15 }}>Business details</h2>
                <span className="badge accent">free</span>
              </div>

              <div className="field">
                <label htmlFor="biz-name">Trading name</label>
                <input
                  id="biz-name"
                  className="input"
                  placeholder="Nkoldongo Pharmacy"
                  value={form.name}
                  maxLength={48}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="biz-type">What is it?</label>
                <select
                  id="biz-type"
                  className="select"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  {(meta?.types ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {needsLevel && (
                <div className="field">
                  <label htmlFor="biz-level">Which kind of school?</label>
                  <select
                    id="biz-level"
                    className="select"
                    value={form.schoolLevel}
                    onChange={(e) => setForm({ ...form, schoolLevel: e.target.value })}
                  >
                    {(meta?.levels ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <span className="tiny muted">
                    {(meta?.levels ?? []).find((l) => l.id === form.schoolLevel)?.hint ??
                      "Decides whether payers are asked for a class or for faculty, department and year."}
                  </span>
                </div>
              )}

              <div className="row gap-10">
                <div className="field grow">
                  <label htmlFor="biz-city">City</label>
                  <select
                    id="biz-city"
                    className="select"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  >
                    {(meta?.cities ?? ["Yaoundé"]).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field grow">
                  <label htmlFor="biz-area">Neighbourhood</label>
                  <input
                    id="biz-area"
                    className="input"
                    placeholder="Bastos"
                    value={form.area}
                    maxLength={40}
                    onChange={(e) => setForm({ ...form, area: e.target.value })}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="biz-phone">Business mobile number</label>
                <input
                  id="biz-phone"
                  className="input"
                  inputMode="tel"
                  placeholder="6 55 10 02 00"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  required
                />
                <span className="tiny muted">Customers see a masked version of this number, never the full one.</span>
              </div>

              <div className="field">
                <label htmlFor="biz-about">One line customers will see</label>
                <input
                  id="biz-about"
                  className="input"
                  placeholder="Pharmacy & consultation"
                  value={form.about}
                  maxLength={70}
                  onChange={(e) => setForm({ ...form, about: e.target.value })}
                />
              </div>

              <div className="hairline" />

              <div className="row-between">
                <h2 style={{ fontSize: 14 }}>Portal access</h2>
                <span className="badge muted">code issued by us · PIN set by you</span>
              </div>
              <div className="row gap-10">
                <div className="field grow">
                  <label htmlFor="biz-pin">Choose a 4-digit PIN</label>
                  <input
                    id="biz-pin"
                    className="input"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    placeholder="••••"
                    value={form.pin}
                    maxLength={4}
                    onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                    required
                  />
                </div>
                <div className="field grow">
                  <label htmlFor="biz-pin2">Repeat the PIN</label>
                  <input
                    id="biz-pin2"
                    className="input"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    placeholder="••••"
                    value={form.pinConfirm}
                    maxLength={4}
                    onChange={(e) => setForm({ ...form, pinConfirm: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                    required
                  />
                </div>
              </div>
              <span className="tiny muted" style={{ marginTop: -6 }}>
                {pinMismatch
                  ? "The two PINs do not match yet."
                  : "Your payee code is minted by the system when you submit; you only choose the PIN that opens your portal. Seeded demo payees use 2468 until they set their own."}
              </span>

              {error && (
                <div className="row gap-8 tiny" style={{ color: "var(--coral)", alignItems: "center" }}>
                  <Icon name="alert" size={13} /> {error}
                </div>
              )}

              <button className="btn primary block" type="submit" disabled={!canSubmit}>
                <Icon name="plus" size={15} />
                {busy ? "Listing…" : "List this business"}
              </button>
              <p className="tiny muted" style={{ lineHeight: 1.5 }}>
                Demo enrolment: no registration documents are checked. Listing makes the payee payable immediately; the badge
                stays grey until verification.
              </p>
            </form>
          )}
        </section>

        <section className="panel">
          <div className="section-head" style={{ marginBottom: 10 }}>
            <h2 style={{ fontSize: 14 }}>How customers pay you</h2>
            <span className="badge muted">one path</span>
          </div>
          <ol className="stack gap-10" style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55, paddingLeft: 18 }}>
            <li>They search the name or type in the app&apos;s Bills tab.</li>
            <li>They enter the amount — no scanner needed if they already know you.</li>
            <li>The app mints a signed request for that amount, bound to your payee code.</li>
            <li>Their fingerprint authorises it; the fraud engine scores the attempt.</li>
            <li>You get a receipt reference in the terminal, and their history shows the payment.</li>
          </ol>

          <div className="hairline" style={{ margin: "14px 0" }} />

          <div className="up" style={{ marginBottom: 8 }}>newest listings</div>
          {(meta?.newest ?? []).length === 0 && <div className="tiny muted">Nothing yet — be the first.</div>}
          <div className="stack gap-8">
            {(meta?.newest ?? []).map((m) => (
              <div key={m.id} className="row-between" style={{ fontSize: 12 }}>
                <span className="truncate" style={{ color: "var(--text-2)" }}>{m.name}</span>
                <span className="tiny" style={{ color: CATEGORY_META[m.category].color }}>
                  {CATEGORY_META[m.category].label}
                </span>
              </div>
            ))}
          </div>

          <div className="hairline" style={{ margin: "14px 0" }} />
          <p className="tiny muted" style={{ lineHeight: 1.55 }}>
            Already have a counter? Open the{" "}
            <Link href="/merchant" style={{ color: "var(--accent)" }}>
              merchant terminal
            </Link>{" "}
            to mint a signed QR for a one-off sale.
          </p>
        </section>
      </div>
    </div>
  );
}
