# Weapon viewmodel images

Drop transparent-background PNGs here and they replace the procedural
first-person weapon automatically (the game tries to load each file at
runtime; if it isn't there, it falls back to the built-in 3D model).

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
