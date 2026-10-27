# Churp Home Screen icon

<img src="churp-home-source.png" alt="Blue and gold Churp birds in a nest, cream center and green leaf corners" width="300"/>

Prepared from the user's approved green bird-and-nest reference using image generation to remove its outside white presentation frame and make a square full-bleed icon. The source is preserved here. The original generated source is also retained in the execution workspace.

The 192px, 512px and 180px Apple PNGs are exact size variants of this prepared source, resampled with ImageMagick. No notification badge is painted into the artwork; the device displays live badges separately. Android's maskable variant uses the full-bleed image, with the birds within the central safe area.

The manifest and Apple touch link use new `churp-home-*` paths to refresh cached assets while retaining manifest `id` and `start_url`. The earlier `churp-*` paths also serve the new artwork for existing references. iOS may retain an installed shortcut's icon until it is re-added.
