// ============================================================
// Inline SVG icon set — crisp, consistent action glyphs that
// actually read as what they do (crouch, sprint, jump, aim…).
// Drawn on a 24×24 grid, currentColor stroke so CSS themes them.
// No external icon packs (strict CSP) — all hand-authored paths.
// ============================================================

const svg = (paths, { fill = false, w = 2 } = {}) =>
  `<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" ` +
  `stroke="currentColor" stroke-width="${w}" stroke-linecap="round" ` +
  `stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  // movement
  jump: svg('<path d="M12 20V8"/><path d="M7 12l5-5 5 5"/><path d="M6 21h12"/>'),
  crouch: svg('<circle cx="12" cy="5" r="2.4"/><path d="M12 8v5l-3 6"/><path d="M12 13l3 6"/><path d="M8 11h8"/>'),
  sprint: svg('<circle cx="14" cy="5" r="2.2"/><path d="M13 9l-3 3 2 3-1 5"/><path d="M12 15l4 1"/><path d="M10 12L6 11"/><path d="M4 8h3"/><path d="M3 12h2"/>'),
  slide: svg('<circle cx="8" cy="7" r="2.2"/><path d="M6 10l4 3 7-1"/><path d="M4 18h9"/><path d="M15 16l4 3"/>'),

  // combat
  reload: svg('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>'),
  grenade: svg('<circle cx="12" cy="14" r="6"/><path d="M12 8V6"/><path d="M10 5h4l1 2"/><path d="M15 7l2-2"/>', { fill: false }),
  fire: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'),

  // aiming
  aim: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>'),
  scope: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>'),

  // building
  wall: svg('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9.5h16M4 15h16M9.5 4v5.5M14.5 4v5.5M7 9.5V15M12 9.5V15M17 9.5V15M9.5 15v5M14.5 15v5"/>', { w: 1.6 }),
  ramp: svg('<path d="M3 20h18"/><path d="M4 20L18 6"/><path d="M18 6v14"/><path d="M8 20v-5M12 20v-9"/>', { w: 1.7 }),
  floor: svg('<path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v3l9 4 9-4V8"/>', { w: 1.7 }),
  cone: svg('<path d="M12 3L3 20h18z"/><path d="M12 3v17M3 20h18M7.5 11.5h9"/>', { w: 1.6 }),
  edit: svg('<path d="M14 4l6 6"/><path d="M4 20l1-4L16 5l3 3L8 19z"/>'),
  pickaxe: svg('<path d="M4 20l8-8"/><path d="M4 8c4-3 9-3 13 1M20 8c-3-4-8-4-12-1"/><path d="M11 11l2 2"/>', { w: 1.7 }),

  // social / ui
  emote: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14a4 4 0 0 0 7 0"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/>'),
  chat: svg('<path d="M4 5h16v11H9l-4 4V5z"/><path d="M8 9h8M8 12h5"/>', { w: 1.7 }),
  scoreboard: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 4v16M4 9h4M4 14h4M11 8h6M11 12h6M11 16h4"/>', { w: 1.6 }),
  exit: svg('<path d="M6 6l12 12M18 6L6 18"/>', { w: 2.3 }),
  camera: svg('<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>', { w: 1.7 }),
};

// paint every element carrying data-icon="<name>"
export function paintIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    const name = el.getAttribute('data-icon');
    if (ICONS[name]) el.innerHTML = ICONS[name];
  }
}
