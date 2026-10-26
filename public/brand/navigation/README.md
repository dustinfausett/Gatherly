# Churp bottom navigation

The approved tree artwork is reused from `../previews/churp-tree-nest-icons.png`. The two new transparent illustrations were generated using the approved Churp logo as a reference and are used by the real navigation, empty states, Birdhouses and message composer.

| Messages: two birds talking | Contacts: a birdhouse |
| --- | --- |
| <img src="messages.png" width="220" alt="Blue and gold birds talking" /> | <img src="contacts.png" width="220" alt="Olive-roofed wooden birdhouse with a blue bird" /> |

The original PNGs are preserved. `NavigationArt` in `src/Contacts.jsx` uses a display viewport for the bird pair to remove spare transparent space at tiny navigation sizes. Active icons use an olive tint; inactive icons are subdued. Visible labels and accessible names accompany all three tabs. The source files have no background so they can be displayed on light and dark surfaces without an opaque square.
