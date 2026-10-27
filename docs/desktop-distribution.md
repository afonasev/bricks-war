# Публикация Bricks War

Это основной порядок публикации web-игры, подписанного игрового контента и установщиков. Команды выполняются из принадлежащего задаче code worktree. Авторизацию среды, QA gates, claim и leases проверяйте по `workflow/project.json` и правилам проекта; этот документ не заменяет их.

## Что и где публикуется

| Результат | Место |
| --- | --- |
| Публичный снимок исходников | `https://github.com/afonasev/bricks-war`, ветка `main` |
| DMG, ZIP, EXE, blockmap, `latest.yml`, `latest-mac.yml`, `SHA256SUMS` | GitHub Releases, тег `v<версия оболочки>` |
| Web-сборка | `https://bricks.afonasev.tech/`, VPS `/opt/bricks-war` |
| Подписанный игровой контент | GitHub Pages `https://afonasev.github.io/bricks-war/desktop/game/latest.json`; immutable assets GitHub Releases `content-<sequence>/<sha256>` |
| Ссылки для скачивания | `/desktop/latest.json`, прямые URL assets в GitHub Releases |
| Совместимость старых оболочек | `/desktop/installers/latest*.yml` на VPS с абсолютными GitHub URL |

На VPS нет EXE/DMG/ZIP/blockmap. Новые оболочки получают подписанный игровой контент через GitHub Pages и Releases. Старые оболочки продолжают использовать VPS до одноразовой замены приложения. Загруженный контент применяется кнопкой «Обновить» в безопасном главном меню и не прерывает матч.

## Перед началом

Проверьте текущую live-версию, GitHub Releases, Git-статус и чужие процессы/worktrees. Зафиксируйте исходный release и возможность вернуть предыдущую web-сборку. Нужны Node.js 24+, зависимости (`npm ci`), `gh` с доступом к публичному репозиторию, SSH-профиль `gfe` и существующий закрытый ключ `~/.config/bricks-war/content-private-key.pem`. Путь можно переопределить через `BRICKS_CONTENT_PRIVATE_KEY`.

Закрытый ключ никогда не экспортируется и не коммитится. `npm run desktop:keygen` — только первоначальная настройка или отдельная согласованная ротация: обычный релиз использует существующий ключ, соответствующий `electron/content-public-key.pem`, который закреплён в установленных клиентах.

Все `npm run desktop:*` команды запускаются из code worktree, а Git-команды публикации публичного снимка — из отдельного checkout GitHub. Репозитории имеют разную историю; не пушьте внутренний `main` в публичный репозиторий напрямую.

## 1. Подготовить версию и пройти проверки

Повышайте версию ровно один раз:

```sh
make prepare-deploy VERSION_BUMP=patch
# Для новой функции — minor, для несовместимого изменения — major.
```

Команда меняет `package.json`, `package-lock.json` и ignored `config/deployment-build.json`. Сохраните metadata в durable evidence и используйте его в checkout, из которого публикуете релиз и проверяете live identity. При новом установщике отдельно задайте `extraMetadata.version` в `electron-builder.yml`; для нового установщика с текущей игрой выбирайте ту же SemVer-версию. При content-only релизе версия оболочки остаётся прежней.

Выберите проверки по `.agents/references/qa-scope.md`. Полный набор требует отдельной явной команды человека. Для выбранного desktop-контракта:

```sh
npm run test:desktop
# Добавить только затронутые unit/browser/native проверки по сохранённому diff.
# npm run test:full — исключительно при отдельной авторизации полного прогона.
```

Добавьте затронутые network/native/device gates. Если timing-тестам нужна изоляция, существует `BRICKS_QA_WORKERS`; это не разрешение менять пороги, сценарии или считать неуспешный прогон успешным. Непройденный gate фиксируется и блокирует публикацию согласно правилам проекта.

Закоммитьте исходники и version-файлы, интегрируйте в локальный `main` под integration lease. Не меняйте код после проверок без повторной проверки затронутого поведения. Метаданные релиза и evidence могут иметь отдельные коммиты.

## 2. Обновить публичный снимок исходников

Для каждого релиза экспортируйте уже закоммиченный код в отдельный чистый checkout текущего публичного `main`:

```sh
gh repo clone afonasev/bricks-war /private/tmp/bricks-war-public-next-release
node scripts/desktop/export-public.mjs /private/tmp/bricks-war-public-next-release
```

