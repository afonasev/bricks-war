# Bricks War — credits and asset provenance

Prepared source credits for the public-launch candidate. This file records provenance found in the repository; the owner has declared the current project personal and noncommercial; any future publication remains a separate decision. Generation manifests live in the local planning/evidence archive and are not included by the public source export; license/provenance files under src/assets are retained with the source.

| Material | Credit / recorded origin | Evidence |
| --- | --- | --- |
| Game | © 2026 Evgeniy Afonasev · afonasev.tech | Shared runtime footer in `src/ui/releaseMetadata.ts` |
| Source snapshot | The existing public source repository declares MIT; public export preserves its LICENSE | [Public repository](https://github.com/afonasev/bricks-war), `scripts/desktop/export-public.mjs`. The local planning repository does not itself add a new blanket asset license |
| Workshop menu, loading art and BRICKS WAR logo | Built-in imagegen; approved source images and encoded runtime derivatives retained | `src/assets/menu/README.md`, `src/assets/loading/README.md`, `src/assets/brand/README.md` |
| Controls illustration | Built-in imagegen edit of the retained source; runtime labels remain live localized UI | `docs/game-template/ART.md` |
| Soft Toy / Quiet Mechanism SFX | Bub Block Sound Effects — roppychop / Roppy Chop Studios; repository records CC0 1.0 | `src/assets/audio/realistic-sfx/LICENSE.md`, `src/assets/audio/quiet-mechanism/LICENSE.md`, derivative `provenance.json`; [source pack](https://opengameart.org/content/bub-block-sound-effects) |
| Board effects | Selected source clips with source directory, original commit and approved unchanged WAV copying recorded | `src/assets/audio/board-events/provenance.json`; this is provenance evidence, not an invented separate license |
| Music: menu and four match themes | Local Stable Audio 3 generation/variation, seeds and commands; original references and assembly retained | `evidence/music-style-concepts/README.md`, `suite/README.md`, per-track `manifest.json`, `src/audio/musicCatalog.ts`, `public/audio/music/` |
| Runtime dependencies | Preserve the corresponding notices/licenses from packaged dependencies, including Phaser and native shell dependencies | Locked dependency versions in `package-lock.json`; final artifact notice inventory must use the exact packaged candidate |

## Music licensing checkpoint

Generation manifests identify self-hosted Stable Audio 3. The current official [Stable Audio licensing guide](https://kb.stability.ai/knowledge-base/stable-audio-commerical-and-usage-licensing) distinguishes hosted-service terms from the license of self-hosted models. [Core Models](https://stability.ai/core-models) includes Stable Audio3.0 Small/Medium. The [Community License](https://stability.ai/community-license-agreement) covers qualified uses, requires registration for commercial model use and sets a revenue threshold; it also addresses output ownership and use restrictions.

On 2026-10-24 the project owner declared Bricks War a personal, noncommercial project. The recorded intended licensing basis for the locally generated Stable Audio 3 music is noncommercial use under the applicable Community License. Generation manifests, prompts, seeds and available reference provenance are retained. This declaration does not assert that every third-party reference right has independently been verified.

Before introducing commercial use, review the terms applicable to the exact model and use at that time, including any registration or separate-license requirements. No commercial registration or separate license purchase was performed by this initiative. Model-code MIT licensing is not substituted for model/output terms.

Links were checked on2026-10-24. This is a factual release-preparation checkpoint, not a declaration that any unverified publication right has been approved. No new attribution UI, brand or third-party endorsement is introduced by these notes.
