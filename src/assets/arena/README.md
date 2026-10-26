# Approved workshop corner decoration

Built-in imagegen, 2026-10-25. User selected option 1 in chat 01a16f4a-58e5-79d1-b8fa-6a4d2283b2ea.
Reference style: src/assets/loading/workshop.jpg and src/assets/menu/settings.webp.
Prompt: transparent wide overlay; tactile painted wooden cobalt/lime/coral/purple tetromino toys, honey wood crates, restrained plants and pencils in the two bottom corners. Preserve central transparency, no UI, labels or room backdrop. A subsequent built-in edit removed only the detached upper-left foliage.
Source PNG retained. Runtime WebP: cwebp -q 88, no spatial edits. CSS displays the left/right portions in genuinely free side regions only, without reducing field size.

## Upper-left foliage (feedback F1)

Reuses the original built-in imagegen overlay from this chat, before removal of its upper-left greenery. `workshop-foliage-source.png` preserves that original wide transparent overlay; WebP uses cwebp -q 88 without spatial edits. CSS displays only the top-left strip (height .26 of displayed source width), which contains the complete hanging plant and excludes all lower objects. It is docked to the screen top-left, clipped to the existing free-side region and hidden alongside the other decoration in dense/mobile layouts.