Из публичного checkout проверьте `git status`, `git diff` и добавляемые файлы, затем закоммитьте и выполните `git push origin main`. Проверьте успешный push и точный публичный commit перед созданием тега релиза. `SOURCE_REVISION` связывает снимок с локальным коммитом; `LICENSE` и история публичного репозитория сохраняются. Экспорт включает `docs/player-guide.md` и `docs/credits.md`; внутренние OpenSpec/evidence и аппаратный acceptance plan не экспортируются. Это подготовка файлов для отдельно разрешённой публикации.

Экспорт копирует выбранные tracked-файлы, генерирует публичный README и исключает внутренние planning/evidence и закрытые ключи. Он **не удаляет** файлы, исчезнувшие из исходного проекта: при таких изменениях отдельно проверьте и удалите соответствующие устаревшие файлы в публичном checkout. Не экспортируйте грязный worktree: `SOURCE_REVISION` тогда не описывает скопированные байты.

## 3. Подготовить desktop-канал

**Обычный релиз игры:** установщики не пересобираются, `extraMetadata.version` не меняется и новый installer release на GitHub не создаётся. Подготовьте свежий подписанный контент:

```sh
node scripts/desktop/prepare.mjs
```

Перед этой командой `dist/` должен быть свежим build текущей версии; если был отдельно разрешён `test:full`, он уже выполняет сборку. После изменения кода или metadata снова выполните `npm run build` и нужные проверки.

**Новый установщик или оболочка:** очистите только принадлежащий задаче устаревший `build/installers`, затем:

```sh
npm run desktop:build
```

Первая команда собирает игру, подписывает bundled content и создаёт Universal macOS DMG/ZIP и Windows x64 NSIS. Она использует `--publish never`; публикация выполняется отдельной командой только после проверки артефактов и нужного native smoke. Для изменения bridge согласуйте совместимость `SHELL_ABI` / `minShellVersion` отдельно.

После проверки сборок и нужного native smoke, при уже подтверждённом push публичных исходников:

```sh
npm run desktop:release
```

`desktop:release` берёт версию из `electron-builder.yml`, создаёт draft `v<version>` на публичном `main`, загружает assets, сверяет GitHub digests с локальными хешами, публикует release и проверяет доступность DMG/EXE. Только затем появляется `build/github-catalog.json` для переключения VPS. Проверьте также хеш `SHA256SUMS`, точный tag commit и release notes: шаблон notes в скрипте не заменяет описание конкретного релиза.

При ошибке команды остановите зависимые шаги. Старый `build/github-catalog.json` не доказывает успех новой публикации: его версия/URL и хеши должны соответствовать текущим артефактам.

После сбоя повторите `desktop:release` с **теми же проверенными файлами**. Совпадающие draft assets переиспользуются, несовпадающие вызывают ошибку. Не используйте `--clobber` и не заменяйте байты опубликованной версии; исправленному артефакту нужна новая версия. Если release уже опубликован, а переключение сайта не удалось, повторная проверка того же релиза может восстановить локальный каталог без загрузки файлов заново.

## 4. Опубликовать подготовленный результат на VPS

Под integration lease используйте уже проверенный `dist/` и подготовленный desktop-контент. Следующий recipe не повышает версию повторно; сохраните stdout/exit codes в evidence. Для нестандартного хоста/каталога замените `gfe` и `/opt/bricks-war` согласованными значениями:

```sh
set -euo pipefail
COPYFILE_DISABLE=1 tar -C dist -czf - . | ssh -o BatchMode=yes gfe 'set -eu; install -d -m 755 /opt/bricks-war; tar -xzf - -C /opt/bricks-war; find /opt/bricks-war -type f -exec chmod 644 {} +'
```

После web upload выберите **одну** команду:

```sh
# Обновление для новых оболочек: не требует SSH/VPS.
npm run desktop:publish:content

# Только при отдельной необходимости поддержать старые установленные оболочки:
# npm run desktop:publish:content:legacy

# Новый проверенный installer release: использует build/github-catalog.json.
# npm run desktop:publish
```

