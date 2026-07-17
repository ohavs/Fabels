// ============================================================
// Hebrew string table — every dynamic UI string lives here.
// Static screen text lives directly in index.html (also Hebrew).
// t(key, params) interpolates {name}-style placeholders.
// ============================================================

export const STR = {
  // generic
  loading: 'טוען את שדה הגבישים…',
  offlineMode: 'מצב לא־מקוון: Firebase לא הוגדר — זמין אימון מול בוטים בלבד',
  connecting: 'מתחבר…',
  connected: 'מחובר',
  back: 'חזרה',
  ok: 'אישור',
  cancel: 'ביטול',
  free: 'חינם',
  owned: 'ברשותך',
  equipped: 'נבחרה',
  equip: 'בחר',
  buy: 'קנייה',
  notEnough: 'אין מספיק רסיסים',
  saved: 'נשמר',

  // ships
  ship_storm: 'סער',
  ship_shadow: 'צל',
  ship_aegis: 'מגן',
  ship_nova: 'נובה',
  shipDesc_storm: 'לוחמת מאוזנת. בלסטר אמין ויכולת מטח-על.',
  shipDesc_shadow: 'סיירת מהירה. מפזר תלת-קני והבזק טלפורט.',
  shipDesc_aegis: 'טנק כבד. טילים ביתיים ומגן אנרגיה.',
  shipDesc_nova: 'תותח זכוכית. לייזר חודר ופיצוץ נובה.',

  // specials
  special_overdrive: 'מטח-על',
  special_blink: 'הבזק',
  special_shield: 'מגן אנרגיה',
  special_nova: 'פיצוץ נובה',

  // weapons
  weapon_blaster: 'בלסטר',
  weapon_spread: 'מפזר',
  weapon_laser: 'לייזר',
  weapon_missile: 'טיל ביתי',

  // upgrades
  up_dmg: 'נזק',
  up_rate: 'קצב ירי',
  up_speed: 'מהירות',
  up_hp: 'שריון',
  upMax: 'מקסימום',
  tier: 'דרגה {n}',

  // ranks
  rank_bronze: 'ארד',
  rank_silver: 'כסף',
  rank_gold: 'זהב',
  rank_platinum: 'פלטינה',
  rank_diamond: 'יהלום',
  rank_legend: 'אגדה',

  // enemies
  enemy_crawler: 'זחלן',
  enemy_stinger: 'עוקצן',
  enemy_crusher: 'מרסק',
  enemy_boss: 'לבת האופל',

  // modes
  mode_pvp: 'זירת הכבוד',
  mode_coop: 'מתקפת הצללים',
  mode_practice: 'אימון חופשי',

  // lobby
  lobbyTitle_pvp: 'לובי — זירת הכבוד',
  lobbyTitle_coop: 'לובי — מתקפת הצללים',
  players: 'טייסים ({n}/{max})',
  waitingForPlayers: 'ממתין לטייסים נוספים…',
  youAreHost: 'אתם מארחי הקרב',
  startsIn: 'הקרב מתחיל בעוד {n}…',
  roomCode: 'קוד חדר: {code}',
  joinFailed: 'ההצטרפות נכשלה — נסו שוב',
  roomNotFound: 'חדר לא נמצא',
  hostLeft: 'המארח עזב — מארח חדש נבחר',

  // HUD / battle
  wave: 'גל {n}',
  waveIncoming: 'גל {n} מתקרב!',
  bossIncoming: 'לבת האופל מתעוררת!',
  kill: '{a} חיסל את {b}',
  killedBy: 'חוסלתם על ידי {name}',
  youKilled: 'חיסלתם את {name}!',
  respawnIn: 'חוזרים לקרב בעוד {n}…',
  timeLeft: 'זמן',
  score: 'ניקוד',
  kills: 'חיסולים',
  deaths: 'מוות',
  gameOver: 'המשחק נגמר',
  victory: 'ניצחון!',
  defeat: 'הפסד',
  allDown: 'כל הטייסים נפלו…',
  playerJoined: '{name} הצטרף לקרב',
  playerLeft: '{name} עזב את הקרב',

  // quick chat
  chat_gg: 'קרב מעולה!',
  chat_help: 'צריך עזרה כאן!',
  chat_attack: 'להסתער!',
  chat_nice: 'איזה יופי!',

  // results
  place: 'מקום {n}',
  resultWaves: 'שרדתם {n} גלים',
  rewardXp: '+{n} ניסיון',
  rewardShards: '+{n} רסיסים',
  rewardRp: 'RP {n}',
  levelUp: 'עליתם לרמה {n}!',
  rankUp: 'דרגה חדשה: {rank}!',

  // profile / meta
  level: 'רמה {n}',
  daily: 'בונוס יומי: +{n} רסיסים!',
  nameSaved: 'הכינוי נשמר',
  namePlaceholder: 'כינוי טייס',

  // leaderboard
  boardEmpty: 'אין עדיין טייסים בלוח — היו הראשונים!',
  boardOffline: 'לוח המובילים זמין רק במצב מקוון',

  // errors
  netError: 'שגיאת רשת — בדקו את החיבור',
  onlineNeedsFirebase: 'מצב מקוון דורש הגדרת Firebase (ראו README)',
};

export function t(key, params) {
  let s = STR[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// Random Hebrew pilot callsign for first launch
const CALLSIGNS = ['נץ', 'ברק', 'שחף', 'עיט', 'כידון', 'סופה', 'להב', 'זיק', 'רעם', 'חץ'];
export const randomName = () =>
  `${CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)]}-${100 + Math.floor(Math.random() * 900)}`;
