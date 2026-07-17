# 🎯 זירת האש · STARSHARDS ARENA

משחק יריות **תלת־ממדי בגוף ראשון (FPS)** מרובה משתתפים לדפדפן — Gun Game בסגנון פורטנייט,
עברית מלאה + RTL, מבוסס **Firebase** בלבד, וכל הגרפיקה נוצרת **פרוצדורלית בקוד** (אפס קובצי נכסים).

> 📄 מסמך העיצוב המלא: [GDD.md](GDD.md) · פרויקט Firebase חי: `fabels-70545`

| | |
|---|---|
| 🔫 **משחק רובים** | PvP עד 6 שחקנים — כל חיסול משדרג נשק; סכין הזהב מנצחת |
| 🤖 **נגד בוטים** | חברים ביחד נגד בוטים — בחירת רמת קושי (קל/רגיל/קשה) ומספר בוטים |
| 🗺️ **4 מפות** | העיירה · מכרה הגבישים · נמל החלל · קניון האש — נבחרות בלובי |
| 🎽 **דמויות** | 6 סקינים low-poly לרכישה ברסיסים |
| 📈 **התקדמות** | רמות XP, דרגות RP (ארד→אגדה), לוח מובילים גלובלי, בונוס יומי |
| 📱 **מובייל + דסקטופ** | ג'ויסטיק וגרירת מבט בטלפון; WASD + עכבר (Pointer Lock) במחשב |

## הפעלה מקומית

```bash
cd public
python3 -m http.server 8080     # פתחו http://localhost:8080
```

ללא רשת/ללא Firebase — המשחק עובר אוטומטית למצב אימון מול בוטים (התקדמות ב־localStorage).

## פריסה (הפרויקט כבר מחובר!)

`public/js/config.js` כבר מכיל את התצורה של `fabels-70545`, ו־Firestore + Realtime Database כבר נוצרו.
נשארו **שתי פעולות ידניות חד־פעמיות** בקונסולה:

1. **הפעלת התחברות אנונימית**:
   [Authentication → Sign-in method](https://console.firebase.google.com/project/fabels-70545/authentication/providers)
   → Get started → **Anonymous** → Enable → Save.
2. **הדבקת חוקי Realtime Database**:
   [Realtime Database → Rules](https://console.firebase.google.com/project/fabels-70545/database/fabels-70545-default-rtdb/rules)
   → הדביקו את תוכן הקובץ [`database.rules.json`](database.rules.json) → Publish.

ואז פריסה:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting
# ⇒ https://fabels-70545.web.app
```

## שליטה

| | תנועה | מבט | ירי | קפיצה | טעינה | תוצאות | צ'אט |
|---|---|---|---|---|---|---|---|
| 📱 | ג'ויסטיק שמאלי | גרירה מימין | כפתור ⊕ | ⤒ | ⟳ | 📋 | 💬 |
| 🖥️ | WASD | עכבר | לחיצה | רווח | R | Tab | 1–4 |

במחשב: לחיצה על המסך נועלת את הסמן; **ESC** משחרר.

## English TL;DR

**STARSHARDS ARENA** — a mobile-first browser FPS in Hebrew (native RTL): Fortnite-style low-poly
Gun Game. Online PvP (up to 6) and team-vs-bots co-op (selectable difficulty & bot count) over
Firebase Realtime Database, with lobbies, 5-char room codes, host migration and
victim-authoritative netcode. Four procedurally built maps, animated low-poly characters,
an 8-weapon ladder ending with the Golden Knife, persistent XP/rank/leaderboard on Firestore.
Three.js is vendored locally; zero asset files, zero build step. Deploy with `firebase deploy --only hosting`
after enabling Anonymous Auth and pasting the RTDB rules (links above).
