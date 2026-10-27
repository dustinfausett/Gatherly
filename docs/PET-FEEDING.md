# Feeding the Tree pet

Tap the pet beside the Tree's name to feed it. The snack appears beside its beak, the bird leans forward for three pecks, and little hearts finish the interaction. The button also works with Enter or Space. It returns to **Tap to feed** afterward, ready for another snack.

All 12 existing pets participate. The bluebird, goldfinch, mint bird, cockatiel and cardinal get golden seeds; pink, lavender, coral and robin get berries; the parrot gets fruit; the owl gets little bird treats; the hummingbird gets nectar in a flower. Pet selection and unlocks continue through **Your corner → My pet**.

## Artwork and motion

`public/brand/pets/feeding-food.png` is the original transparent image generated for this feature on October 27, 2026, using Churp's existing bird collections as style references. Its six props are a woven seed dish, berry dish, fruit dish, treat dish, nectar flower and a single grain. The source sheet is 1254 × 1254 RGBA. `PetFeeding.jsx` displays clipped SVG views of the intact image and uses small crops for matching bites. The sheet is checked into GitHub and served with the app.

The pet keeps its existing perched artwork. `petFeedingMotion.js` maps each bird's original mouth and feet positions into its displayed coordinates, accounting for different shapes such as the hummingbird's long beak. The Web Animations API continuously interpolates the lean, pecks, food movement and hearts over 3.8 seconds. There is no pose swapping, stepped sprite playback, or React timer updating every frame.

Only one feeding runs at a time. Animations stop cleanly on resize, a motion preference change, switching pets, leaving the Tree or opening a Nest. The existing flight into the Nest continues to use the selected pet. With reduced motion enabled, feeding uses a brief still snack and an accessible status announcement. Feeding is local, repeatable and requires no inventory or server state.

## Checks

`e2e/pet-feeding.spec.js` exercises all 12 pets, intermediate animation transforms, snack artwork, repeat feeding, keyboard access, minimum touch size, reduced motion and navigation cleanup across desktop and phone layouts. It captures the bluebird, parrot, owl and hummingbird while eating. The existing bird collection and flight checks cover unlocks, independent avatars, all 12 flights and accurate Nest landings.