`DEPLOY_HOST` переопределяет SSH-хост desktop publisher; его серверные пути фиксированы в `scripts/desktop/publish.mjs`. Legacy VPS publisher (`desktop:publish` / `desktop:publish:content:legacy`) создаёт отдельный `/opt/bricks-war-desktop/release-*`, проверяет подписанный manifest, переключает symlink `/opt/bricks-war/desktop` и выполняет публичный readback. Старый desktop-каталог удаляется только после успешной проверки; при сбое readback desktop symlink откатывается. Web upload и desktop switch не являются общей атомарной транзакцией: при частичном сбое отдельно проверьте сайт и desktop-канал и восстановите нужный результат из зафиксированных артефактов.

`make deploy` теперь публикует **текущую закоммиченную версию**, без автоматического bump: build, подпись, проверенная публикация контента на GitHub, затем web upload на VPS. Перед ним выполните `prepare-deploy`, выбранные проверки, commit и экспорт/push соответствующего публичного снимка. GitHub publisher откажет при грязных исходниках или несовпадающем `SOURCE_REVISION` **до web upload**. Для уже проверенного dist используйте отдельные шаги, чтобы не пересобирать его. Команда не создаёт установщики и не запускает QA.

## 5. Readback, evidence и завершение

Проверьте и запишите:

- `node tools/check-release.mjs`: точные версия/дата и главное меню live-сайта. Один HTTP 200 недостаточен.
- Новый канал `https://afonasev.github.io/bricks-war/desktop/game/latest.json`: валидная подпись, ожидаемые gameVersion, source commit и sequence; офлайн-запуск bundled игры и применимость обновления в меню.
- `/desktop/latest.json`: EXE и DMG указывают на правильный GitHub tag; публичные assets доступны и соответствуют проверенным хешам.
- Скачивание с опубликованного сайта для Windows/macOS; на телефоне и в native-клиенте кнопки установки нет. Готовое web-обновление имеет приоритет.
- `/desktop/installers/latest.yml` и `latest-mac.yml`: старый generic updater получает абсолютные GitHub URL текущего shell release.
- На VPS отсутствуют EXE/DMG/ZIP/blockmap; legacy game content и metadata сохраняются только для старых оболочек. В GitHub остаются опубликованные релизы; не удаляйте их при обычной очистке VPS.

Evidence связывает локальный source commit, публичный source commit/tag, версии игры и оболочки, checksums, metadata, QA и реальные URL. Не выводите signing key или credentials в логи.

Windows-установщик использует проектную иконку, имя `Bricks-War-<version>-win-x64.exe`, по умолчанию системный Program Files и не показывает выбор «для пользователя / для всех». Каталог установки можно изменить. Обе отмеченные галочки — ярлык и запуск — на последнем экране; ручная повторная установка восстанавливает отсутствующий ярлык. Silent `/NoDesktopShortcut` и выбор ярлыка при автоматическом обновлении сохраняются.

Реальная установка/удаление, ярлык, запуск и сценарий с другой admin-учётной записью на Windows требуют отдельной проверки. Developer ID/notarization и реальный macOS shell update также имеют отдельные gates. Cross-packaging, PE icon inspection, browser QA и macOS offline smoke не заменяют platform/human acceptance.

Перед удалением claimed worktree сохраните и интегрируйте его запись, выполните `flow.py release` из ещё существующего worktree, затем закоммитьте и интегрируйте owner-free record. Удалите только собственные временные сборки, checkout и ветку после проверки сохранности исходников/артефактов. Cleanup и `finalize` выполняйте из стабильного checkout. При ожидающей приёмке результат остаётся `awaiting-acceptance`; архивирование требует явной приёмки.

Изменение только инструкций не требует bump, пересборки приложения или новой выкладки. Достаточно проверить diff, ссылки и соответствие реальным scripts, сохранить Git-коммит и убрать временные ресурсы задачи.

## GitHub-only канал игры: первоначальная настройка и миграция

Новая оболочка проверяет фиксированный `https://afonasev.github.io/bricks-war/desktop/game/latest.json`, скачивает файлы с `https://github.com/afonasev/bricks-war/releases/download/content-<sequence>/<sha256>` и не использует VPS для обновлений. Сетевые матчи продолжают обращаться к прежнему сервису. Подпись Ed25519, high-water sequence, hash каждого файла, atomic staging, rollback и явное применение в меню сохраняются.

