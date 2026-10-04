# Opsætning af din egen udgave

Denne mappe er en kopi af kampagneappen uden data, uden git-historik og uden
nøgler. Den er klar til at blive dit eget projekt.

Regn med en times tid. Rækkefølgen er ikke tilfældig: databasen skal findes
før appen kan starte, og Meta kommer til sidst, fordi det er den eneste del
der kan vente.

Slet denne fil når du er igennem.

---

## 1. Git

```bash
cd Kampagneapp
git init
git add -A
git commit -m "Kampagneapp, egen udgave"
```

Opret et **tomt** repo i din egen GitHub-konto — uden README, uden
.gitignore, ellers skal du flette med det samme. Derefter:

```bash
git remote add origin https://github.com/DIN-KONTO/kampagneapp.git
git branch -M main
git push -u origin main
```

Der er ingen forbindelse til det oprindelige repo. De to udgaver kan udvikle
sig hver sin vej, og det er meningen.

---

## 2. Supabase

Opret et nyt projekt på [supabase.com](https://supabase.com/dashboard). Vælg
region **Frankfurt** eller **Stockholm** — data om danske kunder bør blive i
EU.

Hent derefter under **Settings → API Keys**:

- projektets URL
- `sb_publishable_…` — offentlig, må gerne stå i browseren
- `sb_secret_…` — serverside, går uden om al adgangskontrol

Lav din `.env`:

```bash
cp .env.example .env
```

Udfyld de tre værdier, og generér de to nøgler appen selv ejer:

```bash
echo "TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
echo "CRON_SECRET=$(openssl rand -hex 32)" >> .env
```

> `TOKEN_ENCRYPTION_KEY` krypterer Meta-tokens i databasen. **Skift den aldrig
> efter at det første token er gemt** — så kan ingen af dem dekrypteres, og
> hver kanal skal sættes op forfra.

Kør migrationerne. De opretter hele skemaet — tabeller, adgangsregler,
funktioner og billedarkiv:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...        # supabase.com/dashboard/account/tokens
export SUPABASE_PROJECT_NAVN="Kampagneapp"  # kun hvis projektet hedder noget andet
npm install
npm run db:setup
```

Migrationerne **er** databasen. Der skal ikke kopieres noget fra den gamle —
et nyt projekt plus dette ene script giver præcis samme skema.

---

## 3. Din bruger

Opret dig selv i Supabase under **Authentication → Users → Add user** med en
adgangskode. Derefter:

```bash
npm run org:opret "Dit firma"
npm run org:medlem dit-firma din@mail.dk ejer
npm run org
```

Den første ejer *skal* laves fra terminalen — der er ingen ejer endnu til at
invitere dig. Derefter kan du invitere andre inde fra appen under
**Medlemmer**.

Prøv den lokalt:

```bash
npm run dev
```

---

## 4. Netlify

Opret et nyt site fra dit GitHub-repo på
[netlify.com](https://app.netlify.com). Byggeindstillingerne læses fra
`netlify.toml` — der er intet at udfylde.

Læg miljøvariablerne ind under **Site configuration → Environment
variables**. Samme navne som i `.env`, men **ikke** `TILLAD_LOKAL_CLAUDE` —
den hører kun til på din egen maskine.

Som minimum:

```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
TOKEN_ENCRYPTION_KEY
CRON_SECRET
PUBLISH_DRY_RUN = true
```

> Alt med `VITE_` bages ind i browserkoden når der bygges. Ændrer du en af
> dem, skal der et nyt deploy til — det er ikke nok at genindlæse siden.

---

## 5. Meta

Denne del kan vente til resten virker.

1. [developers.facebook.com](https://developers.facebook.com) → ny app af
   typen **Business**
2. **Meta Business Suite → Indstillinger → Systembrugere** → opret en
   systembruger med rollen Admin
3. Tildel den de sider og Instagram-konti der skal publiceres til
4. Generér et token med `pages_manage_posts`, `pages_read_engagement`,
   `instagram_basic`, `instagram_content_publish`

Find id'erne til opsætningen med ét kald:

```bash
curl -s "https://graph.facebook.com/v21.0/me/accounts?fields=name,id,instagram_business_account{id,username}&access_token=DIT_TOKEN" | python3 -m json.tool
```

Kommer en side ikke med i listen, er systembrugeren ikke tildelt den. Det er
bedre at opdage her end når et opslag skulle publiceres.

Indsæt tokenet i appen under **Kunder → Stamkort**, opret kanalerne under
brandet med `id`'erne ovenfor, og tryk **Test alle kanaler**.

**Du behøver ikke app review**, så længe du selv er administrator på de sider
der publiceres til. Skal appen en dag betjene sider du ikke administrerer,
kræver det Advanced Access og virksomhedsverificering — regn med uger.

---

## 6. Før du publicerer for alvor

`PUBLISH_DRY_RUN=true` betyder at intet sendes til Meta og intet skrives til
databasen. Lad den stå indtil:

- [ ] Alle kanaler er testet og giver grønt lys
- [ ] Du har lavet en kampagne og set opslagene i forhåndsvisningen
- [ ] Du har godkendt ét opslag og trykket publicér, og set i Netlifys log at
      tørkørslen fangede det
- [ ] Du har læst afsnittet **Før du går live** i `README.md`

Først derefter sættes den til `false` — og start med ét opslag på én kanal.

---

## 7. Det du kan skære væk

Appen er bygget til at rumme flere kunder i samme installation. Skal den kun
bruges til ét firma, behøver du ikke ændre noget: med én organisation viser
topbjælken bare navnet i stedet for en vælger, og **Medlemmer** er der kun
for dig som ejer. Rollerne redaktør og godkender kan du tage i brug den dag
der kommer flere med.

Tag det først væk hvis det generer. Kode man har fjernet, skal skrives igen.
