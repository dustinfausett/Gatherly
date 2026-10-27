# Churp pet artwork

The PNGs in this folder are original generated artwork stored intact. The app uses SVG viewports, rather than modified image files, to display individual poses and food props.

## Holiday pets

Each transparent 1254 × 1254 sheet has perched, wings-up, wings-down and landing poses, followed by a food dish and a single matching bite. The birds use the same soft sculpted style as the Churp logo.

| Sheet | Bird | Food |
| --- | --- | --- |
| [christmas.png](christmas.png) | Santa suit and hat | Candy canes |
| [valentine.png](valentine.png) | Pink, heart headband and red capelet | Heart cookies |
| [st-patrick.png](st-patrick.png) | Green hat, vest and shamrock | Shamrock cookies |
| [independence.png](independence.png) | Blue, striped hat and patriotic bowtie | Star cookies |
| [halloween.png](halloween.png) | Lavender, witch hat and pumpkin capelet | Candy corn |
| [thanksgiving.png](thanksgiving.png) | Gold, autumn leaves, russet vest and scarf | Pumpkin pie |

Pose viewports and food/beak/feet coordinates live in `src/holidayArtwork.js`. The existing flight and continuous feeding animations consume the same sheet. Annual availability are documented in [PET-FEEDING.md](../../../docs/PET-FEEDING.md).
