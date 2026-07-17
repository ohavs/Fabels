# ⭐ שברי כוכב · STARSHARDS

משחק פעולה/יריות חלל **מרובה משתתפים** לדפדפן הנייד — עברית מלאה, RTL מלא,
כל הגרפיקה והסאונד נוצרים **פרוצדורלית בקוד** (אפס קובצי נכסים), והכול רץ על **Firebase** בלבד.

> 📄 מסמך העיצוב המלא והארכיטקטורה: [GDD.md](GDD.md)

| | |
|---|---|
| ⚔️ **זירת הכבוד** | PvP Deathmatch — עד 6 טייסים, 3 דקות |
| 🛡️ **מתקפת הצללים** | Co-op — עד 4 טייסים נגד גלים אינסופיים ובוסים |
| 🎯 **אימון חופשי** | אופליין מול בוטים — עובד גם בלי Firebase בכלל |
| 📈 **התקדמות** | רמות (XP), דרגות PvP‏ (RP): ארד → אגדה, לוח מובילים |
| 💠 **כלכלה** | רסיסים → 4 ספינות ייחודיות + 20 שדרוגים, בונוס יומי |

---

## הפעלה מקומית (בלי Firebase)

```bash
cd public
python3 -m http.server 8080
# פתחו http://localhost:8080
```

ללא תצורת Firebase המשחק עולה אוטומטית ב**מצב לא־מקוון**: אימון מול בוטים,
וההתקדמות (רסיסים, רמות, ספינות) נשמרת ב-localStorage.

## פריסה מלאה על Firebase (מצב מקוון מלא)

1. צרו פרויקט ב-[Firebase Console](https://console.firebase.google.com) והפעילו:
   - **Authentication** → Sign-in method → **Anonymous**
   - **Realtime Database** (צרו מסד — האזור לא משנה)
   - **Cloud Firestore**
   - **Hosting**
2. הוסיפו Web App לפרויקט והעתיקו את קטע ה-config אל
   [`public/js/config.js`](public/js/config.js) (החליפו את ערכי ה-`YOUR_*`).
3. עדכנו את מזהה הפרויקט ב-[.firebaserc](.firebaserc).
4. פרסו:

```bash
npm install -g firebase-tools
firebase login
firebase deploy        # hosting + database rules + firestore rules
```

זהו. פתחו את כתובת ה-Hosting מהטלפון — PvP, Co-op, שידוך אוטומטי, הצטרפות
עם קוד חדר ולוח מובילים עובדים מיד.

## שליטה

| פלטפורמה | תנועה | כיוון + ירי | זינוק | יכולת מיוחדת | צ'אט מהיר |
|---|---|---|---|---|---|
| 📱 מובייל | ג'ויסטיק שמאלי | ג'ויסטיק ימני | 💨 | ⚡ | 💬 |
| 🖥️ דסקטופ | WASD / חצים | עכבר + לחיצה | Space / Shift | E | 1–4 |

## מבנה הקוד

```
public/            האפליקציה (Vanilla JS, ES Modules, ללא build)
  js/config.js     תצורת Firebase + כל נתוני האיזון
  js/game.js       ליבת הסימולציה (פיזיקה, קרב, גלים, בוטים)
  js/net.js        חדרים, שידוך, סנכרון, נדידת מארח (RTDB)
  js/render.js     רינדור פרוצדורלי מלא (Canvas 2D)
  js/profile.js    כלכלה והתקדמות (Firestore ⇄ localStorage)
  ...              ראו GDD.md לפירוט מלא
database.rules.json / firestore.rules   חוקי אבטחה
```

---

## English TL;DR

**STARSHARDS** is a mobile-first multiplayer top-down space shooter, fully in
Hebrew with native RTL UI. PvP deathmatch + co-op wave survival over Firebase
Realtime Database, persistent progression/economy/leaderboard on Firestore,
anonymous auth, Firebase Hosting. 100% of graphics & SFX are procedurally
generated in code — zero asset files, zero dependencies, zero build step.
Without Firebase config it auto-falls back to offline practice vs bots with
localStorage progression. To go online: create a Firebase project (Anonymous
Auth + RTDB + Firestore + Hosting), paste your web config into
`public/js/config.js`, set the project id in `.firebaserc`, then
`firebase deploy`.