Первую настройку GitHub Pages, push и выпуск новой оболочки выполняйте только по отдельной команде человека. Создайте публичную ветку `gh-pages` с `.nojekyll` и включите Pages: Deploy from a branch, `gh-pages`, `/`, **без custom domain**. Runtime URL остаётся на `github.io`, поэтому DNS сайта игры/VPS не участвует. Publisher проверяет настройки read-only и не включает Pages сам. Не копируйте signing key в GitHub или ветку Pages.

Порядок обычного контентного выпуска: проверить/закоммитить исходники и version metadata, экспортировать публичный снимок с совпадающим SOURCE_REVISION, собрать dist, `node scripts/desktop/prepare.mjs`, затем:

```sh
npm run desktop:publish:content:plan # только локальный план, без сетевых записей
npm run desktop:publish:content      # отдельная явная команда на публикацию
```

Publisher создаёт или продолжает draft `content-<sequence>`, загружает deduplicated SHA256 assets и `manifest.json`, проверяет GitHub digests и публичные байты, публикует **prerelease, latest=false**, затем обновляет только Pages pointer. Stable latest остаётся установщиком. Указатель нельзя откатить на меньший sequence или повторно использовать sequence с другими байтами; push без force защищает от конкурирующего publisher. Предыдущие content releases не удаляются: они нужны запущенным загрузкам. При сбое повторяйте **тот же подготовленный контент**, без `--clobber` и новой подписи/sequence. Если Pages readback ещё не подтвердился, выпуск не считать завершённым; сохранить артефакты и повторить проверку.

Нельзя переводить старую оболочку HTTP redirect с VPS: она запрещает redirects и адрес зашит в main process. Подготовьте один новый macOS/Windows установщик с этим кодом; версию `extraMetadata.version` повысить в отдельном release scope. Историческая ручная замена unsigned macOS не является ограничением custom-helper: локальный packaged A→B можно проверить без Developer ID. Заявляйте только фактически проверенный срез; публичная Gatekeeper/quarantine и привилегированная установка остаются отдельными gates. Сохранить профиль userData, настройки и старую рабочую копию. После разовой замены следующие игровые updates идут с GitHub без пересборки установщиков.

В меню появились состояния Проверка / Загрузка и ошибка с Повторить. Ошибка повторной проверки не уничтожает готовый проверенный пакет. Native smoke нового установщика должен проверить отсутствие запросов обновления к VPS, GitHub/CDN redirects, safe-menu apply, сохранность настроек, restart и offline play. Browser/native mock smoke не заменяет реальные Windows/macOS gates.

## Template adoption (2026-10-15, supersedes runtime descriptions above)

The new implementation pins game-spec-templates a4ee2d8 (see [connection](game-template/CONNECTION.md)). New ABI-2 shells discover stable Releases through GitHub API once per process. GitHub Pages pointers remain only for legacy clients. New content is stable (`prerelease=false`, `latest=false`), signed game/component/channel identity and `minShellVersion=2`; old immutable prereleases are not modified. Native publication additionally uploads signed `shell-manifest.json`. Neither discovery nor history starts package download. Player consent starts the selected package; cancel/retry, bytes progress, drain-before-match and resume are implemented by one main-process coordinator. Completed content applies before the next renderer launch. Completed shell stays pending on ordinary quit and applies before the next renderer startup (or immediately on explicit Restart), with macOS bundle backup/startup-health rollback and an external Windows installer/recovery helper.

No timer, online handler or manual action repeats discovery. A failed startup check waits until the next app session. Download retry concerns only the selected package. History is available even without an update, includes installed content/shell and five recent releases of each component, and selects matching `## Русский`, `## English`, `## Français`, `## Deutsch`, `## Español`, `## 日本語` or `## 简体中文` sections when present. Existing untranslated release bodies are displayed as explicitly labelled legacy fallback, not invented translations. Generated bilingual notes require Git commit trailers or reviewed `BRICKS_RELEASE_NOTES` annotations; publication fails if an included commit lacks translations/classification. This is a source preparation requirement, not permission to publish.

The new shell must be packaged and verified on macOS/Windows under a separate build/release instruction before publication. Source fixtures do not establish UAC/PowerShell policy, /Applications permissions, real replacement, shortcut retention, codesigning or physical-pad acceptance. Developer ID/notarization remains an explicit unsigned-testing limitation; signed update metadata is always required even for unsigned applications. Keep the previous bundle and pending platform gates until real verification.


## One application version and compatible updates (ABI 3)

The menu and game history show one active application/game version. Shell version remains internal diagnostic state in the bridge. Downloaded or prepared content never changes the installed version label.

