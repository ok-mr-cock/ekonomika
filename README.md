# Kvíz pro třídu (Render.com)

**Žáci:** hlavní adresa aplikace (např. `https://kviz-xyz.onrender.com/`) – napíšou jméno a hrají.
**Učitel:** `/ucitel` + heslo z proměnné `TEACHER_PASSWORD` (výchozí `ucitel`, změň ho!).

## Nasazení
1. Nahraj složku do GitHub repozitáře.
2. Na render.com: New → Web Service → repozitář. Build `npm install`, start `npm start` (nebo použij `render.yaml`).
3. V Environment nastav `TEACHER_PASSWORD`.

## Otázky
V dokumentu s kvízem zvol Stáhnout → Markdown a buď soubor pojmenuj `questions.md` a dej ho do kořene projektu, nebo ho nahraj přímo na stránce učitele (sekce Témata).
Formát: `## 1 Téma`, `**1.1 Otázka?**`, `- A) odpověď` (správná má na konci ✔).

## Poznámky
- Bodování jako v Kahootu: 1000 b. při okamžité odpovědi, lineárně klesá na 500 b. při odpovědi v posledním okamžiku limitu; špatná nebo žádná odpověď = 0.
- Hra běží v paměti serveru. Na bezplatném plánu se server po čase nečinnosti uspí a při probuzení se hra i nahrané otázky (mimo `questions.md` v repozitáři) ztratí; před hodinou stránku otevři.
