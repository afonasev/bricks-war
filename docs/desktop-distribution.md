# Публикация Bricks War

Это основной порядок публикации web-игры, подписанного игрового контента и установщиков. Команды выполняются из принадлежащего задаче code worktree. Авторизацию среды, QA gates, claim и leases проверяйте по `workflow/project.json` и правилам проекта; этот документ не заменяет их.

## Что и где публикуется

| Результат | Место |
| --- | --- |
| Публичный снимок исходников | `https://github.com/afonasev/bricks-war`, ветка `main` |
| DMG, ZIP, EXE, blockmap, `latest.yml`, `latest-mac.yml`, `SHA256SUMS` | GitHub Releases, тег `v<версия оболочки>` |
| Web-сборка | `https://bricks.afonasev.tech/`, VPS `/opt/bricks-war` |
| Подписанный игровой контент | `/desktop/game/latest.json` и каталог его sequence на VPS |
| Ссылки для скачивания | `/desktop/latest.json`, прямые URL assets в GitHub Releases |
| Совместимость старых оболочек | `/desktop/installers/latest*.yml` на VPS с абсолютными GitHub URL |

На VPS нет EXE/DMG/ZIP/blockmap. Подписанный игровой контент остаётся на VPS: это отдельный канал обновления, доступный уже установленной игре. Загруженный контент применяется кнопкой «Обновить» в безопасном главном меню и не прерывает матч.

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

Выберите проверки по `.agents/references/qa-scope.md`. Для release gate:

```sh
npm run test:full -- --reason "release: describe changed behavior and consumers"
npm run test:desktop
```

Добавьте затронутые network/native/device gates. Если timing-тестам нужна изоляция, существует `BRICKS_QA_WORKERS`; это не разрешение менять пороги, сценарии или считать неуспешный прогон успешным. Непройденный gate фиксируется и блокирует публикацию согласно правилам проекта.

Закоммитьте исходники и version-файлы, интегрируйте в локальный `main` под integration lease. Не меняйте код после проверок без повторной проверки затронутого поведения. Метаданные релиза и evidence могут иметь отдельные коммиты.

## 2. Обновить публичный снимок исходников

Для каждого релиза экспортируйте уже закоммиченный код в отдельный чистый checkout текущего публичного `main`:

```sh
gh repo clone afonasev/bricks-war /private/tmp/bricks-war-public-next-release
node scripts/desktop/export-public.mjs /private/tmp/bricks-war-public-next-release
```

Из публичного checkout проверьте `git status`, `git diff` и добавляемые файлы, затем закоммитьте и выполните `git push origin main`. Проверьте успешный push и точный публичный commit перед созданием тега релиза. `SOURCE_REVISION` связывает снимок с локальным коммитом; `LICENSE` и история публичного репозитория сохраняются.

Экспорт копирует выбранные tracked-файлы, генерирует публичный README и исключает внутренние planning/evidence и закрытые ключи. Он **не удаляет** файлы, исчезнувшие из исходного проекта: при таких изменениях отдельно проверьте и удалите соответствующие устаревшие файлы в публичном checkout. Не экспортируйте грязный worktree: `SOURCE_REVISION` тогда не описывает скопированные байты.

## 3. Подготовить desktop-канал

**Обычный релиз игры:** установщики не пересобираются, `extraMetadata.version` не меняется и новый installer release на GitHub не создаётся. Подготовьте свежий подписанный контент:

```sh
node scripts/desktop/prepare.mjs
```

Перед этой командой `dist/` должен быть свежим build текущей версии; успешный `test:full` уже выполняет сборку. После изменения кода или metadata снова выполните `npm run build` и нужные проверки.

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
# Обычное обновление игры: сохраняет существующие GitHub ссылки и metadata.
npm run desktop:publish:content

# Новый проверенный installer release: использует build/github-catalog.json.
# npm run desktop:publish
```

`DEPLOY_HOST` переопределяет SSH-хост desktop publisher; его серверные пути фиксированы в `scripts/desktop/publish.mjs`. Publisher создаёт отдельный `/opt/bricks-war-desktop/release-*`, проверяет подписанный manifest, переключает symlink `/opt/bricks-war/desktop` и выполняет публичный readback. Старый desktop-каталог удаляется только после успешной проверки; при сбое readback desktop symlink откатывается. Web upload и desktop switch не являются общей атомарной транзакцией: при частичном сбое отдельно проверьте сайт и desktop-канал и восстановите нужный результат из зафиксированных артефактов.

`make deploy` остаётся короткой командой обычного content-only релиза: сам делает prepare/bump, build, подпись и upload. **Не запускайте его после отдельного `prepare-deploy`, build установщиков или подготовки проверенного релиза той же версии.** Он не выполняет QA, экспорт исходников или создание GitHub installer release. Для последовательности с проверками после bump используйте шаги выше.

## 5. Readback, evidence и завершение

Проверьте и запишите:

- `node tools/check-release.mjs`: точные версия/дата и главное меню live-сайта. Один HTTP 200 недостаточен.
- `/desktop/game/latest.json`: валидная подпись, ожидаемые gameVersion, source commit и sequence; офлайн-запуск bundled игры и применимость обновления в меню.
- `/desktop/latest.json`: EXE и DMG указывают на правильный GitHub tag; публичные assets доступны и соответствуют проверенным хешам.
- Скачивание с опубликованного сайта для Windows/macOS; на телефоне и в native-клиенте кнопки установки нет. Готовое web-обновление имеет приоритет.
- `/desktop/installers/latest.yml` и `latest-mac.yml`: старый generic updater получает абсолютные GitHub URL текущего shell release.
- На VPS отсутствуют EXE/DMG/ZIP/blockmap, подписанный game content и metadata сохранены. В GitHub остаются опубликованные релизы; не удаляйте их при обычной очистке VPS.

Evidence связывает локальный source commit, публичный source commit/tag, версии игры и оболочки, checksums, metadata, QA и реальные URL. Не выводите signing key или credentials в логи.

Windows-установщик использует проектную иконку, имя `Bricks-War-<version>-win-x64.exe`, по умолчанию системный Program Files и не показывает выбор «для пользователя / для всех». Каталог установки можно изменить. Обе отмеченные галочки — ярлык и запуск — на последнем экране; ручная повторная установка восстанавливает отсутствующий ярлык. Silent `/NoDesktopShortcut` и выбор ярлыка при автоматическом обновлении сохраняются.

Реальная установка/удаление, ярлык, запуск и сценарий с другой admin-учётной записью на Windows требуют отдельной проверки. Developer ID/notarization и реальный macOS shell update также имеют отдельные gates. Cross-packaging, PE icon inspection, browser QA и macOS offline smoke не заменяют platform/human acceptance.

Перед удалением claimed worktree сохраните и интегрируйте его запись, выполните `flow.py release` из ещё существующего worktree, затем закоммитьте и интегрируйте owner-free record. Удалите только собственные временные сборки, checkout и ветку после проверки сохранности исходников/артефактов. Cleanup и `finalize` выполняйте из стабильного checkout. При ожидающей приёмке результат остаётся `awaiting-acceptance`; архивирование требует явной приёмки.

Изменение только инструкций не требует bump, пересборки приложения или новой выкладки. Достаточно проверить diff, ссылки и соответствие реальным scripts, сохранить Git-коммит и убрать временные ресурсы задачи.
