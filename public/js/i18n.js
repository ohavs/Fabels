// ============================================================
// Hebrew string table — every dynamic UI string lives here.
// Static screen text lives directly in index.html (also Hebrew).
// ============================================================

export const STR = {
  loading: 'טוען את הזירה…',
  offlineMode: 'מצב לא־מקוון: זמין אימון מול בוטים בלבד',
  connecting: 'מתחבר…',
  connected: 'מחובר',
  free: 'חינם',
  owned: 'ברשותך',
  equipped: 'נבחר',
  equip: 'בחר',
  notEnough: 'אין מספיק רסיסים',

  // modes
  mode_gungame: 'משחק רובים',
  mode_team: 'נגד בוטים',
  mode_practice: 'אימון חופשי',

  // maps
  map_town: 'העיירה',
  map_mine: 'מכרה הגבישים',
  map_port: 'נמל החלל',
  map_canyon: 'קניון האש',

  // weapons (gun-game ladder)
  weapon_pistol: 'אקדח',
  weapon_smg: 'תת־מקלע',
  weapon_shotgun: 'רובה ציד',
  weapon_rifle: 'רובה סער',
  weapon_lmg: 'מקלע כבד',
  weapon_sniper: 'רובה צלפים',
  weapon_plasma: 'קרן פלזמה',
  weapon_knife: 'סכין הזהב',
  weapon_botgun: 'נשק בוט',

  // skins
  skin_scout: 'סייר',
  skin_ember: 'גחלת',
  skin_jungle: "ג'ונגל",
  skin_shadow: 'צללים',
  skin_sunset: 'שקיעה',
  skin_legend: 'אגדה',

  // bots
  bots_easy: 'קל',
  bots_normal: 'רגיל',
  bots_hard: 'קשה',
  botCount: 'מספר בוטים: {n}',

  // ranks
  rank_bronze: 'ארד',
  rank_silver: 'כסף',
  rank_gold: 'זהב',
  rank_platinum: 'פלטינה',
  rank_diamond: 'יהלום',
  rank_legend: 'אגדה',

  // lobby
  lobbyTitle_gungame: 'לובי — משחק רובים',
  lobbyTitle_team: 'לובי — נגד בוטים',
  waitingForPlayers: 'ממתין ללוחמים נוספים…',
  youAreHost: 'אתם מארחי הקרב',
  startsIn: 'הקרב מתחיל בעוד {n}…',
  roomCode: 'קוד חדר: {code}',
  joinFailed: 'ההצטרפות נכשלה — נסו שוב',
  roomNotFound: 'חדר לא נמצא',
  hostLeft: 'המארח עזב — מארח חדש נבחר',
  chooseMap: 'בחירת מפה',
  chooseBots: 'רמת בוטים',

  // HUD / battle
  kill: '{a} חיסל את {b}',
  killKnife: '{a} השפיל את {b} עם הסכין! 🔪',
  youKilled: 'חיסלתם את {name}!',
  respawnIn: 'חוזרים לקרב בעוד {n}…',
  tierUp: 'נשק חדש: {w}!',
  tierDown: 'הסכין הורידה אתכם דרגה…',
  lastWeapon: 'הנשק האחרון! חיסול אחד לניצחון!',
  winner: '{name} ניצח במשחק הרובים!',
  teamScore: 'אנחנו {a} — {b} בוטים',
  teamWin: 'ניצחון! הקבוצה חיסלה {n} בוטים',
  teamLose: 'הבוטים ניצחו הפעם…',
  gameOver: 'המשחק נגמר',
  victory: 'ניצחון!',
  place: 'מקום {n}',
  playerJoined: '{name} הצטרף לקרב',
  playerLeft: '{name} עזב את הקרב',
  headshot: 'פגיעת ראש!',

  // quick chat
  chat_gg: 'קרב מעולה!',
  chat_help: 'צריך עזרה כאן!',
  chat_attack: 'להסתער!',
  chat_nice: 'איזה יופי!',

  // results
  rewardXp: '+{n} ניסיון',
  rewardShards: '+{n} רסיסים',
  rewardRp: 'RP {n}',
  levelUp: 'עליתם לרמה {n}!',
  rankUp: 'דרגה חדשה: {rank}!',
  resKills: '{n} חיסולים',

  // profile / meta
  level: 'רמה {n}',
  daily: 'בונוס יומי: +{n} רסיסים!',
  nameSaved: 'הכינוי נשמר',

  // leaderboard
  boardEmpty: 'אין עדיין לוחמים בלוח — היו הראשונים!',
  boardOffline: 'לוח המובילים זמין רק במצב מקוון',

  // errors
  netError: 'שגיאת רשת — בדקו את החיבור',
  onlineNeedsFirebase: 'מצב מקוון דורש הגדרת Firebase (ראו README)',

  // pickups & combat pack
  pickup_hp: 'ערכת חיים',
  pickup_armor: 'שריון',
  pickup_nade: 'רימון',
  pickup_weapon: 'תיבת נשק',
  gotWeapon: 'נשק חדש: {w}!',
  streak3: '🔥 רצף 3! מהירות מוגברת!',
  streak5: '🛡️ רצף 5! שריון בונוס!',
  streak7: '⚔️ רצף 7! נזק כפול!',
  nades: 'רימונים',

  // new modes
  mode_duel: 'דו-קרב 1v1',
  mode_zombies: 'מתקפת זומבים',
  mode_ctf: 'כיבוש הדגל',
  mode_br: 'באטל רויאל',
  lobbyTitle_duel: 'לובי — דו-קרב',
  lobbyTitle_zombies: 'לובי — מתקפת זומבים',
  lobbyTitle_ctf: 'לובי — כיבוש הדגל',
  lobbyTitle_br: 'לובי — באטל רויאל',
  duelTarget: 'הראשון שמסיים את סולם הנשקים מנצח',

  // zombies
  zombie_walker: 'הולך',
  zombie_runner: 'רץ',
  zombie_spitter: 'יורק',
  zombie_brute: 'ענק',
  zwave: 'גל {n}',
  zwaveIncoming: 'גל {n} מגיע!',
  zbruteIncoming: 'ענק מתקרב!!',
  zSurvived: 'שרדתם {n} גלים',

  // ctf
  ctfScore: '🔴 {r} — {b} 🔵',
  flagTaken: '{name} לקח את הדגל!',
  flagDropped: 'הדגל נפל!',
  flagReturned: 'הדגל חזר לבסיס',
  flagCaptured: '{name} כבש את הדגל! 🏁',
  yourTeamRed: 'אתם בקבוצה האדומה 🔴',
  yourTeamBlue: 'אתם בקבוצה הכחולה 🔵',
  ctfWin: 'הקבוצה שלכם ניצחה! 🏁',
  ctfLose: 'הקבוצה היריבה ניצחה…',

  // battle royale
  zoneShrinking: '⚠️ האזור מתכווץ!',
  zoneDamage: 'אתם מחוץ לאזור!',
  brAlive: '{n} שורדים',
  brWin: '🏆 ניצחון מלכותי!',
  brPlace: 'מקום {n} מתוך {of}',
  brDead: 'חוסלתם — מקום {n}',

  // emotes
  emote: 'ריקוד',
  emoted: '{name} רוקד! 🕺',
};

export function t(key, params) {
  let s = STR[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

const CALLSIGNS = ['נץ', 'ברק', 'שחף', 'עיט', 'כידון', 'סופה', 'להב', 'זיק', 'רעם', 'חץ'];
export const randomName = () =>
  `${CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)]}-${100 + Math.floor(Math.random() * 900)}`;
export const BOT_NAMES = ['רובוטרון', 'טרמינל', 'סייבורג', 'מכונית', 'בולט', 'גיר', 'צירים', 'ברגים', 'אנדרואיד', 'חשמל'];
