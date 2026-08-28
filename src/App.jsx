import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Calendar, Check, ChevronLeft, ChevronRight, Eye,
  Image as ImageIcon, Loader2, LogOut, Plus, RefreshCw, Send, Sparkles,
  Pencil, Trash2, Users, X,
} from "lucide-react";
import { supabase, kaldApi, opsaetningsfejl } from "./supabaseClient";
import {
  FORMATER, base64TilBlob, foersteLinje, tegnSkabelon, uploadBillede,
} from "./billeder";
import {
  byggOmskrivPrompt, byggPrompt, flytDage, laesOmskrivning, laesOpslag, tidspunkt,
} from "./prompt";
import { REGLER, fuldTekst, klip, tjekOpslag } from "./kanalregler";

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

  const [kunder, setKunder] = useState([]);
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

    const [ku, b, k, c, p] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("brands").select("*, customers(*)").order("name"),
      supabase.from("channels").select("*").order("platform"),
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      supabase
        .from("posts")
        .select("*, post_targets(id, status, error, permalink, channel_id, channels(platform, display_name))")
        .order("scheduled_at", { ascending: true }),
    ]);

    setKunder(ku.data ?? []);
    setBrands(b.data ?? []);
    setKanaler(k.data ?? []);
    setKampagner(c.data ?? []);
    setOpslag(
      (p.data ?? []).map((o) => ({
        ...o,
        maal: (o.post_targets ?? []).map((m) => ({
          id: m.id,
          kanalId: m.channel_id,
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
            <div style={styles.brandSub}>
              {kunder.length} kunder · {brands.length} brands · {opslag.length} opslag
            </div>
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
            kampagner={kampagner} opslag={opslag} brands={brands} kunder={kunder}
            brandFor={brandFor} kanalerFor={kanalerFor}
            valgt={valgtKampagne} setValgt={setValgtKampagne}
            visToast={visToast} genindlaes={hentAlt}
          />
        ) : (
          <Kunder
            kunder={kunder} brands={brands} kanalerFor={kanalerFor}
            valgt={valgtKunde ?? kunder[0]?.id} setValgt={setValgtKunde}
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

  /**
   * Kalder Claude på din egen maskine, så du slipper for copy/paste.
   * Virker kun under `npm run dev:api` — deployet svarer 501, og så står
   * copy/paste-vejen stadig åben nedenunder.
   */
  async function koerLokalt() {
    setFejl("");
    if (!navn.trim() || !brief.trim()) { setFejl("Udfyld navn og brief."); return; }
    if (!valgte.length) { setFejl("Vælg mindst én kanal."); return; }

    setVenter(true);
    const res = await kaldApi("claude-lokal", {
      handling: "generer", brand, navn, brief, maal,
      antal, kanaler: valgte, start, slut,
    });
    setVenter(false);

    if (!res.ok) { setFejl(res.fejl); byg(); return; }
    await opret(res.resultat);
  }

  async function opret(kilde) {
    setFejl("");

    let opslag;
    try {
      opslag = laesOpslag(kilde ?? svar, valgte);
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

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={styles.primaryBtn} disabled={venter} onClick={koerLokalt}>
              {venter ? <><Loader2 size={15} /> Claude skriver…</> : <><Sparkles size={15} /> Kør i Claude</>}
            </button>
            <button style={styles.secondaryBtn} onClick={byg}>
              Byg prompt til copy/paste
            </button>
          </div>

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
                disabled={venter || !svar.trim()} onClick={() => opret()}>
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

function Kampagner({
  kampagner, opslag, brands, kunder, brandFor, kanalerFor,
  valgt, setValgt, visToast, genindlaes,
}) {
  const [visIndex, setVisIndex] = useState(null);
  const [retter, setRetter] = useState(false);
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
        {liste.length > 0 && (
          <button style={styles.secondaryBtn} onClick={() => setVisIndex(0)}>
            <Eye size={15} /> Forhåndsvis serien
          </button>
        )}
        {aktuel && (
          <button style={styles.secondaryBtn} onClick={() => setRetter(true)}>
            <Pencil size={15} /> Ret kampagnen
          </button>
        )}
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
            {liste.map((o, i) => (
              <OpslagKort key={o.id} opslag={o} brand={brand} visToast={visToast}
                genindlaes={genindlaes} onForhaandsvis={() => setVisIndex(i)} />
            ))}
          </div>

          {!liste.length && <p style={styles.dæmpet}>Kampagnen har ingen opslag.</p>}
        </>
      )}

      {visIndex !== null && (
        <Forhaandsvisning liste={liste} startIndex={visIndex} brandFor={brandFor}
          onLuk={() => setVisIndex(null)} />
      )}

      {retter && aktuel && (
        <RetKampagne
          kampagne={aktuel} liste={liste} brand={brand}
          kanaler={kanalerFor(aktuel.brand_id)}
          brands={brands} kunder={kunder} kanalerFor={kanalerFor}
          visToast={visToast} genindlaes={genindlaes} onLuk={() => setRetter(false)}
        />
      )}
    </>
  );
}

function OpslagKort({ opslag, brand, visToast, genindlaes, onForhaandsvis }) {
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
        {onForhaandsvis && (
          <button style={styles.linkBtnLille} onClick={onForhaandsvis}>
            <Eye size={13} /> Forhåndsvis
          </button>
        )}
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
   Ret hele kampagnen

   Fire ting man reelt vil: rette felterne, flytte serien i tid, skrive
   teksterne om efter en instruks, eller starte forfra på en ny brief.

   Én regel gælder alle fire: publicerede opslag røres aldrig. De er ude i
   verden, og databasen skal fortælle sandheden om hvad der blev sendt.
   Godkendte opslag spørges der om hver gang — de er dem du har sagt god
   for, og de skal ikke ændre sig bag din ryg.
   ===================================================================== */

function inddelOpslag(liste) {
  return {
    publicerede: liste.filter((o) => o.status === "published"),
    godkendte: liste.filter((o) => o.status === "approved"),
    frie: liste.filter((o) => !["published", "approved"].includes(o.status)),
  };
}

function RetKampagne({
  kampagne, liste, brand, kanaler, brands = [], kunder = [], kanalerFor = () => [],
  visToast, genindlaes, onLuk,
}) {
  const [tilstand, setTilstand] = useState("felter");
  const [medGodkendte, setMedGodkendte] = useState(false);
  const [venter, setVenter] = useState(false);
  const [fejl, setFejl] = useState("");

  const { publicerede, godkendte, frie } = useMemo(() => inddelOpslag(liste), [liste]);
  const beroerte = medGodkendte ? [...frie, ...godkendte] : frie;

  // Felter
  const [navn, setNavn] = useState(kampagne.name ?? "");
  const [brief, setBrief] = useState(kampagne.brief ?? "");
  const [maal, setMaal] = useState(kampagne.goal ?? "");
  const [start, setStart] = useState(kampagne.starts_on ?? "");
  const [slut, setSlut] = useState(kampagne.ends_on ?? "");

  // Tid
  const [dage, setDage] = useState(7);

  // Kanaler. Startværdien er de kanaler der allerede dækker MINDST ét af de
  // berørte opslag — så et flueben betyder "alle skal ud her", og et tomt
  // felt betyder "ingen".
  const kanalDaekning = useMemo(() => {
    const tal = new Map();
    for (const o of liste) {
      for (const m of o.maal ?? []) {
        tal.set(m.kanalId ?? m.id, (tal.get(m.kanalId ?? m.id) ?? 0) + 1);
      }
    }
    return tal;
  }, [liste]);

  const [valgteKanaler, setValgteKanaler] = useState(() =>
    kanaler.filter((k) => k.active && liste.some((o) =>
      (o.maal ?? []).some((m) => m.kanalId === k.id))).map((k) => k.id),
  );

  const skiftKanal = (id) =>
    setValgteKanaler((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  // Flyt til et andet brand
  const [nytBrandId, setNytBrandId] = useState(kampagne.brand_id);

  // Platformene kampagnen bruger i dag. Det er dem der skal genfindes hos
  // modtageren — kanal-id'erne kan ikke følge med, de hører til det gamle brand.
  const brugtePlatforme = useMemo(() => {
    const s = new Set();
    for (const o of liste) for (const m of o.maal ?? []) if (m.platform && m.platform !== "?") s.add(m.platform);
    return [...s];
  }, [liste]);

  const modtagerKanaler = useMemo(
    () => (nytBrandId && nytBrandId !== kampagne.brand_id
      ? kanalerFor(nytBrandId).filter((k) => k.active)
      : []),
    [nytBrandId, kampagne.brand_id, kanalerFor],
  );

  const manglendePlatforme = brugtePlatforme
    .filter((p) => !modtagerKanaler.some((k) => k.platform === p));

  // Omskrivning og ny brief
  const [instruks, setInstruks] = useState("");
  const [prompt, setPrompt] = useState("");
  const [svar, setSvar] = useState("");
  const [kopieret, setKopieret] = useState(false);
  const [nyBrief, setNyBrief] = useState(kampagne.brief ?? "");
  const [antal, setAntal] = useState(Math.max(liste.length, 1));

  const platforme = [...new Set(kanaler.filter((k) => k.active).map((k) => k.platform))];

  async function kopier(tekst) {
    try {
      await navigator.clipboard.writeText(tekst);
      setKopieret(true);
      setTimeout(() => setKopieret(false), 3000);
    } catch {
      setFejl("Kunne ikke kopiere automatisk. Markér teksten og tryk Cmd+C.");
    }
  }

  const faerdig = async (besked) => {
    visToast(besked);
    await genindlaes();
    onLuk();
  };

  // ---- Felter ----
  async function gemFelter() {
    setFejl(""); setVenter(true);
    const { error } = await supabase
      .from("campaigns")
      .update({
        name: navn.trim(), brief: brief.trim() || null, goal: maal.trim() || null,
        starts_on: start || null, ends_on: slut || null,
      })
      .eq("id", kampagne.id);
    setVenter(false);
    if (error) return setFejl(error.message);
    faerdig("Kampagnen er rettet. Opslagene er urørte.");
  }

  // ---- Flyt i tid ----
  async function flyt() {
    setFejl("");
    if (!beroerte.length) return setFejl("Ingen opslag at flytte.");
    setVenter(true);

    for (const o of beroerte) {
      if (!o.scheduled_at) continue;
      const { error } = await supabase
        .from("posts")
        .update({ scheduled_at: flytDage(o.scheduled_at, dage) })
        .eq("id", o.id);
      if (error) { setVenter(false); return setFejl(error.message); }
    }

    // Kampagnens egne datoer følger med, ellers passer perioden ikke længere.
    const skub = (d) => (d ? flytDage(`${d}T12:00:00`, dage).slice(0, 10) : null);
    await supabase
      .from("campaigns")
      .update({ starts_on: skub(kampagne.starts_on), ends_on: skub(kampagne.ends_on) })
      .eq("id", kampagne.id);

    setVenter(false);
    faerdig(
      `${beroerte.length} opslag flyttet ${Math.abs(dage)} dage ${dage < 0 ? "tilbage" : "frem"}.`,
    );
  }

  // ---- Kanaler ----
  /**
   * Sætter kanalerne på de berørte opslag.
   *
   * Et mål der allerede er publiceret slettes ikke: opslaget ER ude på den
   * kanal, og databasen skal blive ved at fortælle sandheden om det. Fjerner
   * du en kanal, forsvinder den altså kun fra det der endnu ikke er sendt.
   */
  async function gemKanaler() {
    setFejl("");
    if (!beroerte.length) return setFejl("Ingen opslag at rette.");

    setVenter(true);
    let tilfoejet = 0, fjernet = 0, bevaret = 0;

    for (const o of beroerte) {
      const nuvaerende = new Map((o.maal ?? []).map((m) => [m.kanalId, m]));

      for (const id of valgteKanaler) {
        if (nuvaerende.has(id)) continue;
        const { error } = await supabase
          .from("post_targets").insert({ post_id: o.id, channel_id: id });
        if (error) { setVenter(false); return setFejl(error.message); }
        tilfoejet++;
      }

      for (const [id, m] of nuvaerende) {
        if (valgteKanaler.includes(id)) continue;
        if (m.status === "published") { bevaret++; continue; }
        const { error } = await supabase.from("post_targets").delete().eq("id", m.id);
        if (error) { setVenter(false); return setFejl(error.message); }
        fjernet++;
      }
    }

    setVenter(false);
    faerdig(
      [
        tilfoejet && `${tilfoejet} kanal-tilknytninger tilføjet`,
        fjernet && `${fjernet} fjernet`,
        bevaret && `${bevaret} beholdt fordi de allerede er publiceret`,
      ].filter(Boolean).join(", ") || "Ingen ændringer.",
    );
  }

  // ---- Flyt til et andet brand ----
  /**
   * Flytter hele kampagnen — kampagnen selv, alle opslag, og kanalmålene.
   *
   * Kanal-id'erne kan ikke bare følge med: en kanal hører til ét brand, og
   * målene ville pege på den forkerte Facebook-side. Derfor oversættes de på
   * platform — det gamle brands Facebook-mål bliver modtagerens Facebook-mål.
   * Har modtageren ingen kanal på den platform, bliver målet væk, og det siger
   * vi højt inden vi flytter.
   *
   * Er noget af kampagnen publiceret, flytter vi ikke. Opslaget står ude på en
   * side der tilhører det gamle brand, og den historik skal ikke omskrives.
   */
  async function flytBrand() {
    setFejl("");
    if (!nytBrandId || nytBrandId === kampagne.brand_id) {
      return setFejl("Vælg et andet brand end det kampagnen står på nu.");
    }
    if (publicerede.length) {
      return setFejl(
        `${publicerede.length} opslag er allerede publiceret under ${brand?.name}. ` +
        "En publiceret kampagne kan ikke flyttes — opret i stedet en ny kampagne på det rigtige brand.",
      );
    }

    setVenter(true);

    // Nye mål bygges FØR vi sletter de gamle, så en fejl undervejs ikke
    // efterlader opslag helt uden kanaler.
    const nyeMaal = [];
    for (const o of liste) {
      const platforme = [...new Set((o.maal ?? []).map((m) => m.platform))];
      for (const k of modtagerKanaler) {
        if (platforme.includes(k.platform)) nyeMaal.push({ post_id: o.id, channel_id: k.id });
      }
    }

    const gamleMaalIder = liste.flatMap((o) => (o.maal ?? []).map((m) => m.id));

    const trin = [
      supabase.from("campaigns").update({ brand_id: nytBrandId }).eq("id", kampagne.id),
      supabase.from("posts").update({ brand_id: nytBrandId }).eq("campaign_id", kampagne.id),
    ];
    for (const t of trin) {
      const { error } = await t;
      if (error) { setVenter(false); return setFejl(error.message); }
    }

    if (gamleMaalIder.length) {
      const { error } = await supabase.from("post_targets").delete().in("id", gamleMaalIder);
      if (error) { setVenter(false); return setFejl(error.message); }
    }
    if (nyeMaal.length) {
      const { error } = await supabase.from("post_targets").insert(nyeMaal);
      if (error) { setVenter(false); return setFejl(error.message); }
    }

    setVenter(false);
    const modtager = brands.find((b) => b.id === nytBrandId);
    faerdig(
      `${liste.length} opslag flyttet til ${modtager?.name ?? "det nye brand"}` +
      (nyeMaal.length
        ? `, med ${nyeMaal.length} kanalmål.`
        : ". Opslagene har ingen kanaler endnu — sæt dem under fanen Kanaler."),
    );
  }

  // ---- Skriv om ----
  function byggOmskriv() {
    setFejl("");
    if (!instruks.trim()) return setFejl("Skriv hvad der skal rettes.");
    if (!beroerte.length) return setFejl("Ingen opslag at skrive om.");

    setPrompt(byggOmskrivPrompt({
      brand, kampagne, instruks: instruks.trim(),
      opslag: beroerte.map((o) => ({ ...o, tekst: o.body })),
    }));
    setKopieret(false);
  }

  /** Claude på din egen maskine. Kun under `npm run dev:api`. */
  async function koerLokalt(handling) {
    setFejl("");

    const krop = handling === "omskriv"
      ? {
          handling, brand, kampagne, instruks: instruks.trim(),
          opslag: beroerte.map((o) => ({ ...o, tekst: o.body })),
        }
      : {
          handling: "generer", brand, navn: navn.trim(), brief: nyBrief.trim(),
          maal: maal.trim(), antal, kanaler: platforme,
          start: start || kampagne.starts_on, slut,
        };

    if (handling === "omskriv" && !instruks.trim()) return setFejl("Skriv hvad der skal rettes.");
    if (handling !== "omskriv" && !nyBrief.trim()) return setFejl("Skriv den nye brief.");
    if (!beroerte.length) return setFejl("Ingen opslag at rette.");

    setVenter(true);
    const res = await kaldApi("claude-lokal", krop);
    setVenter(false);

    if (!res.ok) {
      setFejl(res.fejl);
      if (handling === "omskriv") byggOmskriv(); else byggNy();
      return;
    }

    if (handling === "omskriv") await anvendOmskrivning(res.resultat);
    else await anvendNy(res.resultat);
  }

  async function anvendOmskrivning(kilde) {
    setFejl("");
    let rettelser;
    try {
      rettelser = laesOmskrivning(kilde ?? svar, beroerte.length);
    } catch (e) {
      return setFejl(e.message);
    }

    setVenter(true);
    let rettet = 0;

    for (const r of rettelser) {
      const maal = beroerte[r.nr - 1];
      if (!maal) continue;

      const felter = { body: r.tekst, hashtags: r.hashtags };
      if (r.billedbrief) felter.image_brief = r.billedbrief;
      // Var opslaget godkendt, trækkes godkendelsen — teksten er en anden nu.
      if (maal.status === "approved") felter.status = "needs_approval";

      const { error } = await supabase.from("posts").update(felter).eq("id", maal.id);
      if (error) { setVenter(false); return setFejl(error.message); }
      rettet++;
    }

    setVenter(false);
    faerdig(
      `${rettet} opslag omskrevet.` +
        (medGodkendte && godkendte.length
          ? " Godkendelsen er trukket på dem der var godkendt."
          : ""),
    );
  }

  // ---- Ny brief ----
  function byggNy() {
    setFejl("");
    if (!nyBrief.trim()) return setFejl("Skriv den nye brief.");
    if (!platforme.length) return setFejl("Kunden har ingen aktive kanaler.");

    setPrompt(byggPrompt({
      brand, navn: navn.trim(), brief: nyBrief.trim(), maal: maal.trim(),
      antal, kanaler: platforme, start: start || kampagne.starts_on, slut,
    }));
    setKopieret(false);
  }

  async function anvendNy(kilde) {
    setFejl("");
    let nye;
    try {
      nye = laesOpslag(kilde ?? svar, platforme);
    } catch (e) {
      return setFejl(e.message);
    }

    setVenter(true);

    // De gamle slettes, ikke skjules. post_targets følger med via cascade.
    for (const o of beroerte) {
      const { error } = await supabase.from("posts").delete().eq("id", o.id);
      if (error) { setVenter(false); return setFejl(error.message); }
    }

    const startDato = start || kampagne.starts_on;
    let oprettede = 0;

    for (const o of nye) {
      const { data: raekke } = await supabase
        .from("posts")
        .insert({
          campaign_id: kampagne.id, brand_id: kampagne.brand_id, body: o.tekst,
          hashtags: o.hashtags, image_brief: o.billedbrief,
          scheduled_at: tidspunkt(startDato, o.dag, o.klokke), status: "needs_approval",
        })
        .select().single();

      if (!raekke) continue;
      oprettede++;

      const maalRaekker = kanaler
        .filter((k) => k.active && o.kanaler.includes(k.platform))
        .map((k) => ({ post_id: raekke.id, channel_id: k.id }));
      if (maalRaekker.length) await supabase.from("post_targets").insert(maalRaekker);
    }

    await supabase
      .from("campaigns")
      .update({ brief: nyBrief.trim(), name: navn.trim(), goal: maal.trim() || null })
      .eq("id", kampagne.id);

    setVenter(false);
    faerdig(`${beroerte.length} gamle opslag erstattet af ${oprettede} nye.`);
  }

  const TILSTANDE = [
    ["felter", "Ret felter"],
    ["kanaler", "Kanaler"],
    ["flytbrand", "Flyt til kunde"],
    ["tid", "Flyt i tid"],
    ["omskriv", "Skriv om"],
    ["ny", "Ny brief"],
  ];

  // Flytningen tager hele kampagnen, ikke et udsnit — så tælleren "det her
  // rører" ville sige noget forkert. Den har sin egen opsummering.
  const roererOpslag = tilstand !== "felter" && tilstand !== "flytbrand";

  return (
    <div style={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onLuk(); }}>
      <div style={{ ...styles.dialog, maxWidth: 880 }}>
        <div style={styles.dialogHoved}>
          <h2 style={{ ...styles.h2, margin: 0 }}>Ret kampagnen</h2>
          <span style={styles.dæmpetLille}>{kampagne.name}</span>
          <div style={{ flex: 1 }} />
          <button style={styles.linkBtnLille} onClick={onLuk}><X size={14} /> Luk</button>
        </div>

        <div style={styles.faner}>
          {TILSTANDE.map(([id, mrk]) => (
            <button key={id} style={tilstand === id ? styles.faneAktiv : styles.fane}
              onClick={() => { setTilstand(id); setPrompt(""); setSvar(""); setFejl(""); }}>
              {mrk}
            </button>
          ))}
        </div>

        <div style={styles.dialogKrop}>
          {roererOpslag && (
            <div style={styles.omfang}>
              <div style={styles.dt}>Det her rører</div>
              <p style={{ margin: "6px 0 0", fontSize: 13.5 }}>
                <strong>{beroerte.length}</strong> opslag
                {frie.length > 0 && ` · ${frie.length} kladde/afventer`}
                {medGodkendte && godkendte.length > 0 && ` · ${godkendte.length} godkendt`}
              </p>

              {godkendte.length > 0 && (
                <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, fontSize: 13.5 }}>
                  <input type="checkbox" checked={medGodkendte}
                    onChange={(e) => setMedGodkendte(e.target.checked)} />
                  Ret også de {godkendte.length} godkendte
                  <span style={styles.dæmpetLille}>(godkendelsen trækkes)</span>
                </label>
              )}

              {publicerede.length > 0 && (
                <p style={{ ...styles.dæmpetLille, marginTop: 8 }}>
                  {publicerede.length} publiceret opslag røres ikke. De er ude i verden — skal
                  de væk, skal det ske på Facebook eller Instagram.
                </p>
              )}
            </div>
          )}

          {fejl && <p style={styles.fejlBoks}>{fejl}</p>}

          {/* ---- Ret felter ---- */}
          {tilstand === "felter" && (
            <>
              <p style={styles.dæmpet}>Opslagene står som de er. Kun kampagnens egne felter rettes.</p>
              <div style={{ marginTop: 14 }}>
                <Felt mrk="Navn">
                  <input style={styles.input} value={navn} onChange={(e) => setNavn(e.target.value)} />
                </Felt>
                <Felt mrk="Brief">
                  <textarea style={{ ...styles.input, minHeight: 90, fontFamily: "inherit" }}
                    value={brief} onChange={(e) => setBrief(e.target.value)} />
                </Felt>
                <Felt mrk="Mål">
                  <input style={styles.input} value={maal} onChange={(e) => setMaal(e.target.value)} />
                </Felt>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Felt mrk="Start" bredde={160}>
                    <input type="date" style={styles.input} value={start ?? ""}
                      onChange={(e) => setStart(e.target.value)} />
                  </Felt>
                  <Felt mrk="Slut" bredde={160}>
                    <input type="date" style={styles.input} value={slut ?? ""}
                      onChange={(e) => setSlut(e.target.value)} />
                  </Felt>
                </div>
              </div>
              <button style={styles.primaryBtn} disabled={venter} onClick={gemFelter}>
                {venter ? "Gemmer…" : "Gem"}
              </button>
            </>
          )}

          {/* ---- Kanaler ---- */}
          {tilstand === "kanaler" && (
            <>
              <p style={styles.dæmpet}>
                Sæt flueben ved de kanaler alle de berørte opslag skal ud på. Kanalerne blev
                bundet da kampagnen blev oprettet — er en kanal kommet til siden, tilføjes den her.
              </p>

              {!kanaler.filter((k) => k.active).length ? (
                <p style={{ ...styles.fejlBoks, marginTop: 14 }}>
                  Kunden har ingen aktive kanaler. Opret dem under Kunder først.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "16px 0" }}>
                  {kanaler.filter((k) => k.active).map((k) => {
                    const daekker = kanalDaekning.get(k.id) ?? 0;
                    const valgt = valgteKanaler.includes(k.id);
                    // Instagram afviser opslag uden billede — det er bedre at
                    // sige det her end at lade cron'en fejle i morgen tidlig.
                    const udenBillede = k.platform === "instagram" && valgt
                      ? beroerte.filter((o) => !o.image_url).length
                      : 0;

                    return (
                      <div key={k.id} style={styles.kanalValg}>
                        <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
                          <input type="checkbox" checked={valgt} onChange={() => skiftKanal(k.id)} />
                          <span>
                            <strong>{PLATFORM[k.platform]}</strong> · {k.display_name}
                            <br />
                            <span style={styles.dæmpetLille}>
                              {daekker === 0
                                ? "ingen opslag bruger den i dag"
                                : `${daekker} af ${liste.length} opslag bruger den i dag`}
                            </span>
                          </span>
                        </label>

                        {udenBillede > 0 && (
                          <p style={{ ...styles.advarselBoks, marginTop: 8 }}>
                            {udenBillede} af de berørte opslag har intet billede. Instagram afviser
                            dem — tilknyt billeder, ellers kan de ikke godkendes.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <button style={styles.primaryBtn} disabled={venter} onClick={gemKanaler}>
                {venter ? "Gemmer…" : `Sæt kanaler på ${beroerte.length} opslag`}
              </button>
              <p style={styles.dæmpetLille}>
                Kanaler der allerede er publiceret bliver stående, uanset fluebenet — opslaget
                er ude i verden, og det skal databasen blive ved at vise.
              </p>
            </>
          )}

          {/* ---- Flyt til kunde ---- */}
          {tilstand === "flytbrand" && (
            <>
              <p style={styles.dæmpet}>
                Flytter hele kampagnen — alle {liste.length} opslag — over på et andet brand.
                Teksterne følger med som de er; kanalmålene oversættes på platform, så
                Facebook bliver Facebook hos modtageren.
              </p>

              <div style={{ ...styles.omfang, marginTop: 14 }}>
                <div style={styles.dt}>Står nu på</div>
                <p style={{ margin: "6px 0 0", fontSize: 13.5 }}>
                  <strong>{brand?.name}</strong>
                  {brugtePlatforme.length > 0 &&
                    ` · ${brugtePlatforme.map((p) => PLATFORM[p] ?? p).join(", ")}`}
                </p>
              </div>

              <Felt mrk="Flyt til">
                <select style={styles.input} value={nytBrandId ?? ""}
                  onChange={(e) => setNytBrandId(e.target.value)}>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {kunder.find((k) => k.id === b.customer_id)?.name ?? "Uden kunde"} — {b.name}
                      {b.id === kampagne.brand_id ? " (står her nu)" : ""}
                    </option>
                  ))}
                </select>
              </Felt>

              {publicerede.length > 0 ? (
                <p style={styles.fejlBoks}>
                  {publicerede.length} af opslagene er publiceret under {brand?.name}. Kampagnen
                  kan ikke flyttes — opslagene er ude på den gamle sides væg, og det skal
                  databasen blive ved at vise. Lav en ny kampagne på det rigtige brand i stedet.
                </p>
              ) : (
                <>
                  {nytBrandId !== kampagne.brand_id && manglendePlatforme.length > 0 && (
                    <p style={styles.advarselBoks}>
                      Modtageren har ingen aktiv kanal på{" "}
                      {manglendePlatforme.map((p) => PLATFORM[p] ?? p).join(" og ")}. Opslagene
                      flyttes alligevel, men står uden kanal indtil du opretter den under Kunder
                      og sætter fluebenet under Kanaler.
                    </p>
                  )}
                  <p style={styles.dæmpetLille}>
                    Bemærk: teksterne blev skrevet til {brand?.name}s tone. Passer de ikke til
                    modtageren, så kør en omskrivning bagefter under fanen Skriv om.
                  </p>
                  <button style={styles.primaryBtn}
                    disabled={venter || nytBrandId === kampagne.brand_id}
                    onClick={flytBrand}>
                    {venter ? "Flytter…" : `Flyt ${liste.length} opslag`}
                  </button>
                </>
              )}
            </>
          )}

          {/* ---- Flyt i tid ---- */}
          {tilstand === "tid" && (
            <>
              <p style={styles.dæmpet}>
                Alle berørte opslag rykkes lige meget, så den indbyrdes afstand bevares.
                Klokkeslæt beholdes.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>
                {[-14, -7, -1, 1, 7, 14].map((d) => (
                  <button key={d} style={dage === d ? styles.primaryBtn : styles.secondaryBtn}
                    onClick={() => setDage(d)}>
                    {d > 0 ? `+${d}` : d} dage
                  </button>
                ))}
              </div>
              <Felt mrk="Eller et andet antal dage" bredde={200}>
                <input type="number" style={styles.input} value={dage}
                  onChange={(e) => setDage(Number(e.target.value))} />
              </Felt>

              {beroerte.length > 0 && beroerte[0].scheduled_at && (
                <p style={styles.dæmpetLille}>
                  Første opslag flytter fra {visTid(beroerte[0].scheduled_at)}
                  {" til "}{visTid(flytDage(beroerte[0].scheduled_at, dage))}.
                </p>
              )}

              <button style={{ ...styles.primaryBtn, marginTop: 12 }} disabled={venter} onClick={flyt}>
                {venter ? "Flytter…" : `Flyt ${beroerte.length} opslag`}
              </button>
            </>
          )}

          {/* ---- Skriv om / ny brief ---- */}
          {(tilstand === "omskriv" || tilstand === "ny") && (
            <div style={styles.toKolonner}>
              <div>
                {tilstand === "omskriv" ? (
                  <>
                    <p style={styles.dæmpet}>
                      De nuværende opslag sendes med, så Claude retter dem frem for at
                      skrive nye. Tidspunkter og kanaler ændres ikke.
                    </p>
                    <Felt mrk="Hvad skal rettes"
                      hjaelp="fx «gør dem kortere og mindre formelle» eller «flyt telefonnummeret op i starten»">
                      <textarea style={{ ...styles.input, minHeight: 100, fontFamily: "inherit" }}
                        value={instruks} onChange={(e) => setInstruks(e.target.value)} />
                    </Felt>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button style={styles.primaryBtn} disabled={venter}
                        onClick={() => koerLokalt("omskriv")}>
                        {venter ? <><Loader2 size={15} /> Claude retter…</>
                          : <><Sparkles size={15} /> Kør i Claude</>}
                      </button>
                      <button style={styles.secondaryBtn} onClick={byggOmskriv}>
                        Byg prompt
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p style={styles.dæmpet}>
                      Hele serien skrives forfra. De {beroerte.length} berørte opslag
                      <strong> slettes</strong> og erstattes.
                    </p>
                    <Felt mrk="Ny brief">
                      <textarea style={{ ...styles.input, minHeight: 100, fontFamily: "inherit" }}
                        value={nyBrief} onChange={(e) => setNyBrief(e.target.value)} />
                    </Felt>
                    <Felt mrk="Antal opslag" bredde={140}>
                      <input type="number" min={1} max={20} style={styles.input}
                        value={antal} onChange={(e) => setAntal(Number(e.target.value))} />
                    </Felt>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button style={styles.primaryBtn} disabled={venter}
                        onClick={() => koerLokalt("ny")}>
                        {venter ? <><Loader2 size={15} /> Claude skriver…</>
                          : <><Sparkles size={15} /> Kør i Claude</>}
                      </button>
                      <button style={styles.secondaryBtn} onClick={byggNy}>
                        Byg prompt
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div>
                {!prompt ? (
                  <div style={styles.tomForhaandsvisning}>
                    <span style={styles.dæmpetLille}>Tryk «Byg prompt»</span>
                  </div>
                ) : (
                  <>
                    <textarea readOnly value={prompt}
                      style={{ ...styles.input, minHeight: 130, fontSize: 12,
                        fontFamily: "ui-monospace, Menlo, monospace" }} />
                    <button style={{ ...styles.secondaryBtn, marginTop: 8 }}
                      onClick={() => kopier(prompt)}>
                      {kopieret ? <><Check size={15} /> Kopieret</> : "Kopiér prompt"}
                    </button>

                    <div style={{ marginTop: 16 }}>
                      <label style={styles.label}>Indsæt svaret</label>
                      <textarea value={svar} onChange={(e) => setSvar(e.target.value)}
                        placeholder={'{\n  "opslag": [ … ]\n}'}
                        style={{ ...styles.input, minHeight: 130, fontSize: 12,
                          fontFamily: "ui-monospace, Menlo, monospace" }} />
                    </div>

                    <button style={{ ...styles.primaryBtn, marginTop: 10 }}
                      disabled={venter || !svar.trim()}
                      onClick={() => (tilstand === "omskriv" ? anvendOmskrivning() : anvendNy())}>
                      {venter ? <><Loader2 size={15} /> Retter…</>
                        : tilstand === "omskriv" ? "Anvend rettelserne"
                        : `Erstat ${beroerte.length} opslag`}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   Forhåndsvisning

   Viser opslaget som det læses i et feed — men vigtigst: hvor teksten
   bliver klippet. Det skjulte stykke vises nedtonet i stedet for at være
   væk, så du kan se præcis hvad der forsvinder bag «Se mere».

   Det er en attrap i vores eget værktøj, ikke en efterligning af
   platformene. Derfor står der «Forhåndsvisning» i toppen, og der er
   hverken logoer eller varemærker.
   ===================================================================== */

function Forhaandsvisning({ liste, startIndex, brandFor, onLuk }) {
  const [index, setIndex] = useState(startIndex);
  const [visning, setVisning] = useState("mobil");
  const opslag = liste[index];
  const brand = opslag ? brandFor(opslag.brand_id) : null;

  // Kanaler opslaget faktisk skal ud på; ellers Facebook som udgangspunkt.
  const platforme = useMemo(() => {
    const p = [...new Set((opslag?.maal ?? []).map((m) => m.platform))].filter((x) => REGLER[x]);
    return p.length ? p : ["facebook"];
  }, [opslag]);

  const [platform, setPlatform] = useState(platforme[0]);

  // Foldet ud eller ej. Foldet sammen er sandheden: sådan møder folk opslaget
  // i feedet. Udfoldet viser resten nedtonet, så man kan se præcis hvad der
  // lå bagved — det er dét man skal bruge når man retter teksten.
  const [udfoldet, setUdfoldet] = useState(false);

  useEffect(() => {
    if (!platforme.includes(platform)) setPlatform(platforme[0]);
  }, [platforme, platform]);

  // Nyt opslag, ny kanal, ny skærmstørrelse: fold sammen igen, ellers ser man
  // det næste opslag udfoldet og tror det ikke bliver klippet. Rettet under
  // render frem for i en effect, så der ikke blinker et udfoldet opslag forbi.
  const visningsnoegle = `${index}|${platform}|${visning}`;
  const [sidsteNoegle, setSidsteNoegle] = useState(visningsnoegle);
  if (sidsteNoegle !== visningsnoegle) {
    setSidsteNoegle(visningsnoegle);
    setUdfoldet(false);
  }

  const gaa = useCallback(
    (retning) => setIndex((i) => Math.min(Math.max(i + retning, 0), liste.length - 1)),
    [liste.length],
  );

  // Piletaster. Det er hele pointen med at kunne bladre igennem serien:
  // man ser rytmen mellem opslagene, ikke bare det enkelte.
  useEffect(() => {
    const tast = (e) => {
      if (e.key === "ArrowRight") gaa(1);
      else if (e.key === "ArrowLeft") gaa(-1);
      else if (e.key === "Escape") onLuk();
    };
    window.addEventListener("keydown", tast);
    return () => window.removeEventListener("keydown", tast);
  }, [gaa, onLuk]);

  if (!opslag) return null;

  const regel = REGLER[platform];
  const tekst = fuldTekst(opslag);
  const graense = visning === "mobil" ? regel.klipMobil : regel.klipDesktop;
  const { synlig, skjult, klippet } = klip(tekst, graense);
  const advarsler = tjekOpslag(opslag, platform);

  const farve = brand?.colors?.primary ?? "#64748B";
  const initialer = (brand?.name ?? "?").split(/\s+/).map((o) => o[0]).slice(0, 2).join("").toUpperCase();
  const kanalNavn = (opslag.maal ?? []).find((m) => m.platform === platform)?.kanalNavn
    || brand?.name || "Din side";

  return (
    <div style={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onLuk(); }}>
      <div style={{ ...styles.dialog, maxWidth: 940 }}>
        <div style={styles.dialogHoved}>
          <h2 style={{ ...styles.h2, margin: 0 }}>Forhåndsvisning</h2>
          <span style={styles.dæmpetLille}>
            {index + 1} af {liste.length} · piletaster bladrer
          </span>
          <div style={{ flex: 1 }} />
          <button style={styles.ikonBtn} disabled={index === 0} onClick={() => gaa(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button style={styles.ikonBtn} disabled={index === liste.length - 1} onClick={() => gaa(1)}>
            <ChevronRight size={16} />
          </button>
          <button style={styles.linkBtnLille} onClick={onLuk}><X size={14} /> Luk</button>
        </div>

        <div style={styles.faner}>
          {platforme.map((p) => (
            <button key={p} style={platform === p ? styles.faneAktiv : styles.fane}
              onClick={() => setPlatform(p)}>
              {REGLER[p].navn}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {["mobil", "computer"].map((v) => (
            <button key={v} style={visning === v ? styles.faneAktiv : styles.fane}
              onClick={() => setVisning(v)}>
              {v === "mobil" ? "Mobil" : "Computer"}
            </button>
          ))}
        </div>

        <div style={styles.dialogKrop}>
          <div style={styles.toKolonner}>
            {/* ---- Feed-attrappen ---- */}
            <div style={{ maxWidth: visning === "mobil" ? 400 : "100%", margin: "0 auto", width: "100%" }}>
              <div style={styles.feedKort}>
                <div style={styles.feedHoved}>
                  <span style={{ ...styles.feedAvatar, background: farve }}>{initialer}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.feedNavn}>{kanalNavn}</div>
                    <div style={styles.feedTid}>
                      {opslag.scheduled_at
                        ? new Date(opslag.scheduled_at).toLocaleString("da-DK", {
                            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                          })
                        : "Ikke planlagt"}
                      {" · "}Alle
                    </div>
                  </div>
                </div>

                {platform === "instagram" && opslag.image_url && (
                  <img src={opslag.image_url} alt="" style={styles.feedBilledeFoerst} />
                )}

                <p style={styles.feedTekst}>
                  {synlig}
                  {klippet && !udfoldet && (
                    <>
                      {"… "}
                      <button type="button" style={styles.feedSeMere}
                        onClick={() => setUdfoldet(true)}>
                        Se mere
                      </button>
                    </>
                  )}
                  {klippet && udfoldet && (
                    <>
                      <span style={styles.feedSkjult}>{skjult}</span>
                      {"  "}
                      <button type="button" style={styles.feedSeMere}
                        onClick={() => setUdfoldet(false)}>
                        Vis mindre
                      </button>
                    </>
                  )}
                </p>

                {platform !== "instagram" && opslag.image_url && (
                  <img src={opslag.image_url} alt="" style={styles.feedBillede} />
                )}

                {platform !== "instagram" && !opslag.image_url && (
                  <div style={styles.feedUdenBillede}>
                    <ImageIcon size={18} color="#94A3B8" />
                    <span style={styles.dæmpetLille}>Uden billede</span>
                  </div>
                )}

                <div style={styles.feedHandlinger}>
                  <span>Synes godt om</span><span>Kommentér</span><span>Del</span>
                </div>
              </div>

              {klippet && (
                <p style={styles.dæmpetLille}>
                  {udfoldet
                    ? `Det nedtonede så ingen uden at trykke — ${skjult.trim().length} tegn.`
                    : `${skjult.trim().length} tegn ligger bag «Se mere». Tryk for at se dem.`}
                  {visning === "mobil"
                    ? ` Mobil klipper ved ${graense} tegn.`
                    : ` Computer klipper ved ${graense} tegn.`}
                </p>
              )}
            </div>

            {/* ---- Tal og advarsler ---- */}
            <div>
              <div style={styles.talRaekke}>
                <Nøgletal mrk="Tegn" tal={tekst.length}
                  advarsel={tekst.length > regel.maks * 0.9} kritisk={tekst.length > regel.maks} />
                <Nøgletal mrk="Hashtags" tal={(opslag.hashtags ?? []).length}
                  kritisk={(opslag.hashtags ?? []).length > regel.maksHashtags} />
                <Nøgletal mrk="Synligt før klip" tal={klippet ? synlig.length : tekst.length} />
              </div>

              {advarsler.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {advarsler.map((a, i) => (
                    <p key={i} style={
                      a.grad === "stop" ? styles.fejlBoks
                      : a.grad === "advarsel" ? styles.advarselBoks
                      : { ...styles.dæmpetLille, margin: 0 }
                    }>
                      {a.tekst}
                    </p>
                  ))}
                </div>
              ) : (
                <p style={styles.okBoks}>Ingen indvendinger til {regel.navn}.</p>
              )}

              <dl style={styles.definitioner}>
                <dt style={styles.dt}>Kunde</dt><dd style={styles.dd}>{brand?.name ?? "—"}</dd>
                <dt style={styles.dt}>Status</dt>
                <dd style={styles.dd}>{(STATUS[opslag.status] ?? STATUS.draft).navn}</dd>
                <dt style={styles.dt}>Kanaler</dt>
                <dd style={styles.dd}>
                  {(opslag.maal ?? []).map((m) => PLATFORM[m.platform]).join(", ") || "ingen"}
                </dd>
                {opslag.image_brief && (
                  <>
                    <dt style={styles.dt}>Billedbrief</dt>
                    <dd style={styles.dd}>{opslag.image_brief}</dd>
                  </>
                )}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
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
    // Brandets egne billeder OG kundens fælles arkiv. Firmabiler og
    // medarbejdere passer til flere af kundens brands.
    const filter = brand.customer_id
      ? `brand_id.eq.${brand.id},customer_id.eq.${brand.customer_id}`
      : `brand_id.eq.${brand.id}`;

    const { data } = await supabase
      .from("assets").select("*").or(filter)
      .order("created_at", { ascending: false }).limit(60);
    setArkiv(data ?? []);
    setHenter(false);
    // customer_id skal med: flytter du brandet til en anden kunde, er det et
    // andet fælles arkiv der gælder — uden den ville listen blive hængende.
  }, [brand.id, brand.customer_id]);

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

function Kunder({ kunder, brands, kanalerFor, valgt, setValgt, visToast, genindlaes }) {
  const [fane, setFane] = useState("stamkort");
  const [nytBrand, setNytBrand] = useState(false);
  const [nyKunde, setNyKunde] = useState(false);

  const kunde = kunder.find((k) => k.id === valgt) ?? kunder[0];
  const kundensBrands = kunde ? brands.filter((b) => b.customer_id === kunde.id) : [];

  if (!kunder.length && !nyKunde) {
    return (
      <>
        <h1 style={styles.h1}>Kunder</h1>
        <p style={styles.dæmpet}>
          Ingen kunder endnu. Kør <code>npm run db:setup</code>, eller opret en her.
        </p>
        <button style={{ ...styles.primaryBtn, marginTop: 12 }} onClick={() => setNyKunde(true)}>
          <Plus size={15} /> Ny kunde
        </button>
      </>
    );
  }

  return (
    <>
      <div style={styles.toolbar}>
        {kunder.map((k) => (
          <button key={k.id}
            style={k.id === kunde?.id ? styles.primaryBtn : styles.secondaryBtn}
            onClick={() => { setValgt(k.id); setNytBrand(false); setNyKunde(false); }}>
            {k.name}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button style={styles.secondaryBtn} onClick={() => setNyKunde(true)}>
          <Plus size={15} /> Ny kunde
        </button>
      </div>

      {nyKunde && (
        <Stamkort key="ny" kunde={null} visToast={visToast}
          genindlaes={async () => { setNyKunde(false); await genindlaes(); }}
          onAnnuller={() => setNyKunde(false)} />
      )}

      {!nyKunde && kunde && (
        <>
          <h1 style={styles.h1}>{kunde.name}</h1>
          <p style={styles.dæmpet}>
            {kundensBrands.length} brand{kundensBrands.length === 1 ? "" : "s"}
            {" · "}
            {kundensBrands.reduce((n, b) => n + kanalerFor(b.id).filter((k) => k.active).length, 0)}
            {" aktive kanaler"}
            {kunde.token_ciphertext
              ? kunde.token_fejl
                ? " · token fejler"
                : kunde.token_testet_at ? " · token bekræftet" : " · token gemt, ikke testet"
              : " · intet token"}
          </p>

          <div style={{ ...styles.faner, marginTop: 14 }}>
            {[["stamkort", "Stamkort"], ["brands", `Brands og kanaler (${kundensBrands.length})`]]
              .map(([id, mrk]) => (
                <button key={id} style={fane === id ? styles.faneAktiv : styles.fane}
                  onClick={() => setFane(id)}>
                  {mrk}
                </button>
              ))}
          </div>

          <div style={{ marginTop: 18 }}>
            {fane === "stamkort" ? (
              <Stamkort key={kunde.id} kunde={kunde} visToast={visToast} genindlaes={genindlaes} />
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                  <p style={{ ...styles.dæmpet, margin: 0 }}>
                    Hvert brand har sin egen stemme og sine egne kanaler. Tonen for hundevask
                    er ikke tonen for erhvervsrengøring.
                  </p>
                  <div style={{ flex: 1 }} />
                  {!nytBrand && (
                    <button style={styles.secondaryBtn} onClick={() => setNytBrand(true)}>
                      <Plus size={15} /> Nyt brand
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {kundensBrands.map((b) => (
                    <BrandBlok key={b.id} brand={b} kunde={kunde} kunder={kunder}
                      soeskende={kundensBrands}
                      kanaler={kanalerFor(b.id)} visToast={visToast} genindlaes={genindlaes} />
                  ))}

                  {nytBrand && (
                    <NytBrand kunde={kunde} visToast={visToast}
                      genindlaes={async () => { setNytBrand(false); await genindlaes(); }}
                      onAnnuller={() => setNytBrand(false)} />
                  )}

                  {!kundensBrands.length && !nytBrand && (
                    <p style={styles.dæmpet}>
                      Ingen brands endnu. Et brand er et forretningsområde — fx rengøring,
                      hundevask eller vaskeri.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------
   Stamkortet: aftalen, Meta-opsætningen og de forbehold der gælder hele
   kunden. Tokenet ligger her, fordi ét Meta-systemtoken dækker alle sider
   i samme Business-portefølje.
   --------------------------------------------------------------------- */

function Stamkort({ kunde, visToast, genindlaes, onAnnuller }) {
  const tom = {
    name: "", kontakt_navn: "", kontakt_mail: "", kontakt_telefon: "",
    aftale: "", godkender: "", meta_portefoelje_id: "", meta_systembruger: "",
    token_label: "", samtykke: "", guardrails: "", noter: "",
  };
  const [felter, setFelter] = useState(() =>
    Object.fromEntries(Object.keys(tom).map((n) => [n, kunde?.[n] ?? ""])),
  );
  const [token, setToken] = useState("");
  const [venter, setVenter] = useState("");
  const [testsvar, setTestsvar] = useState(null);

  const saet = (n) => (e) => setFelter((f) => ({ ...f, [n]: e.target.value }));

  async function gem() {
    setVenter("gem");
    const svar = await kaldApi("gem-kunde", { kundeId: kunde?.id, ...felter, token });
    setVenter("");
    if (!svar.ok) return visToast(svar.fejl, false);
    visToast(svar.besked);
    setToken("");
    await genindlaes();
  }

  /**
   * Sletter kunden med alt hvad der hænger under den.
   *
   * Databasen har cascade hele vejen — kunde → brands → kanaler, kampagner,
   * opslag og billedrækker. Derfor tæller vi op FØR vi spørger, så du kan se
   * præcis hvad der forsvinder, og skriver navnet for at bekræfte. En ryd-op i
   * demodata skal ikke kunne komme til at tage en rigtig kundes historik.
   *
   * Publicerede opslag er en hård stopklods: de står ude på Facebook eller
   * Instagram, og basen er det eneste sted der ved hvad vi sendte hvornår.
   */
  async function sletKunde() {
    setVenter("slet");

    const { data: brands } = await supabase
      .from("brands").select("id, name").eq("customer_id", kunde.id);
    const brandIder = (brands ?? []).map((b) => b.id);

    const tael = async (tabel, kolonne, ekstra) => {
      if (!brandIder.length) return 0;
      let q = supabase.from(tabel).select("id", { count: "exact", head: true }).in(kolonne, brandIder);
      if (ekstra) q = ekstra(q);
      const { count } = await q;
      return count ?? 0;
    };

    const kanaler = await tael("channels", "brand_id");
    const kampagner = await tael("campaigns", "brand_id");
    const opslag = await tael("posts", "brand_id");
    const publicerede = await tael("posts", "brand_id", (q) => q.eq("status", "published"));

    setVenter("");

    if (publicerede) {
      return visToast(
        `${kunde.name} har ${publicerede} publiceret opslag. Kunden kan ikke slettes — ` +
        "det ville slette historikken om noget der ligger ude på siden.", false,
      );
    }

    const linjer = [
      `${brandIder.length} brand(s)`,
      `${kanaler} kanal(er)`,
      `${kampagner} kampagne(r)`,
      `${opslag} opslag`,
    ].join("\n  ");

    if (!window.confirm(
      `Slet "${kunde.name}" og alt under den?\n\n  ${linjer}\n\n` +
      "Det kan ikke fortrydes. Uploadede billedfiler bliver liggende i storage.",
    )) return;

    const skrevet = window.prompt(`Skriv kundens navn for at bekræfte:\n${kunde.name}`);
    if (skrevet?.trim() !== kunde.name) {
      return visToast("Navnet passede ikke. Intet er slettet.", false);
    }

    setVenter("slet");
    const { error } = await supabase.from("customers").delete().eq("id", kunde.id);
    setVenter("");
    if (error) return visToast(error.message, false);
    visToast(`${kunde.name} er slettet.`);
    await genindlaes();
  }

  async function test() {
    setVenter("test");
    setTestsvar(null);
    const svar = await kaldApi("gem-kunde", { handling: "test", kundeId: kunde.id });
    setVenter("");
    setTestsvar(svar);
    visToast(svar.ok ? svar.besked : (svar.besked ?? svar.fejl), svar.ok);
    await genindlaes();
  }

  return (
    <div style={styles.toKolonner}>
      <div style={styles.kort}>
        <h2 style={styles.h2}>{kunde ? "Aftalen" : "Ny kunde"}</h2>

        <div style={{ marginTop: 12 }}>
          <Felt mrk="Navn">
            <input style={styles.input} value={felter.name} onChange={saet("name")}
              placeholder="fx Jammerbugt Rengøring" />
          </Felt>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Felt mrk="Kontaktperson" bredde={200}>
              <input style={styles.input} value={felter.kontakt_navn} onChange={saet("kontakt_navn")} />
            </Felt>
            <Felt mrk="Telefon" bredde={150}>
              <input style={styles.input} value={felter.kontakt_telefon} onChange={saet("kontakt_telefon")} />
            </Felt>
          </div>
          <Felt mrk="E-mail">
            <input style={styles.input} value={felter.kontakt_mail} onChange={saet("kontakt_mail")} />
          </Felt>
          <Felt mrk="Hvad er aftalt" hjaelp="fx «4 opslag om måneden fordelt på de tre sider»">
            <textarea style={{ ...styles.input, minHeight: 70, fontFamily: "inherit" }}
              value={felter.aftale} onChange={saet("aftale")} />
          </Felt>
          <Felt mrk="Hvem godkender hos kunden">
            <input style={styles.input} value={felter.godkender} onChange={saet("godkender")} />
          </Felt>
          <Felt mrk="Noter">
            <textarea style={{ ...styles.input, minHeight: 60, fontFamily: "inherit" }}
              value={felter.noter} onChange={saet("noter")} />
          </Felt>
        </div>

        <h2 style={{ ...styles.h2, marginTop: 20 }}>Gælder alle kundens brands</h2>
        <p style={styles.dæmpetLille}>
          Lægges oven i det enkelte brands egen må-ikke-liste, så en fælles regel
          kun skrives ét sted.
        </p>
        <Felt mrk="Samtykke og billeder">
          <textarea style={{ ...styles.input, minHeight: 70, fontFamily: "inherit" }}
            value={felter.samtykke} onChange={saet("samtykke")}
            placeholder="fx Billeder af medarbejdere kræver skriftlig accept. Ingen børn uden forældresamtykke." />
        </Felt>
        <Felt mrk="Må ikke — for hele kunden">
          <textarea style={{ ...styles.input, minHeight: 70, fontFamily: "inherit",
            borderLeft: "2px solid #B91C1C" }}
            value={felter.guardrails} onChange={saet("guardrails")} />
        </Felt>

        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.primaryBtn} disabled={venter === "gem"} onClick={gem}>
            {venter === "gem" ? "Gemmer…" : kunde ? "Gem" : "Opret kunde"}
          </button>
          {onAnnuller && (
            <button style={styles.secondaryBtn} onClick={onAnnuller}>Annuller</button>
          )}
        </div>

        {kunde && (
          <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid #E2E8F0" }}>
            <div style={styles.dt}>Slet kunden</div>
            <p style={styles.dæmpetLille}>
              Tager brands, kanaler, kampagner og opslag med sig. Du får talt op og
              skal skrive navnet først. Er noget publiceret, nægter den.
            </p>
            <button style={styles.sletBtn} disabled={!!venter} onClick={sletKunde}>
              <Trash2 size={13} /> {venter === "slet" ? "Tæller op…" : `Slet ${kunde.name}`}
            </button>
          </div>
        )}
      </div>

      <div style={styles.kort}>
        <h2 style={styles.h2}>Meta-opsætning</h2>
        <p style={styles.dæmpetLille}>
          Ét systemtoken dækker alle sider der er tildelt systembrugeren i porteføljen.
          Det ligger her, så det kun skal roteres ét sted.
        </p>

        {!kunde ? (
          <p style={{ ...styles.dæmpet, marginTop: 14 }}>
            Opret kunden først — så kan tokenet gemmes og testes.
          </p>
        ) : (
          <div style={{ marginTop: 14 }}>
            <Felt mrk="Business-portefølje-id">
              <input style={styles.input} value={felter.meta_portefoelje_id}
                onChange={saet("meta_portefoelje_id")} />
            </Felt>
            <Felt mrk="Systembruger">
              <input style={styles.input} value={felter.meta_systembruger}
                onChange={saet("meta_systembruger")} />
            </Felt>
            <Felt mrk="Systemtoken"
              hjaelp={kunde.token_ciphertext
                ? "Et token er gemt og krypteret. Lad feltet stå tomt for at beholde det."
                : "Fra Meta Business Suite → Systembrugere → Generér token."}>
              <input type="password" autoComplete="off" style={styles.input}
                placeholder={kunde.token_ciphertext ? "••••••••" : "EAAG…"}
                value={token} onChange={(e) => setToken(e.target.value)} />
              <input style={{ ...styles.input, marginTop: 8 }} value={felter.token_label}
                onChange={saet("token_label")} placeholder="Label, fx «system user 2026-08»" />
            </Felt>

            {kunde.token_fejl && <p style={styles.fejlBoks}>{kunde.token_fejl}</p>}
            {kunde.token_testet_at && !kunde.token_fejl && (
              <p style={styles.okBoks}>
                Testet {new Date(kunde.token_testet_at).toLocaleString("da-DK")}
              </p>
            )}
            {kunde.token_ciphertext && !kunde.token_testet_at && !kunde.token_fejl && (
              <p style={styles.advarselBoks}>Gemt, men aldrig testet.</p>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button style={styles.primaryBtn} disabled={!!venter} onClick={gem}>
                {venter === "gem" ? "Gemmer…" : "Gem"}
              </button>
              <button style={styles.secondaryBtn}
                disabled={!!venter || !kunde.token_ciphertext} onClick={test}>
                {venter === "test" ? <><Loader2 size={14} /> Tester…</> : "Test alle kanaler"}
              </button>
            </div>

            {testsvar?.resultater && (
              <div style={{ marginTop: 14 }}>
                <div style={styles.dt}>Resultat per kanal</div>
                {testsvar.resultater.map((r, i) => (
                  <p key={i} style={{ margin: "6px 0 0", fontSize: 13 }}>
                    <span style={{ ...styles.mærkat,
                      background: r.ok ? "#D1FAE5" : "#FEE2E2",
                      color: r.ok ? "#065F46" : "#991B1B", marginRight: 7 }}>
                      {r.ok ? "ok" : "fejl"}
                    </span>
                    {r.kanal} <span style={styles.dæmpetLille}>({r.kilde})</span>
                    <br />
                    <span style={styles.dæmpetLille}>{r.besked}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   Ét brand med sine kanaler
   --------------------------------------------------------------------- */

function BrandBlok({ brand, kunde, kunder, soeskende = [], kanaler, visToast, genindlaes }) {
  const [aaben, setAaben] = useState(false);
  const [nyKanal, setNyKanal] = useState(false);
  const [flytter, setFlytter] = useState(false);
  const [sletter, setSletter] = useState(false);

  /**
   * Migrationen gav hvert eksisterende brand sin egen kunde, fordi den ikke
   * kan gætte hvilke der hører sammen. Her samler du dem — fx rengøring,
   * hundevask og vaskeri under Jammerbugt Rengøring.
   *
   * Kanaler og opslag følger med af sig selv: de hænger på brandet, ikke på
   * kunden. Det eneste der skifter, er hvilket token og hvilke fælles
   * forbehold brandet arver.
   */
  async function flytTil(kundeId) {
    if (!kundeId || kundeId === brand.customer_id) return;
    setFlytter(true);
    const { error } = await supabase
      .from("brands").update({ customer_id: kundeId }).eq("id", brand.id);
    setFlytter(false);

    if (error) return visToast(error.message, false);
    const nyKunde = kunder.find((k) => k.id === kundeId);
    visToast(`${brand.name} hører nu under ${nyKunde?.name ?? "den nye kunde"}.`);
    await genindlaes();
  }

  /**
   * Sletter et brand der står tomt.
   *
   * Migrationen og et par forsøg giver let dubletter — to brands med samme
   * navn, hvor kanalerne endte fordelt på begge. Når du har flyttet kanalerne
   * sammen, skal den tomme kunne væk, ellers står den og forvirrer i hver
   * eneste kampagnevælger.
   *
   * Vi sletter kun hvis brandet hverken har kanaler eller kampagner. Ellers
   * ville cascade-reglen i basen tage opslag og publiceringshistorik med sig.
   */
  async function slet() {
    if (kanaler.length) {
      return visToast("Brandet har kanaler. Flyt eller slet dem først.", false);
    }
    setSletter(true);
    const { count } = await supabase
      .from("campaigns").select("id", { count: "exact", head: true }).eq("brand_id", brand.id);

    if (count) {
      setSletter(false);
      return visToast(
        `${brand.name} har ${count} kampagne(r). Flyt dem til et andet brand først ` +
        "(Ret kampagnen → Flyt til kunde).", false,
      );
    }

    if (!window.confirm(`Slet brandet "${brand.name}"? Det er tomt, så intet indhold går tabt.`)) {
      setSletter(false);
      return;
    }

    const { error } = await supabase.from("brands").delete().eq("id", brand.id);
    setSletter(false);
    if (error) return visToast(error.message, false);
    visToast(`${brand.name} slettet.`);
    await genindlaes();
  }

  const aktive = kanaler.filter((k) => k.active);
  const udenToken = aktive.filter((k) => !k.token_ciphertext && !kunde?.token_ciphertext);
  const tomt = kanaler.length === 0;

  return (
    <div style={styles.kort}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ width: 12, height: 12, borderRadius: 3,
          background: brand.colors?.primary ?? "#64748B", display: "block" }} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{brand.name}</div>
          <div style={styles.dæmpetLille}>
            {aktive.length} aktive kanaler
            {aktive.length > 0 && ` · ${aktive.map((k) => PLATFORM[k.platform]).join(", ")}`}
            {udenToken.length > 0 && ` · ${udenToken.length} uden token`}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {kunder?.length > 1 && (
          <select style={{ ...styles.input, width: "auto", fontSize: 12.5, padding: "5px 8px" }}
            value={brand.customer_id ?? ""} disabled={flytter}
            onChange={(e) => flytTil(e.target.value)}
            title="Flyt brandet til en anden kunde">
            {kunder.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        )}
        {tomt && (
          <button style={styles.sletBtn} disabled={sletter} onClick={slet}
            title="Sletter brandet, hvis det hverken har kanaler eller kampagner">
            <Trash2 size={13} /> {sletter ? "Tjekker…" : "Slet"}
          </button>
        )}
        <button style={styles.linkBtnLille} onClick={() => setAaben(!aaben)}>
          {aaben ? <><X size={13} /> Luk</> : "Åbn"}
        </button>
      </div>

      {aaben && (
        <div style={{ marginTop: 16 }}>
          <div style={styles.toKolonner}>
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
                {kanaler.map((k) => (
                  <KanalKort key={k.id} kanal={k} brandId={brand.id} kunde={kunde}
                    soeskende={soeskende}
                    visToast={visToast} genindlaes={genindlaes} />
                ))}
                {nyKanal && (
                  <KanalKort brandId={brand.id} kunde={kunde} visToast={visToast}
                    genindlaes={async () => { setNyKanal(false); await genindlaes(); }} />
                )}
                {!kanaler.length && !nyKanal && (
                  <p style={styles.dæmpet}>
                    Ingen kanaler. Uden en kanal kan kampagnen genereres, men ikke publiceres.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NytBrand({ kunde, visToast, genindlaes, onAnnuller }) {
  const [navn, setNavn] = useState("");
  const [farve, setFarve] = useState("#2F5DE0");
  const [venter, setVenter] = useState(false);

  async function opret() {
    if (!navn.trim()) return visToast("Brandet skal have et navn.", false);
    setVenter(true);

    const slug = `${kunde.slug}-${navn.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
      .replace(/^-|-$/g, "");

    const { error } = await supabase.from("brands").insert({
      customer_id: kunde.id, name: navn.trim(), slug,
      colors: { primary: farve },
    });
    setVenter(false);

    if (error) return visToast(error.message, false);
    visToast(`${navn} oprettet. Udfyld tone og målgruppe, så Claude har noget at gå efter.`);
    await genindlaes();
  }

  return (
    <div style={styles.kort}>
      <h2 style={styles.h2}>Nyt brand under {kunde.name}</h2>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <Felt mrk="Navn" bredde={240}>
          <input style={styles.input} value={navn} onChange={(e) => setNavn(e.target.value)}
            placeholder="fx Hundevask" />
        </Felt>
        <Felt mrk="Farve" bredde={110}>
          <input type="color" style={{ ...styles.input, height: 40, padding: 4 }}
            value={farve} onChange={(e) => setFarve(e.target.value)} />
        </Felt>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={styles.primaryBtn} disabled={venter} onClick={opret}>
          {venter ? "Opretter…" : "Opret brand"}
        </button>
        <button style={styles.secondaryBtn} onClick={onAnnuller}>Annuller</button>
      </div>
    </div>
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

function KanalKort({ kanal, brandId, kunde, soeskende = [], visToast, genindlaes }) {
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

  /**
   * Flytter kanalen til et andet af kundens brands.
   *
   * Det er den vej man kommer ud af en dublet: har man ved et uheld fået to
   * brands, hvor Facebook ligger på det ene og Instagram på det andet, samles
   * de her — i stedet for at oprette siden forfra med samme Page ID og så have
   * den to steder.
   *
   * Kanalens publiceringshistorik følger med, fordi post_targets peger på
   * kanalen. Opslag der allerede ER publiceret ligger derimod på det gamle
   * brand — de flyttes med "Flyt til kunde" på kampagnen, hvis de skal med.
   */
  async function flytTilBrand(nytBrand) {
    if (!nytBrand || nytBrand === brandId) return;
    setVenter("flyt");
    const svar = await kaldApi("gem-kanal", {
      kanalId: kanal.id, brandId: nytBrand,
      platform, visningsnavn, pageId, igUserId, tokenLabel, aktiv,
    });
    setVenter("");

    if (!svar.ok) return visToast(svar.fejl, false);
    const modtager = soeskende.find((b) => b.id === nytBrand);
    visToast(`${visningsnavn} ligger nu under ${modtager?.name ?? "det nye brand"}.`);
    await genindlaes();
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

      {kanal && soeskende.length > 1 && (
        <Felt mrk="Hører til brandet" bredde={280}
          hjaelp="Flytter kanalen til et andet af kundens brands. Bruges til at samle en Facebook- og en Instagram-kanal der er endt på hver sit brand.">
          <select style={styles.input} value={brandId} disabled={!!venter}
            onChange={(e) => flytTilBrand(e.target.value)}>
            {soeskende.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </Felt>
      )}

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
          ? "Kanalen har sit eget token, som vinder over kundens."
          : kunde?.token_ciphertext
            ? `Arver kundens token${kunde.token_label ? ` (${kunde.token_label})` : ""}. Udfyld kun her hvis siden ligger i en ANDEN Business-portefølje.`
            : "Hverken kanalen eller kunden har et token. Læg det helst på kunden — ét token dækker hele porteføljen."}
      >
        <input type="password" autoComplete="off" style={styles.input}
          placeholder={kanal?.token_ciphertext ? "••••••••"
            : kunde?.token_ciphertext ? "arver kundens" : "EAAG…"}
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

  // --- Feed-attrap i forhåndsvisningen ---
  // Genkendeligt som et feed, men uden logoer eller varemærker: det er vores
  // eget værktøj, ikke en efterligning af platformene.
  feedKort: { background: "#fff", border: "1px solid #DDE1E7", borderRadius: 10,
    overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,42,0.08)" },
  feedHoved: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 8px" },
  feedAvatar: { width: 38, height: 38, borderRadius: "50%", color: "#fff", display: "flex",
    alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flex: "0 0 auto" },
  feedNavn: { fontWeight: 600, fontSize: 14.5, color: "#0F172A" },
  feedTid: { fontSize: 12, color: "#64748B" },
  feedTekst: { margin: 0, padding: "2px 14px 12px", fontSize: 15, lineHeight: 1.45,
    whiteSpace: "pre-wrap", color: "#0F172A" },
  // Det skjulte vises nedtonet frem for at være væk — så kan man se hvad
  // der forsvinder bag «Se mere», i stedet for at gætte.
  feedSkjult: { color: "#B6BEC9" },
  // Ser ud som Facebooks egen «Se mere», men er en rigtig knap — så den også
  // kan nås med tastaturet.
  feedSeMere: { color: "#64748B", border: "none", background: "none",
    padding: 0, font: "inherit", fontWeight: 600, cursor: "pointer" },
  feedBillede: { width: "100%", display: "block", maxHeight: 420, objectFit: "cover" },
  feedBilledeFoerst: { width: "100%", display: "block", aspectRatio: "1 / 1", objectFit: "cover" },
  feedUdenBillede: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: "22px 14px", background: "#F1F5F9", borderTop: "1px solid #E7EAF3" },
  feedHandlinger: { display: "flex", justifyContent: "space-around", padding: "9px 14px",
    borderTop: "1px solid #E7EAF3", fontSize: 13, color: "#64748B", fontWeight: 500 },

  advarselBoks: { background: "#FDF3E0", color: "#92400E", padding: "8px 11px",
    borderRadius: 8, fontSize: 13, margin: 0 },

  // Hvad en rettelse rører. Står øverst i dialogen, fordi det er det man
  // skal vide FØR man trykker, ikke bagefter.
  omfang: { background: "#F8FAFF", border: "1px solid #DDE4F5", borderRadius: 10,
    padding: "11px 14px", marginBottom: 16 },
  kanalValg: { border: "1px solid #E7EAF3", borderRadius: 10, padding: "11px 13px",
    fontSize: 14 },

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
