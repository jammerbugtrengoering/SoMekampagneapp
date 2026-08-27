import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Calendar, Check, ChevronLeft, ChevronRight, Image as ImageIcon,
  Loader2, LogOut, Plus, RefreshCw, Send, Sparkles, Trash2, Users, X,
} from "lucide-react";
import { supabase, kaldApi, opsaetningsfejl } from "./supabaseClient";
import {
  FORMATER, base64TilBlob, foersteLinje, tegnSkabelon, uploadBillede,
} from "./billeder";
import { byggPrompt, laesOpslag, tidspunkt } from "./prompt";

/* =====================================================================
   Kampagneapp — planlægger og publicerer opslag for flere kunder.

   Samme opbygning som Planning-App og Medarbejder-App: Vite + React,
   inline styles-objekt, login med e-mail og adgangskode, og adgangen
   håndhævet i databasen frem for i skærmbilledet.

   Alt der kræver en hemmelighed — Claude-nøglen, Meta-tokens,
   krypteringsnøglen — ligger i Netlify-funktionerne. Browseren her
   kender kun anon-nøglen, og RLS er den reelle grænse.
   ===================================================================== */

const STATUS = {
  draft:          { navn: "Kladde",    bg: "#F1F5F9", fg: "#475569" },
  needs_approval: { navn: "Afventer",  bg: "#FEF3C7", fg: "#92400E" },
  approved:       { navn: "Godkendt",  bg: "#DBEAFE", fg: "#1E40AF" },
  publishing:     { navn: "Sender",    bg: "#E0E7FF", fg: "#3730A3" },
  published:      { navn: "Publiceret",bg: "#D1FAE5", fg: "#065F46" },
  failed:         { navn: "Fejlet",    bg: "#FEE2E2", fg: "#991B1B" },
};

const PLATFORM = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn" };
const PLATFORM_KORT = { facebook: "FB", instagram: "IG", linkedin: "LI" };

const UGEDAGE = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

/* ---------------------------------------------------------------------
   Dato-hjælpere. Alt regnes i lokal tid — et opslag kl. 01:00 dansk tid
   skal ligge på den danske dag, ikke på UTC-dagen før.
   --------------------------------------------------------------------- */

const pad = (n) => String(n).padStart(2, "0");

