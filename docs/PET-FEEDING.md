# Feeding the Tree pet

Tap the pet beside the Tree's name to feed it. The snack appears beside its beak, the bird leans forward for three pecks, and little hearts finish the interaction. The button also works with Enter or Space. There are no visible feeding captions or hover hints: feeding is a discovery. Screen-reader labels and status announcements remain available.

All 18 pets participate. The bluebird, goldfinch, mint bird, cockatiel and cardinal get golden seeds; pink, lavender, coral and robin get berries; the parrot gets fruit; the owl gets little bird treats; the hummingbird gets nectar in a flower; the Christmas Bird gets candy canes. Pet selection and unlocks continue through **Your corner → My pet**.

## Seasonal availability

All six holiday pets use the same annual rules: selectable one **calendar month** before the holiday, visible but locked seven days before that, and selectable through the end of the third day after the holiday. Calendar dates and midnight boundaries use **America/Denver**. Month subtraction clamps to the last valid day (Halloween starts September 30).

| Pet | Preview begins | Selectable | Treat |
| --- | --- | --- | --- |
| Christmas | November 18 | November 25–December 28 | Candy canes |
| Valentine | January 7 | January 14–February 17 | Heart cookies |
| St. Patrick’s | February 10 | February 17–March 20 | Shamrock cookies |
| Independence | May 28 | June 4–July 7 | Star cookies |
| Halloween | September 23 | September 30–November 3 | Candy corn |
| Thanksgiving (2026) | October 19 | October 26–November 29 | Pumpkin pie |

Thanksgiving is recalculated as the fourth Thursday in November each year; availability ends that Sunday. Outside the preview and selectable windows, a pet disappears from the picker. A selected pet that leaves its season displays as Bluebird. Other pet unlocks and profile portraits are preserved.

**Public rollout:** All six holiday birds follow their annual schedules for every account, including `dustin`. Private testing flags and the username-based override have been removed. Tree ownership, client-supplied flags and unlock codes grant no out-of-season access. As of October 27, 2026, Halloween and Thanksgiving are both selectable.

The server sends `visible_birds`, `unlocked_birds` and seasonal date labels to the picker and enforces selection itself. `tests/seasonal-pets.test.js` checks all six calendars, calendar clamping, Thanksgiving across years, Denver midnight transitions, locked preview, equal enforcement for ordinary accounts and the former tester, code bypass prevention and out-of-season fallback.

## Artwork and motion

`public/brand/pets/feeding-food.png` is the original transparent image generated for this feature on October 27, 2026, using Churp's existing bird collections as style references. Its six props are a woven seed dish, berry dish, fruit dish, treat dish, nectar flower and a single grain. The source sheet is 1254 × 1254 RGBA. `PetFeeding.jsx` displays clipped SVG views of the intact image and uses small crops for matching bites. The sheet is checked into GitHub and served with the app.

`public/brand/birds/christmas.png` is the original 1254 × 1254 transparent sheet generated in the same style: the Santa bird perched, wings up, wings down and landing, plus a candy-cane dish and an individual candy cane. It is stored intact. `birdArtwork.js` supplies pose crops; feeding uses the same smooth motion and a candy-cane bite from this sheet.

`valentine.png`, `st-patrick.png`, `independence.png`, `halloween.png` and `thanksgiving.png` in the same directory are the five original generated transparent sheets. Each contains perched, wings-up, wings-down and landing poses, a treat dish and a matching single bite. `src/holidayArtwork.js` holds SVG viewports and beak/feet anchors, shared by the existing flight and feeding renderers. All six source PNGs are stored intact in GitHub.

The pet keeps its existing perched artwork. `petFeedingMotion.js` maps each bird's original mouth and feet positions into its displayed coordinates, accounting for different shapes such as the hummingbird's long beak. The Web Animations API continuously interpolates the lean, pecks, food movement and hearts over 3.8 seconds. There is no pose swapping, stepped sprite playback, or React timer updating every frame.

Only one feeding runs at a time. Animations stop cleanly on resize, a motion preference change, switching pets, leaving the Tree or opening a Nest. The existing flight into the Nest continues to use the selected pet. With reduced motion enabled, feeding uses a brief still snack and an accessible status announcement. Feeding is local, repeatable and requires no inventory or server state.

## Checks

`e2e/pet-feeding.spec.js` exercises the publicly available pets, intermediate animation transforms, snack artwork, repeat feeding, keyboard access, minimum touch size, reduced motion, absence of visible captions and navigation cleanup across desktop and phone layouts. It captures the bluebird, parrot, owl, hummingbird and Christmas Bird while eating. The existing bird collection and flight checks cover unlocks, independent avatars, flights and accurate Nest landings. `e2e/holiday-pets.spec.js` separately checks currently available holiday birds through an ordinary account: visible enabled choices, saved selection, all flight poses, Nest residency, smooth feeding, matching food, reload persistence and phone layout.
