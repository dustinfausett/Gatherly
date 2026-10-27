# Feeding the Tree pet

Tap the pet beside the Tree's name to feed it. The snack appears beside its beak, the bird leans forward for three pecks, and little hearts finish the interaction. The button also works with Enter or Space. There are no visible feeding captions or hover hints: feeding is a discovery. Screen-reader labels and status announcements remain available.

All 13 pets participate. The bluebird, goldfinch, mint bird, cockatiel and cardinal get golden seeds; pink, lavender, coral and robin get berries; the parrot gets fruit; the owl gets little bird treats; the hummingbird gets nectar in a flower; the Christmas Bird gets candy canes. Pet selection and unlocks continue through **Your corner → My pet**.

## Christmas Bird availability

The Christmas Bird is an included seasonal pet, wearing a red Santa suit and hat. Early testing is complete: `CHRISTMAS_PREVIEW_ENABLED` in `shared/birds.js` is `false`.

Availability runs November 1 through the end of January 3, using America/Denver calendar dates, and repeats every year. The server checks both the unlocked collection and explicit selection requests; an unlock code cannot bypass the season. An out-of-season selected Christmas Bird displays as the Bluebird. The picker labels the seasonal dates when unavailable. `tests/seasonal-pets.test.js` checks both date boundaries, default enforcement, API selection, code bypass prevention and the fallback. General pet account tests freeze their seasonal clock in December; browser tests exercise the currently available collection.

## Artwork and motion

`public/brand/pets/feeding-food.png` is the original transparent image generated for this feature on October 27, 2026, using Churp's existing bird collections as style references. Its six props are a woven seed dish, berry dish, fruit dish, treat dish, nectar flower and a single grain. The source sheet is 1254 × 1254 RGBA. `PetFeeding.jsx` displays clipped SVG views of the intact image and uses small crops for matching bites. The sheet is checked into GitHub and served with the app.

`public/brand/birds/christmas.png` is the original 1254 × 1254 transparent sheet generated in the same style: the Santa bird perched, wings up, wings down and landing, plus a candy-cane dish and an individual candy cane. It is stored intact. `birdArtwork.js` supplies pose crops; feeding uses the same smooth motion and a candy-cane bite from this sheet.

The pet keeps its existing perched artwork. `petFeedingMotion.js` maps each bird's original mouth and feet positions into its displayed coordinates, accounting for different shapes such as the hummingbird's long beak. The Web Animations API continuously interpolates the lean, pecks, food movement and hearts over 3.8 seconds. There is no pose swapping, stepped sprite playback, or React timer updating every frame.

Only one feeding runs at a time. Animations stop cleanly on resize, a motion preference change, switching pets, leaving the Tree or opening a Nest. The existing flight into the Nest continues to use the selected pet. With reduced motion enabled, feeding uses a brief still snack and an accessible status announcement. Feeding is local, repeatable and requires no inventory or server state.

## Checks

`e2e/pet-feeding.spec.js` exercises all 13 pets, intermediate animation transforms, snack artwork, repeat feeding, keyboard access, minimum touch size, reduced motion, absence of visible captions and navigation cleanup across desktop and phone layouts. It captures the bluebird, parrot, owl, hummingbird and Christmas Bird while eating. The existing bird collection and flight checks cover unlocks, independent avatars, all 13 flights and accurate Nest landings.
