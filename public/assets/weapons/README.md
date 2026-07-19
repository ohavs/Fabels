# Weapon viewmodel images (optional override)

The game now ships **detailed low-poly 3D weapon models built in code**
(`buildGunMesh` in `js/weapons.js`). Real 3D is the default because it
handles aiming-down-sights (ADS) and every camera angle automatically —
a flat 2D sprite can't rotate when you aim.

This folder is only an **optional override**: drop a transparent-background
PNG here and it replaces the 3D first-person viewmodel for that weapon.
If no file is present (the normal case), the 3D model is used. The
third-person weapon in the character's hand always uses the 3D model.

**Filenames** (one per weapon, exact names):

| file           | weapon (Hebrew)     |
|----------------|---------------------|
| `pistol.png`   | אקדח (pistol)       |
| `smg.png`      | תת־מקלע (SMG)        |
| `shotgun.png`  | רובה ציד (shotgun)  |
| `rifle.png`    | רובה סער / AR       |
| `lmg.png`      | מקלע כבד (LMG)      |
| `sniper.png`   | רובה צלפים (sniper) |
| `plasma.png`   | קרן פלזמה (plasma)  |
| `knife.png`    | סכין (knife)        |

**How to make them:** generate the weapon on a **pure white** background
(so you can delete the background to transparency), at the first-person
viewmodel angle — grip toward the lower-right, barrel toward the
upper-left. Then remove the white background and save as PNG here.
See the prompts I gave you in chat.

The image is shown as a 2D sprite in first person; the character's hand
in third person keeps the 3D model (works from every angle).