function datoNoegle(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function maanedNoegle(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function flytMaaned(noegle, delta) {
  const [aar, m] = noegle.split("-").map(Number);
  return maanedNoegle(new Date(aar, m - 1 + delta, 1));
}

function tilInputVaerdi(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${datoNoegle(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function visTid(iso) {
  if (!iso) return "Ikke planlagt";
  return new Date(iso).toLocaleString("da-DK", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const manglerBillede = (opslag) =>
  !opslag.image_url && (opslag.maal ?? []).some((m) => m.platform === "instagram");

/* =====================================================================
   Rod: session, login, nulstilling af adgangskode
   ===================================================================== */

export default function App() {
  // Uden Supabase-variablerne kan resten af appen ikke starte. Vis hvad der
  // mangler i stedet for en hvid side.
  if (opsaetningsfejl) return <Opsaetningsfejl besked={opsaetningsfejl} />;

  return <AppMedSession />;
}

function Opsaetningsfejl({ besked }) {
  return (
    <div style={styles.loginWrap}>
      <div style={styles.loginKort}>
        <AlertTriangle size={26} color="#B45309" />
        <h1 style={styles.loginTitel}>Appen er ikke sat op</h1>
        <p style={{ ...styles.loginSub, marginBottom: 12 }}>{besked}</p>
        <p style={styles.dæmpetLille}>
          Kører du lokalt, mangler værdien i <code>.env</code>. Er det et deploy,
          skal den stå under <strong>Site configuration → Environment variables</strong> i
          Netlify — og du skal <strong>bygge igen bagefter</strong>. Vite læser
          <code> VITE_</code>-variabler når buildet kører, ikke når siden åbnes, så
          det hjælper ikke at sætte dem på et færdigt deploy.
        </p>
      </div>
    </div>
  );
}

function AppMedSession() {
  const [session, setSession] = useState(null);
  const [klar, setKlar] = useState(false);
  const [nulstil, setNulstil] = useState(false);

  useEffect(() => {
    // Kommer man fra et "nulstil adgangskode"-link, ligger tokenet i
    // hash-fragmentet. detectSessionInUrl er slået fra, så vi tager det selv.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const type = hash.get("type");
    const token = hash.get("token_hash") ?? hash.get("access_token");

    if (type === "recovery" && hash.get("token_hash")) {
      supabase.auth
        .verifyOtp({ token_hash: hash.get("token_hash"), type: "recovery" })
        .then(({ error }) => {
          if (!error) setNulstil(true);
          window.history.replaceState({}, "", window.location.pathname);
        });
    } else if (type === "recovery" && token) {
      setNulstil(true);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setKlar(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((haendelse, s) => {
      setSession(s);
      if (haendelse === "PASSWORD_RECOVERY") setNulstil(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!klar) return <Fuldskaerm><Loader2 size={20} className="spin" /> Henter…</Fuldskaerm>;
  if (nulstil) return <VaelgAdgangskode onFaerdig={() => setNulstil(false)} />;
  if (!session) return <LogInd />;

  return <Kampagneapp session={session} onLogUd={() => supabase.auth.signOut()} />;
}

function Fuldskaerm({ children }) {
  return (
    <div style={{ ...styles.app, alignItems: "center", justifyContent: "center", gap: 10, flexDirection: "row" }}>
      {children}
    </div>
  );
}

function LogInd() {
  const [email, setEmail] = useState("");
  const [kode, setKode] = useState("");
  const [fejl, setFejl] = useState("");
  const [info, setInfo] = useState("");
  const [venter, setVenter] = useState(false);

  async function logInd() {
    if (!email.trim() || !kode) return;
    setVenter(true); setFejl(""); setInfo("");

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: kode,
    });

    setVenter(false);
    if (error) {
      setFejl(
        error.message === "Invalid login credentials"
          ? "E-mail eller adgangskode passer ikke."
          : error.message,
      );
    }
  }

  async function glemtKode() {
    if (!email.trim()) { setFejl("Skriv din e-mail først."); return; }
    setVenter(true); setFejl(""); setInfo("");

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });

    setVenter(false);
    if (error) setFejl(error.message);
    else setInfo("Vi har sendt et link til at vælge en ny adgangskode.");
  }

  return (
    <div style={styles.loginWrap}>
      <div style={styles.loginKort}>
        <div style={styles.loginMark}>SK</div>
        <h1 style={styles.loginTitel}>Kampagner</h1>
        <p style={styles.loginSub}>Planlægning og publicering på Facebook og Instagram</p>

        <label style={styles.label} htmlFor="email">E-mail</label>
        <input
          id="email" type="email" autoComplete="username" style={styles.input}
          value={email} onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") logInd(); }}
        />

        <label style={styles.label} htmlFor="kode">Adgangskode</label>
        <input
          id="kode" type="password" autoComplete="current-password" style={styles.input}
          value={kode} onChange={(e) => setKode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") logInd(); }}
        />

        {fejl && <p style={styles.fejlBoks}>{fejl}</p>}
        {info && <p style={styles.okBoks}>{info}</p>}

        <button
          style={{ ...styles.primaryBtn, width: "100%", justifyContent: "center", marginTop: 6 }}
          disabled={venter || !email.trim() || !kode} onClick={logInd}
        >
          {venter ? "Logger ind…" : "Log ind"}
        </button>

        <button style={styles.linkBtn} onClick={glemtKode} disabled={venter}>
          Glemt adgangskode?
        </button>
      </div>
    </div>
  );
}

function VaelgAdgangskode({ onFaerdig }) {
  const [k1, setK1] = useState("");
  const [k2, setK2] = useState("");
  const [fejl, setFejl] = useState("");
  const [venter, setVenter] = useState(false);

  async function gem() {
    if (k1.length < 10) { setFejl("Brug mindst 10 tegn."); return; }
    if (k1 !== k2) { setFejl("De to felter er ikke ens."); return; }

    setVenter(true); setFejl("");
    const { error } = await supabase.auth.updateUser({ password: k1 });
    setVenter(false);

    if (error) setFejl(error.message);
    else onFaerdig();
  }

  return (
    <div style={styles.loginWrap}>
      <div style={styles.loginKort}>
        <h1 style={styles.loginTitel}>Vælg ny adgangskode</h1>
        <p style={styles.loginSub}>Mindst 10 tegn.</p>

        <label style={styles.label} htmlFor="k1">Ny adgangskode</label>
        <input id="k1" type="password" autoComplete="new-password" style={styles.input}
          value={k1} onChange={(e) => setK1(e.target.value)} />

        <label style={styles.label} htmlFor="k2">Gentag</label>
        <input id="k2" type="password" autoComplete="new-password" style={styles.input}
          value={k2} onChange={(e) => setK2(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") gem(); }} />

        {fejl && <p style={styles.fejlBoks}>{fejl}</p>}

        <button style={{ ...styles.primaryBtn, width: "100%", justifyContent: "center", marginTop: 6 }}
          disabled={venter} onClick={gem}>
          {venter ? "Gemmer…" : "Gem og fortsæt"}
        </button>
      </div>
    </div>
  );
}

/* =====================================================================
   Selve appen
   ===================================================================== */

function Kampagneapp({ session, onLogUd }) {
  const [erAdmin, setErAdmin] = useState(null);
  const [side, setSide] = useState("kalender");
  const [maaned, setMaaned] = useState(() => maanedNoegle(new Date()));
  const [valgtKampagne, setValgtKampagne] = useState(null);
  const [valgtKunde, setValgtKunde] = useState(null);

  const [brands, setBrands] = useState([]);
  const [kanaler, setKanaler] = useState([]);
  const [kampagner, setKampagner] = useState([]);
  const [opslag, setOpslag] = useState([]);
  const [henter, setHenter] = useState(true);

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const visToast = useCallback((tekst, ok = true) => {
    setToast({ tekst, ok });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Adgangen håndhæves i databasen, men vi spørger også her — ellers får
  // brugeren en side fuld af tomme lister uden at forstå hvorfor.
  useEffect(() => {
    supabase
      .from("app_admins")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data }) => setErAdmin(!!data));
  }, [session.user.id]);

  const hentAlt = useCallback(async () => {
    setHenter(true);

    const [b, k, c, p] = await Promise.all([
      supabase.from("brands").select("*").order("name"),
      supabase.from("channels").select("*").order("platform"),
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      supabase
        .from("posts")
        .select("*, post_targets(id, status, error, permalink, channel_id, channels(platform, display_name))")
        .order("scheduled_at", { ascending: true }),
    ]);

    setBrands(b.data ?? []);
    setKanaler(k.data ?? []);
    setKampagner(c.data ?? []);
    setOpslag(
      (p.data ?? []).map((o) => ({
        ...o,
        maal: (o.post_targets ?? []).map((m) => ({
          id: m.id,
          status: m.status,
          fejl: m.error,
          permalink: m.permalink,
          platform: m.channels?.platform ?? "?",
          kanalNavn: m.channels?.display_name ?? "",
        })),
      })),
    );
    setHenter(false);
  }, []);

  useEffect(() => { if (erAdmin) hentAlt(); }, [erAdmin, hentAlt]);

  if (erAdmin === null) {
    return <Fuldskaerm><Loader2 size={20} /> Tjekker adgang…</Fuldskaerm>;
  }

  if (!erAdmin) {
    return (
      <div style={styles.loginWrap}>
        <div style={styles.loginKort}>
          <AlertTriangle size={26} color="#B45309" />
          <h1 style={styles.loginTitel}>Ingen adgang</h1>
          <p style={styles.loginSub}>
            Du er logget ind som <strong>{session.user.email}</strong>, men din bruger er ikke
            administrator i kampagneappen. Bed en administrator om at tilføje dig.
          </p>
          <button style={{ ...styles.secondaryBtn, width: "100%", justifyContent: "center" }} onClick={onLogUd}>
            <LogOut size={15} /> Log ud
          </button>
        </div>
      </div>
    );
  }

  const brandFor = (id) => brands.find((b) => b.id === id);
  const kanalerFor = (id) => kanaler.filter((k) => k.brand_id === id);

  const afventer = opslag.filter((o) => o.status === "needs_approval").length;

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.brand}>
          <div style={styles.brandMark}>SK</div>
          <div>
            <div style={styles.brandTitle}>Kampagner</div>
            <div style={styles.brandSub}>{brands.length} kunder · {opslag.length} opslag</div>
          </div>
        </div>

        <nav style={styles.nav}>
          {[
            ["kalender", "Kalender", Calendar],
            ["ny", "Ny kampagne", Sparkles],
            ["kampagner", "Kampagner", Send],
            ["kunder", "Kunder", Users],
          ].map(([id, mrk, Ikon]) => (
            <button
              key={id}
              style={side === id ? styles.navBtnActive : styles.navBtn}
              onClick={() => setSide(id)}
            >
              <Ikon size={14} style={{ marginRight: 5, verticalAlign: -2 }} />
              {mrk}
              {id === "kampagner" && afventer > 0 && (
                <span style={styles.navTal}>{afventer}</span>
              )}
            </button>
          ))}
          <button style={styles.navBtn} onClick={hentAlt} title="Hent forfra">
            <RefreshCw size={14} />
          </button>
          <button style={{ ...styles.navBtn, color: "#9BB4F5", borderLeft: "1px solid #333", paddingLeft: 12 }} onClick={onLogUd}>
            <LogOut size={14} style={{ verticalAlign: -2, marginRight: 5 }} /> Log ud
          </button>
        </nav>
      </header>

      {toast && (
        <div style={{ ...styles.toast, background: toast.ok ? "#111111" : "#991B1B" }}>
          {toast.tekst}
        </div>
      )}

      <main style={styles.page}>
        {henter ? (
          <p style={styles.dæmpet}><Loader2 size={15} style={{ verticalAlign: -2 }} /> Henter data…</p>
        ) : side === "kalender" ? (
          <Kalender
            maaned={maaned} setMaaned={setMaaned} opslag={opslag} brands={brands}
            kanaler={kanaler}
            aabnKampagne={(id) => { setValgtKampagne(id); setSide("kampagner"); }}
            gaaTilNy={() => setSide("ny")}
          />
        ) : side === "ny" ? (
          <NyKampagne
            brands={brands} kanalerFor={kanalerFor} visToast={visToast}
            efterOprettelse={async (id) => {
              await hentAlt();
              setValgtKampagne(id);
              setSide("kampagner");
            }}
          />
        ) : side === "kampagner" ? (
          <Kampagner
            kampagner={kampagner} opslag={opslag} brandFor={brandFor}
            valgt={valgtKampagne} setValgt={setValgtKampagne}
            visToast={visToast} genindlaes={hentAlt}
          />
        ) : (
          <Kunder
            brands={brands} kanalerFor={kanalerFor}
            valgt={valgtKunde ?? brands[0]?.id} setValgt={setValgtKunde}
            visToast={visToast} genindlaes={hentAlt}
          />
        )}
      </main>
    </div>
  );
}

/* =====================================================================
   Kalender
   ===================================================================== */

function Kalender({ maaned, setMaaned, opslag, brands, kanaler, aabnKampagne, gaaTilNy }) {
  const [aar, m] = maaned.split("-").map(Number);

  const celler = useMemo(() => {
    const foerste = new Date(aar, m - 1, 1);
    const forskyd = (foerste.getDay() + 6) % 7; // 0 = mandag
    const start = new Date(aar, m - 1, 1 - forskyd);

    const perDag = new Map();
    for (const o of opslag) {
      if (!o.scheduled_at) continue;
      const n = datoNoegle(new Date(o.scheduled_at));
      if (perDag.has(n)) perDag.get(n).push(o);
      else perDag.set(n, [o]);
    }

    const ud = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      ud.push({ dato: d, iMaaned: d.getMonth() === m - 1, liste: perDag.get(datoNoegle(d)) ?? [] });
    }
    // Klip sidste uge væk hvis den ligger helt uden for måneden.
    return ud[35].iMaaned ? ud : ud.slice(0, 35);
  }, [aar, m, opslag]);

  const iDag = datoNoegle(new Date());
  const afventer = opslag.filter((o) => o.status === "needs_approval").length;
  const udenBillede = opslag.filter(manglerBillede).length;
  const utestede = kanaler.filter((k) => k.active && !k.last_verified_at).length;

  const titel = new Date(`${maaned}-01T00:00:00`).toLocaleDateString("da-DK", {
    month: "long", year: "numeric",
  });

  return (
    <>
      <div style={styles.toolbar}>
        <div style={styles.vaerktoejNav}>
          <button style={styles.ikonBtn} onClick={() => setMaaned(flytMaaned(maaned, -1))}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ ...styles.h1, textTransform: "capitalize", minWidth: 180, textAlign: "center" }}>
            {titel}
          </span>
          <button style={styles.ikonBtn} onClick={() => setMaaned(flytMaaned(maaned, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <button style={styles.primaryBtn} onClick={gaaTilNy}>
          <Plus size={15} /> Ny kampagne
        </button>
      </div>

      <div style={styles.talRaekke}>
        <Nøgletal mrk="Planlagt" tal={opslag.length} />
        <Nøgletal mrk="Afventer godkendelse" tal={afventer} advarsel={afventer > 0} />
        <Nøgletal mrk="Mangler billede" tal={udenBillede} kritisk={udenBillede > 0} />
        <Nøgletal mrk="Kanaler uden test" tal={utestede} advarsel={utestede > 0} />
      </div>

      <div style={styles.kalender}>
        <div style={styles.kalHoved}>
          {UGEDAGE.map((d) => <div key={d} style={styles.kalHovedCelle}>{d}</div>)}
        </div>
        <div style={styles.kalKrop}>
          {celler.map(({ dato, iMaaned, liste }, i) => {
            const n = datoNoegle(dato);
            return (
              <div
                key={n}
                style={{
                  ...styles.kalCelle,
                  opacity: iMaaned ? 1 : 0.4,
                  background: n === iDag ? "#EEF2FE" : "#fff",
                  borderRight: (i + 1) % 7 === 0 ? "none" : "1px solid #E7EAF3",
                }}
              >
                <div style={{ ...styles.kalDag, fontWeight: n === iDag ? 700 : 400 }}>
                  {dato.getDate()}
                </div>
                {liste.map((o) => {
                  const farve = brands.find((b) => b.id === o.brand_id)?.colors?.primary ?? "#64748B";
                  const st = STATUS[o.status] ?? STATUS.draft;
                  return (
                    <button
                      key={o.id}
                      style={{ ...styles.kalChip, borderLeft: `3px solid ${farve}`, background: `${farve}14` }}
                      onClick={() => o.campaign_id && aabnKampagne(o.campaign_id)}
                    >
                      <span style={styles.kalChipTid}>
                        {new Date(o.scheduled_at).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}
                        {" · "}
                        {(o.maal ?? []).map((mm) => PLATFORM_KORT[mm.platform]).join(" ")}
                      </span>
                      <span style={styles.kalChipTekst}>{o.body.split("\n")[0]}</span>
                      <span style={{ ...styles.mærkat, background: st.bg, color: st.fg }}>{st.navn}</span>
                      {manglerBillede(o) && (
                        <span style={{ ...styles.mærkat, background: "#FEE2E2", color: "#991B1B", marginLeft: 3 }}>
                          uden billede
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div style={styles.forklaring}>
        {brands.map((b) => (
          <span key={b.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 16 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: b.colors?.primary ?? "#64748B", display: "block" }} />
            {b.name}
          </span>
        ))}
      </div>
    </>
  );
}

function Nøgletal({ mrk, tal, advarsel, kritisk }) {
  return (
    <div style={styles.talKort}>
      <div style={styles.talMrk}>{mrk}</div>
      <div style={{ ...styles.talVaerdi, color: kritisk ? "#B91C1C" : advarsel ? "#B45309" : "#111111" }}>
        {tal}
      </div>
    </div>
  );
}

/* =====================================================================
   Ny kampagne
   ===================================================================== */

function NyKampagne({ brands, kanalerFor, visToast, efterOprettelse }) {
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [navn, setNavn] = useState("");
  const [brief, setBrief] = useState("");
  const [maal, setMaal] = useState("");
  const [start, setStart] = useState(datoNoegle(new Date()));
  const [slut, setSlut] = useState("");
  const [antal, setAntal] = useState(5);
  const [valgte, setValgte] = useState(["facebook", "instagram"]);
  const [prompt, setPrompt] = useState("");
  const [svar, setSvar] = useState("");
  const [kopieret, setKopieret] = useState(false);
  const [venter, setVenter] = useState(false);
  const [fejl, setFejl] = useState("");

  const brand = brands.find((b) => b.id === brandId);
  const kundensKanaler = brandId ? kanalerFor(brandId) : [];
  const tilgaengelige = [...new Set(kundensKanaler.filter((k) => k.active).map((k) => k.platform))];

  function skift(p) {
    setValgte((v) => (v.includes(p) ? v.filter((x) => x !== p) : [...v, p]));
  }

  function byg() {
    setFejl("");
    if (!navn.trim() || !brief.trim()) { setFejl("Udfyld navn og brief."); return; }
    if (!valgte.length) { setFejl("Vælg mindst én kanal."); return; }

    setPrompt(byggPrompt({
      brand, navn: navn.trim(), brief: brief.trim(), maal: maal.trim(),
      antal, kanaler: valgte, start, slut,
    }));
    setKopieret(false);
  }

  async function kopier() {
    try {
      await navigator.clipboard.writeText(prompt);
      setKopieret(true);
      setTimeout(() => setKopieret(false), 3000);
    } catch {
      setFejl("Kunne ikke kopiere automatisk. Markér teksten og tryk Cmd+C.");
    }
  }

  async function opret() {
    setFejl("");

    let opslag;
    try {
      opslag = laesOpslag(svar, valgte);
    } catch (e) {
      setFejl(e.message);
      return;
    }

    setVenter(true);

    const { data: kampagne, error: kampagneFejl } = await supabase
      .from("campaigns")
      .insert({
        brand_id: brandId, name: navn.trim(), brief: brief.trim(),
        goal: maal.trim() || null, starts_on: start, ends_on: slut || null, status: "draft",
      })
      .select().single();

    if (kampagneFejl || !kampagne) {
      setVenter(false);
      setFejl(kampagneFejl?.message ?? "Kunne ikke oprette kampagnen.");
      return;
    }

    let oprettede = 0;
    for (const o of opslag) {
      const { data: raekke } = await supabase
        .from("posts")
        .insert({
          campaign_id: kampagne.id, brand_id: brandId, body: o.tekst,
          hashtags: o.hashtags, image_brief: o.billedbrief,
          scheduled_at: tidspunkt(start, o.dag, o.klokke), status: "needs_approval",
        })
        .select().single();

      if (!raekke) continue;
      oprettede++;

      const maalRaekker = kundensKanaler
        .filter((k) => k.active && o.kanaler.includes(k.platform))
        .map((k) => ({ post_id: raekke.id, channel_id: k.id }));

      if (maalRaekker.length) await supabase.from("post_targets").insert(maalRaekker);
    }

    setVenter(false);
    visToast(`${oprettede} opslag oprettet som kladder.`);
    efterOprettelse(kampagne.id);
  }

  if (!brands.length) {
    return <p style={styles.dæmpet}>Ingen kunder endnu. Kør <code>npm run db:setup</code>.</p>;
  }

  return (
    <>
      <h1 style={styles.h1}>Ny kampagne</h1>
      <p style={styles.dæmpet}>
        Byg briefen her, kør den gennem Claude, og indsæt svaret tilbage.
      </p>

      <div style={{ ...styles.toKolonner, marginTop: 16 }}>
        <div style={styles.kort}>
          <h2 style={styles.h2}>1 · Briefen</h2>
          <p style={styles.dæmpetLille}>Tone og forbud kommer fra brandprofilen — du skriver kun sagen.</p>

          <div style={{ marginTop: 14 }}>
            <Felt mrk="Kunde">
              <select style={styles.input} value={brandId}
                onChange={(e) => { setBrandId(e.target.value); setPrompt(""); }}>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Felt>

            <Felt mrk="Kampagnenavn">
              <input style={styles.input} value={navn} onChange={(e) => setNavn(e.target.value)}
                placeholder="fx Hovedrengøring efterår" />
            </Felt>

            <Felt mrk="Brief">
              <textarea style={{ ...styles.input, minHeight: 110, fontFamily: "inherit" }}
                value={brief} onChange={(e) => setBrief(e.target.value)}
                placeholder="Skriv det som du ville sige det til en kollega." />
            </Felt>

            <Felt mrk="Mål (valgfrit)">
              <input style={styles.input} value={maal} onChange={(e) => setMaal(e.target.value)}
                placeholder="fx 5 forespørgsler på gennemgang" />
            </Felt>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Felt mrk="Start" bredde={150}>
                <input type="date" style={styles.input} value={start} onChange={(e) => setStart(e.target.value)} />
              </Felt>
              <Felt mrk="Slut" bredde={150}>
                <input type="date" style={styles.input} value={slut} onChange={(e) => setSlut(e.target.value)} />
              </Felt>
              <Felt mrk="Antal opslag" bredde={120}>
                <input type="number" min={1} max={20} style={styles.input}
                  value={antal} onChange={(e) => setAntal(Number(e.target.value))} />
              </Felt>
            </div>

            <Felt mrk="Kanaler">
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13.5 }}>
                {["facebook", "instagram", "linkedin"].map((p) => {
                  const findes = tilgaengelige.includes(p);
                  return (
                    <label key={p} style={{ display: "flex", alignItems: "center", gap: 6, opacity: findes ? 1 : 0.45 }}>
                      <input type="checkbox" checked={valgte.includes(p)} disabled={!findes}
                        onChange={() => skift(p)} />
                      {PLATFORM[p]}
                      {!findes && <span style={styles.dæmpetLille}>(ikke sat op)</span>}
                    </label>
                  );
                })}
              </div>
            </Felt>
          </div>

          <button style={styles.primaryBtn} onClick={byg}>
            <Sparkles size={15} /> Byg prompt
          </button>

          {brand && (
            <dl style={styles.definitioner}>
              <dt style={styles.dt}>Tone</dt><dd style={styles.dd}>{brand.tone_of_voice || "—"}</dd>
              <dt style={styles.dt}>Må ikke</dt>
              <dd style={{ ...styles.dd, borderLeft: "2px solid #B91C1C", paddingLeft: 10 }}>
                {brand.guardrails || "Ikke udfyldt — så har Claude ingen grænser at holde sig indenfor."}
              </dd>
            </dl>
          )}
        </div>

        <div style={styles.kort}>
          <h2 style={styles.h2}>2 · Kør den gennem Claude</h2>

          {!prompt ? (
            <p style={styles.dæmpet}>Udfyld briefen og tryk <strong>Byg prompt</strong>.</p>
          ) : (
            <>
              <p style={styles.dæmpetLille}>
                Kopiér, indsæt i Claude, og sæt hele svaret ind nedenunder. Prompten beder om
                JSON — indsæt gerne svaret som det er, kodeblok og det hele.
              </p>

              <textarea readOnly value={prompt}
                style={{ ...styles.input, minHeight: 150, marginTop: 10, fontSize: 12,
                  fontFamily: "ui-monospace, Menlo, monospace" }} />

              <button style={{ ...styles.secondaryBtn, marginTop: 8 }} onClick={kopier}>
                {kopieret ? <><Check size={15} /> Kopieret</> : "Kopiér prompt"}
              </button>

              <h2 style={{ ...styles.h2, marginTop: 22 }}>3 · Indsæt svaret</h2>
              <textarea value={svar} onChange={(e) => setSvar(e.target.value)}
                placeholder={'{\n  "opslag": [ … ]\n}'}
                style={{ ...styles.input, minHeight: 150, marginTop: 8, fontSize: 12,
                  fontFamily: "ui-monospace, Menlo, monospace" }} />

              <button style={{ ...styles.primaryBtn, marginTop: 10 }}
                disabled={venter || !svar.trim()} onClick={opret}>
                {venter ? <><Loader2 size={15} /> Opretter…</> : "Opret opslag"}
              </button>
              <p style={styles.dæmpetLille}>
                Opslagene bliver kladder der afventer godkendelse. Der publiceres intet.
              </p>
            </>
          )}

          {fejl && <p style={styles.fejlBoks}>{fejl}</p>}
        </div>
      </div>
    </>
  );
}

function Felt({ mrk, hjaelp, bredde, children }) {
  return (
    <div style={{ marginBottom: 14, width: bredde, flex: bredde ? "0 0 auto" : undefined }}>
      <label style={styles.label}>{mrk}</label>
      {children}
      {hjaelp && <p style={styles.dæmpetLille}>{hjaelp}</p>}
    </div>
  );
}

/* =====================================================================
   Kampagner og opslag
   ===================================================================== */

function Kampagner({ kampagner, opslag, brandFor, valgt, setValgt, visToast, genindlaes }) {
  const aktuel = kampagner.find((k) => k.id === valgt) ?? kampagner[0];

  if (!kampagner.length) {
    return <p style={styles.dæmpet}>Ingen kampagner endnu.</p>;
  }

  const liste = opslag.filter((o) => o.campaign_id === aktuel?.id);
  const brand = aktuel ? brandFor(aktuel.brand_id) : null;
  const afventer = liste.filter((o) => o.status === "needs_approval").length;

  return (
    <>
      <div style={styles.toolbar}>
        <select style={{ ...styles.input, maxWidth: 420 }} value={aktuel?.id ?? ""}
          onChange={(e) => setValgt(e.target.value)}>
          {kampagner.map((k) => (
            <option key={k.id} value={k.id}>
              {brandFor(k.brand_id)?.name} — {k.name}
            </option>
          ))}
        </select>
      </div>

      {aktuel && (
        <>
          <h1 style={styles.h1}>{aktuel.name}</h1>
          <p style={styles.dæmpet}>
            <i style={{ width: 10, height: 10, borderRadius: 3, display: "inline-block",
              background: brand?.colors?.primary ?? "#64748B", marginRight: 7 }} />
            {brand?.name}
            {aktuel.starts_on && ` · fra ${aktuel.starts_on}`}
            {` · ${liste.length} opslag`}
            {afventer > 0 && ` · ${afventer} afventer godkendelse`}
          </p>

          {aktuel.brief && (
            <div style={{ ...styles.kort, marginTop: 14 }}>
              <div style={styles.dt}>Brief</div>
              <p style={{ margin: "4px 0 0", fontSize: 14, color: "#334155" }}>{aktuel.brief}</p>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            {liste.map((o) => (
              <OpslagKort key={o.id} opslag={o} brand={brand} visToast={visToast} genindlaes={genindlaes} />
            ))}
          </div>

          {!liste.length && <p style={styles.dæmpet}>Kampagnen har ingen opslag.</p>}
        </>
      )}
    </>
  );
}

function OpslagKort({ opslag, brand, visToast, genindlaes }) {
  const [aaben, setAaben] = useState(false);
  const [venter, setVenter] = useState("");
  const [tekst, setTekst] = useState(opslag.body);
  const [tags, setTags] = useState((opslag.hashtags ?? []).join(" "));
  const [billedUrl, setBilledUrl] = useState(opslag.image_url ?? "");
  const [tid, setTid] = useState(tilInputVaerdi(opslag.scheduled_at));
  const [vaelger, setVaelger] = useState(false);

  const st = STATUS[opslag.status] ?? STATUS.draft;
  const blokeret = manglerBillede(opslag);

  async function saetBillede(url) {
    const { error } = await supabase.from("posts").update({ image_url: url }).eq("id", opslag.id);
    if (error) { visToast(error.message, false); return; }
    setBilledUrl(url);
    await genindlaes();
  }

  async function gem() {
    setVenter("gem");
    const { error } = await supabase
      .from("posts")
      .update({
        body: tekst,
        hashtags: tags.split(/[\s,]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean),
        image_url: billedUrl.trim() || null,
        scheduled_at: tid ? new Date(tid).toISOString() : null,
      })
      .eq("id", opslag.id);
    setVenter("");

    if (error) visToast(error.message, false);
    else { visToast("Gemt."); setAaben(false); await genindlaes(); }
  }

  async function saetStatus(status) {
    if (status === "approved" && blokeret) {
      visToast("Opslaget skal ud på Instagram og mangler et billede.", false);
      return;
    }
    setVenter(status);
    const { error } = await supabase.from("posts").update({ status }).eq("id", opslag.id);
    setVenter("");

    if (error) visToast(error.message, false);
    else { visToast(status === "approved" ? "Godkendt." : "Godkendelse trukket."); await genindlaes(); }
  }

  async function publicerNu() {
    if (blokeret) {
      visToast("Instagram afviser opslag uden billede.", false);
      return;
    }
    setVenter("publicer");
    const svar = await kaldApi("publicer-opslag", { opslagId: opslag.id });
    setVenter("");

    visToast(svar.ok ? svar.besked : (svar.besked ?? svar.fejl), svar.ok);
    await genindlaes();
  }

  async function slet() {
    setVenter("slet");
    const { error } = await supabase.from("posts").delete().eq("id", opslag.id);
    setVenter("");
    if (error) visToast(error.message, false);
    else { visToast("Slettet."); await genindlaes(); }
  }

  const farve = brand?.colors?.primary ?? "#64748B";

  return (
    <article style={{ ...styles.kort, borderLeft: `3px solid ${farve}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ ...styles.mærkat, background: st.bg, color: st.fg }}>{st.navn}</span>
        <span style={styles.dæmpetLille}>{visTid(opslag.scheduled_at)}</span>
        {(opslag.maal ?? []).map((m) => (
          <span key={m.id} style={{ ...styles.mærkat, background: "#F1F5F9", color: "#475569" }}
            title={m.fejl ?? undefined}>
            {PLATFORM_KORT[m.platform]}
            {m.status === "published" ? " ✓" : m.status === "failed" ? " ⚠" : ""}
          </span>
        ))}
        {blokeret && (
          <span style={{ ...styles.mærkat, background: "#FEE2E2", color: "#991B1B" }}>
            Instagram kræver billede
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button style={styles.linkBtnLille} onClick={() => setAaben(!aaben)}>
          {aaben ? <><X size={13} /> Luk</> : "Redigér"}
        </button>
      </div>

      {aaben ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea style={{ ...styles.input, minHeight: 150 }} className="opslagstekst"
            value={tekst} onChange={(e) => setTekst(e.target.value)} />
          <input style={styles.input} value={tags} onChange={(e) => setTags(e.target.value)}
            placeholder="hashtags adskilt af mellemrum" />
          <input style={styles.input} value={billedUrl} onChange={(e) => setBilledUrl(e.target.value)}
            placeholder="Offentlig billed-URL — Meta henter selv billedet" />
          <input type="datetime-local" style={styles.input} value={tid} onChange={(e) => setTid(e.target.value)} />
          <button style={styles.primaryBtn} disabled={venter === "gem"} onClick={gem}>
            {venter === "gem" ? "Gemmer…" : "Gem ændringer"}
          </button>
        </div>
      ) : (
        <>
          <p className="opslagstekst" style={{ margin: 0, fontSize: 16, maxWidth: "62ch" }}>{opslag.body}</p>
          {(opslag.hashtags ?? []).length > 0 && (
            <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#2F5DE0" }}>
              {opslag.hashtags.map((t) => `#${t}`).join(" ")}
            </p>
          )}
          {opslag.image_brief && (
            <div style={styles.briefBoks}>
              <ImageIcon size={15} style={{ flexShrink: 0, marginTop: 2, color: "#64748B" }} />
              <div>
                <div style={styles.dt}>Billedbrief</div>
                <div style={{ fontSize: 13.5, color: "#334155" }}>{opslag.image_brief}</div>
              </div>
            </div>
          )}
          {opslag.image_url ? (
            <img src={opslag.image_url} alt="" style={styles.miniatur} />
          ) : (
            <p style={{ ...styles.dæmpetLille, color: "#B45309" }}>Intet billede tilknyttet.</p>
          )}

          <div style={{ marginTop: 8 }}>
            <button style={styles.secondaryBtn} onClick={() => setVaelger(true)}>
              <ImageIcon size={15} /> {opslag.image_url ? "Skift billede" : "Vælg billede"}
            </button>
          </div>
        </>
      )}

      <div style={styles.opslagHandlinger}>
        {opslag.status !== "approved" && opslag.status !== "published" && (
          <button style={styles.secondaryBtn} disabled={!!venter} onClick={() => saetStatus("approved")}>
            <Check size={15} /> Godkend
          </button>
        )}
        {opslag.status === "approved" && (
          <button style={styles.secondaryBtn} disabled={!!venter} onClick={() => saetStatus("needs_approval")}>
            Træk godkendelse
          </button>
        )}
        {opslag.status !== "published" && (
          <button style={styles.primaryBtn} disabled={!!venter} onClick={publicerNu}>
            {venter === "publicer" ? <><Loader2 size={15} /> Sender…</> : <><Send size={15} /> Publicér nu</>}
          </button>
        )}
        {(opslag.maal ?? []).filter((m) => m.permalink).map((m) => (
          <a key={m.id} style={styles.secondaryBtn} href={m.permalink} target="_blank" rel="noreferrer">
            Se på {PLATFORM[m.platform]} ↗
          </a>
        ))}
        <div style={{ flex: 1 }} />
        <button style={styles.sletBtn} disabled={!!venter} onClick={slet}>
          <Trash2 size={13} /> Slet
        </button>
      </div>

      {(opslag.maal ?? []).filter((m) => m.fejl).map((m) => (
        <p key={m.id} style={{ ...styles.fejlBoks, marginTop: 10 }}>
          {m.kanalNavn || PLATFORM[m.platform]}: {m.fejl}
        </p>
      ))}

      {vaelger && brand && (
        <BilledVaelger
          brand={brand} opslag={opslag} visToast={visToast}
          onValgt={saetBillede} onLuk={() => setVaelger(false)}
        />
      )}
    </article>
  );
}

/* =====================================================================
   Billeder

   Fire veje til et billede: arkivet, upload, en skabelon tegnet i
   browseren, og en AI-baggrund. De tre første koster ingenting.
   ===================================================================== */

function BilledVaelger({ brand, opslag, visToast, onValgt, onLuk }) {
  const [fane, setFane] = useState("arkiv");
  const [arkiv, setArkiv] = useState([]);
  const [henter, setHenter] = useState(true);
  const [venter, setVenter] = useState("");
  const [fejl, setFejl] = useState("");

  const hentArkiv = useCallback(async () => {
    setHenter(true);
    const { data } = await supabase
      .from("assets").select("*").eq("brand_id", brand.id)
      .order("created_at", { ascending: false }).limit(60);
    setArkiv(data ?? []);
    setHenter(false);
  }, [brand.id]);

  useEffect(() => { hentArkiv(); }, [hentArkiv]);

  async function gem(blob, kilde, opskrift, filnavn) {
    setFejl("");
    setVenter(kilde);
    try {
      const { url } = await uploadBillede({
        brandId: brand.id, blob, kilde, opskrift, filnavn,
        altTekst: opslag ? foersteLinje(opslag.body, 120) : null,
      });
      await onValgt(url);
      visToast("Billede tilknyttet.");
      onLuk();
    } catch (e) {
      setFejl(e.message);
    } finally {
      setVenter("");
    }
  }

  const faner = [
    ["arkiv", "Arkiv"],
    ["upload", "Upload"],
    ["skabelon", "Skabelon"],
    ["ai", "AI-baggrund"],
  ];

  return (
    <div style={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onLuk(); }}>
      <div style={styles.dialog}>
        <div style={styles.dialogHoved}>
          <h2 style={{ ...styles.h2, margin: 0 }}>Billede til opslaget</h2>
          <div style={{ flex: 1 }} />
          <button style={styles.linkBtnLille} onClick={onLuk}><X size={14} /> Luk</button>
        </div>

        <div style={styles.faner}>
          {faner.map(([id, mrk]) => (
            <button key={id} style={fane === id ? styles.faneAktiv : styles.fane}
              onClick={() => { setFane(id); setFejl(""); }}>
              {mrk}
            </button>
          ))}
        </div>

        <div style={styles.dialogKrop}>
          {fejl && <p style={styles.fejlBoks}>{fejl}</p>}

          {fane === "arkiv" && (
            henter ? <p style={styles.dæmpet}>Henter arkivet…</p>
            : !arkiv.length ? (
              <p style={styles.dæmpet}>
                Arkivet er tomt. Upload et foto, eller lav et skabelon-billede.
              </p>
            ) : (
              <div style={styles.arkivGitter}>
                {arkiv.map((a) => (
                  <button key={a.id} style={styles.arkivKort}
                    onClick={async () => { await onValgt(a.url); visToast("Billede tilknyttet."); onLuk(); }}>
                    <img src={a.url} alt={a.alt_text ?? ""} style={styles.arkivBillede} />
                    <span style={styles.arkivMrk}>
                      {a.source === "skabelon" ? "skabelon" : a.source === "ai" ? "ai" : "foto"}
                    </span>
                  </button>
                ))}
              </div>
            )
          )}

          {fane === "upload" && (
            <UploadFane venter={venter === "upload"} onFil={(fil) => gem(fil, "upload", null, fil.name)} />
          )}

          {fane === "skabelon" && (
            <SkabelonFane brand={brand} opslag={opslag} arkiv={arkiv} venter={venter === "skabelon"}
              onGem={(blob, opskrift) => gem(blob, "skabelon", opskrift)} />
          )}

          {fane === "ai" && (
            <AiFane venter={venter === "ai"} onFejl={setFejl}
              onBillede={(blob, beskrivelse) => gem(blob, "ai", { beskrivelse })} />
          )}
        </div>
      </div>
    </div>
  );
}

function UploadFane({ venter, onFil }) {
  const [navn, setNavn] = useState("");

  return (
    <div>
      <p style={styles.dæmpet}>
        Kundens egne fotos. De ender i den offentlige bucket, som Meta henter fra.
      </p>
      <label style={{ ...styles.dropzone, opacity: venter ? 0.6 : 1 }}>
        <ImageIcon size={22} color="#64748B" />
        <span style={{ fontWeight: 500 }}>{venter ? "Uploader…" : "Vælg et billede"}</span>
        <span style={styles.dæmpetLille}>{navn || "JPEG eller PNG"}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }}
          disabled={venter}
          onChange={(e) => {
            const fil = e.target.files?.[0];
            if (fil) { setNavn(fil.name); onFil(fil); }
          }} />
      </label>
      <p style={styles.dæmpetLille}>
        Har du samtykke til billeder af personer? Det er ikke noget appen kan tjekke.
      </p>
    </div>
  );
}

function SkabelonFane({ brand, opslag, arkiv, venter, onGem }) {
  const [format, setFormat] = useState("kvadrat");
  const [baggrund, setBaggrund] = useState("");
  const [overskrift, setOverskrift] = useState(() => foersteLinje(opslag?.body ?? "", 90));
  const [under, setUnder] = useState("");
  const [forhaandsvisning, setForhaandsvisning] = useState(null);
  const [tegner, setTegner] = useState(false);
  const [tegnefejl, setTegnefejl] = useState("");

  const fotos = arkiv.filter((a) => a.source !== "skabelon");
  const opskrift = { format, baggrund, overskrift, under };

  const tegn = useCallback(async () => {
    setTegner(true); setTegnefejl("");
    try {
      const blob = await tegnSkabelon({
        format,
        baggrundUrl: baggrund || null,
        baggrundFarve: brand.colors?.primary ?? "#2F5DE0",
        accentFarve: brand.colors?.accent ?? "#FFFFFF",
        overskrift, underTekst: under,
        logoUrl: brand.logo_url || null,
      });
      setForhaandsvisning({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setTegnefejl(e.message);
      setForhaandsvisning(null);
    } finally {
      setTegner(false);
    }
  }, [format, baggrund, overskrift, under, brand]);

  // Ryd op efter object-URL'er, ellers holder browseren på hver eneste
  // forhåndsvisning indtil fanen lukkes.
  useEffect(() => () => { if (forhaandsvisning) URL.revokeObjectURL(forhaandsvisning.url); },
    [forhaandsvisning]);

  return (
    <div style={styles.toKolonner}>
      <div>
        <Felt mrk="Format">
          <select style={styles.input} value={format} onChange={(e) => setFormat(e.target.value)}>
            {Object.entries(FORMATER).map(([id, f]) => (
              <option key={id} value={id}>{f.navn} — {f.hint}</option>
            ))}
          </select>
        </Felt>

        <Felt mrk="Baggrund"
          hjaelp={baggrund ? "Foto med mørk gradient forneden, så teksten kan læses."
            : "Uden foto bruges kundens brandfarve som flade."}>
          <select style={styles.input} value={baggrund} onChange={(e) => setBaggrund(e.target.value)}>
            <option value="">Brandfarve (rent grafisk)</option>
            {fotos.map((a) => (
              <option key={a.id} value={a.url}>
                {a.tags?.[0] || a.alt_text?.slice(0, 40) || "Foto"}
              </option>
            ))}
          </select>
        </Felt>

        <Felt mrk="Overskrift">
          <textarea style={{ ...styles.input, minHeight: 70, fontFamily: "inherit" }}
            value={overskrift} onChange={(e) => setOverskrift(e.target.value)} />
        </Felt>

        <Felt mrk="Underrubrik (valgfri)">
          <input style={styles.input} value={under} onChange={(e) => setUnder(e.target.value)}
            placeholder="fx Ring 43 22 18 04" />
        </Felt>

        <button style={styles.secondaryBtn} onClick={tegn} disabled={tegner}>
          {tegner ? <><Loader2 size={15} /> Tegner…</> : "Vis forhåndsvisning"}
        </button>

        {tegnefejl && <p style={styles.fejlBoks}>{tegnefejl}</p>}

        {!fotos.length && (
          <p style={styles.dæmpetLille}>
            Der er ingen fotos i arkivet endnu — upload nogle, hvis du vil have foto som baggrund.
          </p>
        )}
      </div>

      <div>
        {forhaandsvisning ? (
          <>
            <img src={forhaandsvisning.url} alt="Forhåndsvisning" style={styles.forhaandsvisning} />
            <button style={{ ...styles.primaryBtn, marginTop: 10 }} disabled={venter}
              onClick={() => onGem(forhaandsvisning.blob, opskrift)}>
              {venter ? <><Loader2 size={15} /> Gemmer…</> : "Brug dette billede"}
            </button>
          </>
        ) : (
          <div style={styles.tomForhaandsvisning}>
            <ImageIcon size={26} color="#94A3B8" />
            <span style={styles.dæmpetLille}>Tryk «Vis forhåndsvisning»</span>
          </div>
        )}
      </div>
    </div>
  );
}

function AiFane({ venter, onBillede, onFejl }) {
  const [beskrivelse, setBeskrivelse] = useState("");
  const [format, setFormat] = useState("kvadrat");
  const [henter, setHenter] = useState(false);
  const [resultat, setResultat] = useState(null);

  useEffect(() => () => { if (resultat) URL.revokeObjectURL(resultat.url); }, [resultat]);

  async function generer() {
    setHenter(true);
    onFejl("");
    const svar = await kaldApi("ai-baggrund", { beskrivelse, format });
    setHenter(false);

    if (!svar.ok) { onFejl(svar.fejl); return; }

    const blob = base64TilBlob(svar.base64, svar.mimeType);
    setResultat({ blob, url: URL.createObjectURL(blob) });
  }

  return (
    <div style={styles.toKolonner}>
      <div>
        <p style={styles.dæmpet}>
          Kun baggrunde — flader, teksturer, stemninger. Ingen mennesker, ingen lokaler,
          ingen tekst i billedet.
        </p>
        <p style={styles.dæmpetLille}>
          Det er et bevidst valg. Begge kunder sælger på at være ægte og lokale, og et
          opdigtet foto af «vores folk» arbejder imod det. Læg selv tekst på bagefter med
          skabelonen.
        </p>

        <div style={{ marginTop: 14 }}>
          <Felt mrk="Format">
            <select style={styles.input} value={format} onChange={(e) => setFormat(e.target.value)}>
              {Object.entries(FORMATER).map(([id, f]) => (
                <option key={id} value={id}>{f.navn}</option>
              ))}
            </select>
          </Felt>

          <Felt mrk="Hvad skal baggrunden vise">
            <textarea style={{ ...styles.input, minHeight: 90, fontFamily: "inherit" }}
              value={beskrivelse} onChange={(e) => setBeskrivelse(e.target.value)}
              placeholder="fx Blødt morgenlys på en ren, lys flade. Rolige grå og grønne toner." />
          </Felt>

          <button style={styles.secondaryBtn} disabled={henter || !beskrivelse.trim()} onClick={generer}>
            {henter ? <><Loader2 size={15} /> Genererer…</> : <><Sparkles size={15} /> Generér baggrund</>}
          </button>
          <p style={styles.dæmpetLille}>Koster omkring 0,30–1 kr per billede.</p>
        </div>
      </div>

      <div>
        {resultat ? (
          <>
            <img src={resultat.url} alt="AI-baggrund" style={styles.forhaandsvisning} />
            <button style={{ ...styles.primaryBtn, marginTop: 10 }} disabled={venter}
              onClick={() => onBillede(resultat.blob, beskrivelse)}>
              {venter ? <><Loader2 size={15} /> Gemmer…</> : "Gem i arkivet og brug"}
            </button>
            <p style={styles.dæmpetLille}>
              Vil du have tekst på, så gem den her og vælg den som baggrund under Skabelon.
            </p>
          </>
        ) : (
          <div style={styles.tomForhaandsvisning}>
            <Sparkles size={26} color="#94A3B8" />
            <span style={styles.dæmpetLille}>Ingen baggrund endnu</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   Kunder
   ===================================================================== */

function Kunder({ brands, kanalerFor, valgt, setValgt, visToast, genindlaes }) {
  const brand = brands.find((b) => b.id === valgt) ?? brands[0];
  const [nyKanal, setNyKanal] = useState(false);

  if (!brand) return <p style={styles.dæmpet}>Ingen kunder endnu.</p>;

  return (
    <>
      <div style={styles.toolbar}>
        {brands.map((b) => (
          <button key={b.id}
            style={b.id === brand.id ? styles.primaryBtn : styles.secondaryBtn}
            onClick={() => { setValgt(b.id); setNyKanal(false); }}>
            <i style={{ width: 9, height: 9, borderRadius: 2, background: b.colors?.primary ?? "#64748B", display: "block" }} />
            {b.name}
          </button>
        ))}
      </div>

      <h1 style={styles.h1}>{brand.name}</h1>
      <p style={styles.dæmpet}>
        {brand.kind === "association" ? "Forening" : "Virksomhed"} ·{" "}
        {kanalerFor(brand.id).filter((k) => k.active).length} aktive kanaler
      </p>

      <div style={{ ...styles.toKolonner, marginTop: 16 }}>
        <Brandprofil key={brand.id} brand={brand} visToast={visToast} genindlaes={genindlaes} />

        <div>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
            <h2 style={{ ...styles.h2, margin: 0 }}>Kanaler</h2>
            <div style={{ flex: 1 }} />
            {!nyKanal && (
              <button style={styles.secondaryBtn} onClick={() => setNyKanal(true)}>
                <Plus size={14} /> Tilføj
              </button>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {kanalerFor(brand.id).map((k) => (
              <KanalKort key={k.id} kanal={k} brandId={brand.id} visToast={visToast} genindlaes={genindlaes} />
            ))}
            {nyKanal && (
              <KanalKort brandId={brand.id} visToast={visToast}
                genindlaes={async () => { setNyKanal(false); await genindlaes(); }} />
            )}
            {!kanalerFor(brand.id).length && !nyKanal && (
              <p style={styles.dæmpet}>
                Ingen kanaler. Uden en kanal kan kampagnen genereres, men ikke publiceres.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Brandprofil({ brand, visToast, genindlaes }) {
  const [felter, setFelter] = useState({
    name: brand.name,
    description: brand.description ?? "",
    target_audience: brand.target_audience ?? "",
    tone_of_voice: brand.tone_of_voice ?? "",
    guardrails: brand.guardrails ?? "",
    primary: brand.colors?.primary ?? "#2F5DE0",
  });
  const [venter, setVenter] = useState(false);

  // Formularen får brandets id som key i Kunder, så den monteres forfra når man
  // skifter kunde. Derfor ingen effekt der skal holde felterne i sync.
  const saet = (n) => (e) => setFelter((f) => ({ ...f, [n]: e.target.value }));

  async function gem() {
    setVenter(true);
    const { error } = await supabase
      .from("brands")
      .update({
        name: felter.name,
        description: felter.description,
        target_audience: felter.target_audience,
        tone_of_voice: felter.tone_of_voice,
        guardrails: felter.guardrails,
        colors: { ...(brand.colors ?? {}), primary: felter.primary },
      })
      .eq("id", brand.id);
    setVenter(false);

    if (error) visToast(error.message, false);
    else { visToast("Brandprofil gemt."); await genindlaes(); }
  }

  return (
    <div style={styles.kort}>
      <h2 style={styles.h2}>Brandprofil</h2>
      <p style={styles.dæmpetLille}>Sendes med til Claude ved hver generering.</p>

      <Felt mrk="Navn">
        <input style={styles.input} value={felter.name} onChange={saet("name")} />
      </Felt>
      <Felt mrk="Hvad de laver">
        <textarea style={{ ...styles.input, minHeight: 60, fontFamily: "inherit" }}
          value={felter.description} onChange={saet("description")} />
      </Felt>
      <Felt mrk="Målgruppe">
        <textarea style={{ ...styles.input, minHeight: 70, fontFamily: "inherit" }}
          value={felter.target_audience} onChange={saet("target_audience")} />
      </Felt>
      <Felt mrk="Tone of voice">
        <textarea style={{ ...styles.input, minHeight: 90, fontFamily: "inherit" }}
          value={felter.tone_of_voice} onChange={saet("tone_of_voice")} />
      </Felt>
      <Felt mrk="Må ikke" hjaelp="Fx samtykke til billeder af børn, forbud mod prisløfter, konkurrenter der ikke må nævnes.">
        <textarea style={{ ...styles.input, minHeight: 90, fontFamily: "inherit", borderLeft: "2px solid #B91C1C" }}
          value={felter.guardrails} onChange={saet("guardrails")} />
      </Felt>
      <Felt mrk="Primærfarve" bredde={120}>
        <input type="color" style={{ ...styles.input, height: 40, padding: 4 }}
          value={felter.primary} onChange={saet("primary")} />
      </Felt>

      <button style={styles.primaryBtn} disabled={venter} onClick={gem}>
        {venter ? "Gemmer…" : "Gem"}
      </button>
    </div>
  );
}

function KanalKort({ kanal, brandId, visToast, genindlaes }) {
  const [platform, setPlatform] = useState(kanal?.platform ?? "facebook");
  const [visningsnavn, setVisningsnavn] = useState(kanal?.display_name ?? "");
  const [pageId, setPageId] = useState(kanal?.page_id ?? "");
  const [igUserId, setIgUserId] = useState(kanal?.ig_user_id ?? "");
  const [token, setToken] = useState("");
  const [tokenLabel, setTokenLabel] = useState(kanal?.token_label ?? "");
  const [aktiv, setAktiv] = useState(kanal?.active ?? true);
  const [venter, setVenter] = useState("");

  async function gem() {
    setVenter("gem");
    const svar = await kaldApi("gem-kanal", {
      kanalId: kanal?.id, brandId, platform, visningsnavn, pageId, igUserId, token, tokenLabel, aktiv,
    });
    setVenter("");

    if (!svar.ok) visToast(svar.fejl, false);
    else { visToast(svar.besked); setToken(""); await genindlaes(); }
  }

  async function test() {
    setVenter("test");
    const svar = await kaldApi("gem-kanal", { handling: "test", kanalId: kanal.id });
    setVenter("");
    visToast(svar.ok ? svar.besked : (svar.besked ?? svar.fejl), svar.ok);
    await genindlaes();
  }

  return (
    <div style={styles.kort}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Felt mrk="Platform" bredde={170}>
          <select style={styles.input} value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="facebook">Facebook Side</option>
            <option value="instagram">Instagram</option>
            <option value="linkedin">LinkedIn (ikke aktiv)</option>
          </select>
        </Felt>
        <Felt mrk="Visningsnavn" bredde={220}>
          <input style={styles.input} value={visningsnavn} onChange={(e) => setVisningsnavn(e.target.value)} />
        </Felt>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Felt mrk="Page ID" bredde={220}>
          <input style={styles.input} value={pageId} onChange={(e) => setPageId(e.target.value)} />
        </Felt>
        {platform === "instagram" && (
          <Felt mrk="Instagram Business Account ID" bredde={260}>
            <input style={styles.input} value={igUserId} onChange={(e) => setIgUserId(e.target.value)} />
          </Felt>
        )}
      </div>

      <Felt
        mrk="Access token"
        hjaelp={kanal?.token_ciphertext
          ? "Et token er gemt og krypteret. Lad feltet stå tomt for at beholde det."
          : "Systembruger-token fra Meta Business Suite. Krypteres inden det gemmes."}
      >
        <input type="password" autoComplete="off" style={styles.input}
          placeholder={kanal?.token_ciphertext ? "••••••••" : "EAAG…"}
          value={token} onChange={(e) => setToken(e.target.value)} />
        <input style={{ ...styles.input, marginTop: 8 }} value={tokenLabel}
          onChange={(e) => setTokenLabel(e.target.value)}
          placeholder="Label, fx “system user 2026-08”" />
      </Felt>

      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, marginBottom: 12 }}>
        <input type="checkbox" checked={aktiv} onChange={(e) => setAktiv(e.target.checked)} />
        Aktiv
      </label>

      {kanal?.last_error && <p style={styles.fejlBoks}>Sidste fejl: {kanal.last_error}</p>}
      {kanal?.last_verified_at && !kanal.last_error && (
        <p style={styles.okBoks}>
          Bekræftet {new Date(kanal.last_verified_at).toLocaleString("da-DK")}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={styles.primaryBtn} disabled={!!venter} onClick={gem}>
          {venter === "gem" ? "Gemmer…" : kanal ? "Gem kanal" : "Tilføj kanal"}
        </button>
        {kanal && (
          <button style={styles.secondaryBtn} disabled={!!venter} onClick={test}>
            {venter === "test" ? <><Loader2 size={14} /> Tester…</> : "Test forbindelse"}
          </button>
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   Styles. Samme opbygning som i Planning-App, men blå accent så man kan
   se på et blik hvilken app man står i.
   ===================================================================== */

const styles = {
  app: { background: "#F4F6FC", minHeight: "100vh", color: "#111111", display: "flex", flexDirection: "column" },

  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px",
    background: "#111111", color: "#fff", flexWrap: "wrap", gap: 12, position: "sticky", top: 0, zIndex: 100 },
  brand: { display: "flex", alignItems: "center", gap: 12 },
  brandMark: { width: 36, height: 36, borderRadius: 10, background: "#2F5DE0", display: "flex",
    alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 },
  brandTitle: { fontWeight: 600, fontSize: 16 },
  brandSub: { fontSize: 12, color: "#9BB4F5" },
  nav: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
  navBtn: { padding: "8px 13px", borderRadius: 8, border: "none", background: "transparent",
    color: "#A9BEEE", cursor: "pointer", fontSize: 13.5, fontWeight: 500, display: "inline-flex", alignItems: "center" },
  navBtnActive: { padding: "8px 13px", borderRadius: 8, border: "none", background: "#2F5DE0",
    color: "#fff", cursor: "pointer", fontSize: 13.5, fontWeight: 600, display: "inline-flex", alignItems: "center" },
  navTal: { marginLeft: 6, background: "#F59E0B", color: "#111", borderRadius: 999,
    padding: "0 6px", fontSize: 11, fontWeight: 700 },

  toast: { position: "fixed", top: 74, right: 24, color: "#fff", padding: "10px 16px", borderRadius: 8,
    fontSize: 13.5, zIndex: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.22)", maxWidth: 460 },

  page: { padding: "20px 24px 60px", flex: 1, maxWidth: 1180, width: "100%", margin: "0 auto" },

  h1: { fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 4px" },
  h2: { fontSize: 16, fontWeight: 600, margin: "0 0 4px" },

  toolbar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" },
  vaerktoejNav: { display: "flex", alignItems: "center", gap: 6, background: "#fff",
    padding: "5px 7px", borderRadius: 10, boxShadow: "0 1px 2px rgba(15,23,42,0.07)" },
  ikonBtn: { border: "none", background: "#F4F6FC", color: "#111111", borderRadius: 8,
    padding: 7, cursor: "pointer", display: "flex" },

  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8,
    border: "none", background: "#2F5DE0", color: "#fff", fontWeight: 600, fontSize: 13.5,
    cursor: "pointer", textDecoration: "none", minHeight: 38 },
  secondaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8,
    border: "1px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 500, fontSize: 13.5,
    cursor: "pointer", textDecoration: "none", minHeight: 38 },
  sletBtn: { display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent",
    color: "#B91C1C", fontSize: 12.5, cursor: "pointer", padding: "6px 4px" },
  linkBtn: { border: "none", background: "transparent", color: "#2F5DE0", fontSize: 13,
    cursor: "pointer", padding: "10px 0 0", width: "100%" },
  linkBtnLille: { display: "inline-flex", alignItems: "center", gap: 4, border: "none",
    background: "transparent", color: "#64748B", fontSize: 12.5, cursor: "pointer", textDecoration: "underline" },

  kort: { background: "#fff", borderRadius: 12, padding: 18, boxShadow: "0 1px 2px rgba(15,23,42,0.07)" },
  toKolonner: { display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    alignItems: "start" },

  label: { display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5, color: "#334155" },
  input: { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #CBD5E1",
    background: "#fff", color: "#111111", fontSize: 14, fontFamily: "inherit" },

  dæmpet: { color: "#64748B", fontSize: 13.5, margin: "4px 0 0" },
  dæmpetLille: { color: "#64748B", fontSize: 12, margin: "5px 0 0" },

  fejlBoks: { background: "#FEE2E2", color: "#991B1B", padding: "8px 11px", borderRadius: 8,
    fontSize: 13, margin: "8px 0" },
  okBoks: { background: "#D1FAE5", color: "#065F46", padding: "8px 11px", borderRadius: 8,
    fontSize: 13, margin: "8px 0" },

  mærkat: { display: "inline-block", borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 600 },

  talRaekke: { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    marginBottom: 16 },
  talKort: { background: "#fff", borderRadius: 10, padding: "11px 14px",
    boxShadow: "0 1px 2px rgba(15,23,42,0.07)" },
  talMrk: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748B" },
  talVaerdi: { fontSize: 24, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" },

  kalender: { background: "#fff", borderRadius: 12, overflow: "hidden",
    boxShadow: "0 1px 2px rgba(15,23,42,0.07)" },
  kalHoved: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", background: "#F8FAFF",
    borderBottom: "1px solid #E7EAF3" },
  kalHovedCelle: { padding: "7px 10px", fontSize: 11, textTransform: "uppercase",
    letterSpacing: "0.08em", color: "#64748B" },
  kalKrop: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)" },
  kalCelle: { minHeight: 116, padding: 6, borderBottom: "1px solid #E7EAF3",
    display: "flex", flexDirection: "column", gap: 4 },
  kalDag: { fontSize: 11.5, color: "#64748B", fontVariantNumeric: "tabular-nums" },
  kalChip: { display: "block", width: "100%", textAlign: "left", border: "none",
    borderRadius: "0 5px 5px 0", padding: "4px 6px", fontSize: 11, lineHeight: 1.3,
    color: "#111111", cursor: "pointer", fontFamily: "inherit" },
  kalChipTid: { display: "block", fontSize: 10, color: "#64748B" },
  kalChipTekst: { display: "block", overflow: "hidden", textOverflow: "ellipsis",
    whiteSpace: "nowrap", margin: "1px 0 2px" },

  forklaring: { marginTop: 12, fontSize: 12.5, color: "#64748B" },

  definitioner: { display: "grid", gridTemplateColumns: "110px minmax(0, 1fr)", gap: "8px 12px",
    fontSize: 13.5, margin: "12px 0 0" },
  dt: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", color: "#64748B" },
  dd: { margin: 0, color: "#334155" },

  briefBoks: { display: "flex", gap: 9, alignItems: "flex-start", marginTop: 12,
    padding: "9px 11px", background: "#F4F6FC", borderRadius: 8 },
  miniatur: { marginTop: 10, maxHeight: 190, maxWidth: "100%", borderRadius: 8, objectFit: "cover" },
  opslagHandlinger: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
    marginTop: 14, paddingTop: 14, borderTop: "1px solid #E7EAF3" },

  // --- Billeddialog ---
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 300,
    display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px",
    overflowY: "auto" },
  dialog: { background: "#fff", borderRadius: 14, width: "100%", maxWidth: 900,
    boxShadow: "0 20px 50px rgba(15,23,42,0.28)", overflow: "hidden" },
  dialogHoved: { display: "flex", alignItems: "center", gap: 10, padding: "16px 20px 12px" },
  faner: { display: "flex", gap: 4, padding: "0 20px", borderBottom: "1px solid #E7EAF3" },
  fane: { border: "none", background: "transparent", color: "#64748B", cursor: "pointer",
    fontSize: 13.5, fontWeight: 500, padding: "9px 12px", borderBottom: "2px solid transparent",
    fontFamily: "inherit" },
  faneAktiv: { border: "none", background: "transparent", color: "#2F5DE0", cursor: "pointer",
    fontSize: 13.5, fontWeight: 600, padding: "9px 12px", borderBottom: "2px solid #2F5DE0",
    fontFamily: "inherit" },
  dialogKrop: { padding: 20 },

  arkivGitter: { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" },
  arkivKort: { position: "relative", border: "1px solid #E7EAF3", borderRadius: 10, padding: 0,
    background: "#fff", cursor: "pointer", overflow: "hidden", aspectRatio: "1 / 1" },
  arkivBillede: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  arkivMrk: { position: "absolute", left: 6, bottom: 6, background: "rgba(15,23,42,0.72)",
    color: "#fff", fontSize: 10, borderRadius: 4, padding: "1px 5px", letterSpacing: "0.03em" },

  dropzone: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
    padding: "32px 20px", border: "2px dashed #CBD5E1", borderRadius: 12, cursor: "pointer",
    background: "#F8FAFF", margin: "12px 0" },

  forhaandsvisning: { width: "100%", borderRadius: 10, display: "block",
    border: "1px solid #E7EAF3" },
  tomForhaandsvisning: { display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: 8, minHeight: 220, borderRadius: 10,
    border: "1px dashed #CBD5E1", background: "#F8FAFF" },

  loginWrap: { minHeight: "100vh", background: "#F4F6FC", display: "flex", alignItems: "center",
    justifyContent: "center", padding: 20 },
  loginKort: { background: "#fff", borderRadius: 14, padding: 30, width: "100%", maxWidth: 400,
    boxShadow: "0 10px 30px rgba(15,23,42,0.10)" },
  loginMark: { width: 40, height: 40, borderRadius: 11, background: "#2F5DE0", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14,
    marginBottom: 14 },
  loginTitel: { fontSize: 22, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.02em" },
  loginSub: { fontSize: 13.5, color: "#64748B", margin: "0 0 20px" },
};
