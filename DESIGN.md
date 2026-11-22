# SCRAN! — design notes

The brief: a 2.5D seaside promenade, seagulls stealing fish and chips, people who shield their food
when they can see you (so surprise is everything), bins to scavenge, rival gulls, 1–4 local players on
controllers, and every gull able to **walk, run wings-up, fly, swoop and poop**. Fun, colourful, cute,
set somewhere like Oban or Largs.

Below is what I borrowed from well-loved brawlers and party games, and how each idea turned into a
mechanic.

## What the genre teaches

| Lesson | Where it comes from | How SCRAN! uses it |
|---|---|---|
| **Shared single screen, always readable.** Couch players need to see everyone at once; no split-screen. | *TowerFall*, *Duck Game*, *Overcooked* | One fixed 1920×1080 promenade. Every gull has a player-coloured ring, scarf, name tag and HUD card. |
| **Tiny moveset, deep interactions.** Few buttons, many contextual outcomes. | *Smash Bros.* (one attack button, context decides), *Overcooked* (one "use") | Peck means peck, pick up, steal, rake a bin or hit a gull on the ground; in the air the same button is a swoop; while carrying, holding it means eat. |
| **2.5D "belt" depth with shadows and depth sorting.** Shadows tell you where something airborne will land. | *Castle Crashers*, *Streets of Rage* | A depth axis with perspective scaling; every entity casts a ground shadow; everything is depth-sorted, and things on top of props sort after the prop. |
| **NPCs with readable sight-lines make stealth funny, not frustrating.** | *Untitled Goose Game* | People have vision cones (shown faintly on the ground), a visible `?` → `!` alert build-up, and react in character. Approach from behind, or from high above, and you're invisible. |
| **Knockback and "drop the prize" instead of health bars.** Getting hit is a setback, not elimination. | *Smash Bros.*, *Gang Beasts*, *Party Animals* | Pecks, dashes, swoops and poops knock food loose; the loose food is up for grabs, and a swoop catches it mid-air. Brief invulnerability after a hit stops stun-locking. |
| **Hit-stop, screen shake and rumble sell impacts.** | *Smash Bros.* hitlag, most modern brawlers | A short freeze on big hits, a shake (can be switched off), controller rumble, feathers and impact bursts. |
| **Hold the prize and become the target.** Holding the valuable thing slows you and paints a bullseye. | "Keep-away" modes; Smash Ball; *Mario Party* stars | Carrying food weighs you down (weaker flaps, slower), and the Golden Supper is a 300-point hot potato. |
| **Stage hazards and events keep rounds from going stale.** | *Smash Bros.* stage hazards, *Overcooked* moving kitchens | Seven seaside events (ferry, rain, fishing boat, Golden Supper, loose dog, piper, teatime rush), three per round, announced with a banner. |
| **Short rounds, best-of matches, crowns for round wins.** | *TowerFall* | 2-minute rounds by default; round wins are tracked as crowns; the match ends when someone has a majority. |
| **Gentle catch-up, no rubber-banding.** | *Mario Kart* items, *Mario Party* last-5-turns | The leader wears a crown and is spotted by people 35% faster; the Final Frenzy doubles points in the last 20 seconds. |
| **End-of-match awards so everyone leaves with something.** | *Overcooked*, *Mario Party* bonus stars, *TowerFall* stats | Sneaky Beak, Bombardier, Master Thief, Bruiser, Bin Raker, Golden Gob, Slapped Silly, Butterwings, Dive Bomber, Loudmouth. |
| **Drop-in lobby, any device, CPUs fill gaps.** | Most couch party games | Press A on any pad (or Space / Enter) to join. Hats are cosmetic. CPU gulls at three skill levels, using the same input path as humans. |
| **A live attract mode sells the game before anyone touches it.** | Arcade cabinets | The title and menus run a real match between CPU gulls in the background. |

## The core loop

1. **Spot** food: someone carrying chips, an order on a counter, a full bin, a rival with a full beak.
2. **Approach** without being seen: from behind, from high up, or after a well-placed poop.
3. **Snatch** it: a ground peck or a swoop. Sneaky steals score a bonus.
4. **Escape** to a safe perch (roof, lamp post, railing, bench) while you're heavy and slow.
5. **Eat** by holding Peck, bite by bite. A hit makes you drop it, so rivals will come for you.

Bites score as you go, so a half-eaten supper is never a total loss, and there's always a reason to
interrupt someone else's meal.

## People are the stage

- **Vision:** a cone that turns with the person's gaze. Walkers glance sideways now and then; people
  sitting glance over their shoulders. Gulls higher than about 180px are noticed at roughly half the
  range. Noise gives you away too: running or dashing right beside someone alerts them.
- **States:** queue → collect from the counter → sit, stand or stroll while eating → bin the wrapper
  (or drop litter) → leave. If they're robbed they get angry, and some go back to buy another.
- **Reactions:** shield the food and swat when alert; wipe their head and stop looking when pooped on;
  kids may drop ice creams when squawked at; umbrellas block attacks from above in the rain.
- **Shopkeepers** guard the hatch while facing out, and turn their backs to cook. A busy queue means
  the counter is unguarded more often.

## Setting

- **Oban Bay:** a pastel Victorian seafront with a chippy, a bakery, a pub, an ice-cream shop and a
  café; a green seafood hut on the pier; McCaig's Tower on the hill; Kerrera and Mull across the bay;
  a west-coast ferry that docks during the ferry event.
- **Largs Prom:** a Viking chippy, an art-deco ice-cream parlour, the 2p-falls amusements; the Pencil
  monument by the shore; Great Cumbrae and Arran across the water; a Viking longship on the prom.
- Scots voice lines ("Ya wee rascal!", "Gonnae no?", "Help ma boab!"), Scots food (fish suppers,
  pokey hats, Scotch pies, jeely pieces), tartan, a piper, a Westie, and rain arriving exactly when
  you'd expect it.

All shop names are made up. No real businesses are depicted.

## Tuning snapshot

- Gull: walk 250 px/s, run 440, dash burst 800 for 0.26s; flap impulse 410, glide fall −115 px/s;
  swoop 700 horizontal / 640 down; 3 poops that refill over time and with every bite.
- A carried supper cuts flap lift by about 36% and speed by about 20%.
- People: about 11 on the prom (more during events), a vision range of 210–350 px and a field of view
  of 64° (teens on their phones) to 120° (kids).
- In simulated 2-minute rounds, CPU gulls score about 700–1,050 (Chick), 1,000–2,000 (Gull) and
  1,750–1,950 (Gannet). Each gull averages 5–10 steals, plenty of bin raids and a few scraps per round.