`electron/compatibility.mjs` owns `CONTENT_ABI=3` (rating routes plus coordinated updates) and the minimum semantic shell release. Signed game manifests include both `minShellVersion` (ABI) and `minShellRelease`; signed shell manifests include `contentAbi` and the bundled `contentSequence`. A native release binds its version to the signed bundled game version. New shell capabilities require an explicit compatibility change; accepting schema 1 alone does not establish support for a new feature.

Discovery exposes incompatible newest content as `shell-required` if no complete trusted compatible installer exists. It must not silently report idle/current or fall back to older content. If the installer already bundles the target or newer game, it supplies the full update. Otherwise one consent prepares the installer without a ready receipt, stages the target content against its signed capabilities, and commits installer readiness only after both validate. Old-shell startup preserves incompatible pending content without activating it; the installed new shell revalidates before activation. Failure/cancel/recovery preserves the working game and data; recovery remains visible. During a match transfers use the existing activity barrier.

Before any dependent content release, the publisher performs a read-only gate requiring complete public stable signed Windows and macOS packages that support its requirements. Missing packages, draft/prerelease, wrong digests or incompatible requirements block publication before creating a content release or switching discovery pointers. Publish the next full native application first, then its dependent content; do not reuse the immutable public `1.10.0` artifacts. Older ABI-2 clients cannot receive this new UI via incompatible content, so the next release must deliver a new native package through the existing shell updater (or normal installer recovery).

Verification must exercise shell-dependent features such as the live native rating GET, not only version text. Source Electron/macOS evidence is not installed Windows A→B, OS permissions, or human acceptance. Publication still requires a separate explicit command.


## Changelog screenshots
Release-note images use Markdown `![caption](https://raw.githubusercontent.com/afonasev/bricks-war/<40-character-commit>/docs/release-notes/<version>/<image>.png)`. Export and publish the screenshot sources first, then reference their immutable public commit. Raster PNG/JPEG/WebP/GIF images are supported; native transport caps each image at4MiB. Other origins, mutable refs, redirects and HTML are not enabled. Failed images retain a localized fallback and caption.

The inline-image renderer and the native image transport must be delivered together for desktop image support. Existing v1.11.0 shells lack that route and can only show the unavailable-image fallback. A future release of this feature needs a separately authorized native rebuild/publication and a matching minimum-shell release before content publication; the current source change does not publish or choose a new shell version.

## Local packaged shell-update witness

`node scripts/desktop/smoke-shell-update.mjs <path-to-fresh-Bricks-War.app>` exercises the existing custom updater on macOS in a unique `build/shell-witness-*` installation/profile. Prepare a fresh signed content build and an arm64 `electron-builder --mac --dir --arm64 --publish never` package first. This is minimum native QA, not a release. The runner requires 2.5 GiB free and records a durable unique result under `evidence/self-update-witness/`; preserve FAIL/NotRun results.

The runner adds a launcher and signed local transport fixtures only inside the generated QA `app.asar`. Production trust validation is unchanged. QA-only versions A=1.11.0, B=1.12.2 and failing C=1.12.3 are not public release identities. A uses the current shell with the image route disabled to model the old capability; it is not the immutable published v1.11.0 binary. It exercises download, digest/signature verification, helper acknowledgement, replacement, actual new main-process route (404→403 for a deliberately forbidden image URL), startup health, preserved localStorage/display preferences, offline restart, next-launch application and real failed-startup rollback with the existing 90-second timeout. It never targets `/Applications`, changes system volume or publishes assets. Generated apps run muted from startup. Keep exact retained artifacts and hashes for open acceptance; remove intermediate owned build/profile copies after evidence preservation.

Windows helper and elevated restore launch PowerShell with `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File`. This is a process-scoped policy for the copied application helper, not a persistent system/user setting; Group Policy retains priority. See [Microsoft's Windows PowerShell execution policy documentation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1). NSIS remains per-machine and still requests UAC. Real Windows installation/UAC/shortcut retention and alternate administrator credentials require a Windows host; macOS/source checks do not establish them. An already installed old shell lacking this argument cannot acquire the fix before its first shell update; test the actual installed baseline under its effective policy, and preserve the normal installer recovery option if that baseline cannot start its helper. Do not describe a new-package test as proof that all existing Windows installations can complete their first update.
