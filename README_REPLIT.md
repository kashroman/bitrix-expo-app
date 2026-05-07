# Bitrix24 Expo App for interpro.pro

Внешнее приложение для облачного портала Bitrix24 `https://b24-5syfa7.bitrix24.ru`.

## Назначение

Приложение работает внутри iframe Bitrix24 и не хранит отдельную копию CRM-данных. Чтение и сохранение выполняются через `BX24.callMethod` в контексте текущего пользователя.

## Экраны

- `/install` или `/#/install` — установка приложения, `placement.bind`, `BX24.installFinish()`.
- `/deal-tab` или `/#/deal-tab` — вкладка карточки сделки.
- `/expo-tab` или `/#/expo-tab` — вкладка карточки смарт-процесса “Выставки”.
- `/calendar` или `/#/calendar` — отдельный календарь выставок.

## Replit

1. Создайте новый Repl из ZIP-архива или импортируйте папку проекта.
2. Выполните `npm install`.
3. Для разработки используйте `npm run dev`.
4. Для Deployments используйте команду `npm run build && npm run start`.
5. Скопируйте HTTPS URL Replit и укажите его как URL установки локального приложения Bitrix24:
   `https://YOUR-REPLIT-URL/install`

## Bitrix24 scopes

Для локального приложения нужны права:

- `crm`
- `placement`

## Placement’ы

- `CRM_DEAL_DETAIL_TAB` → `/deal-tab`
- `CRM_DYNAMIC_{entityTypeId}_DETAIL_TAB` → `/expo-tab`
- `CRM_ANALYTICS_MENU` → `/calendar`

`entityTypeId` определяется при установке через `crm.type.list` по названию смарт-процесса “Выставки”. Если процесс не найден автоматически, на странице установки можно указать ID вручную.

## Что определяется автоматически

- `entityTypeId` смарт-процесса “Выставки”.
- Поле привязки выставки в сделках.
- Поле привязки выставки в лидах.
- Даты монтажа, начала/окончания проведения, демонтажа.
- Итоговые поля результатов по названиям “итог”, “результат”, “выручка”, “лиды”, “сделки”.

## Smart Enrichment (новое)

Создание карточек выставок по ссылке организатора с автопарсингом дат, ручное создание с последующей автопроверкой и еженедельный фоновый пересчёт монтажа/демонтажа.

### Что добавлено

- Сервер: REST-обёртка Bitrix (`server/lib/bitrix.ts`) на инбаунд-вебхуке.
- Парсеры: `expocentr.ru`, ITE-сайты (`rosupack.com`, `neftegaz-expo.ru`, `mitt.ru`, `intercharm.ru`), `crocus-expo.ru`, generic.
- Эндпоинты: `POST /api/smart-add`, `POST /api/smart-add/confirm`, `POST /api/manual-add`, `POST /api/recheck/:itemId`, `POST /api/recheck-all`, `GET /api/smart-config`.
- Миграция `migrations/001_add_source_fields.ts` (`npm run migrate`, поддерживает `--dry-run`).
- Cron: `render.yaml` запускает `server/cron/weekly-check.ts` по понедельникам в 06:00 UTC.
- Placement-страницы: `/placement-list`, `/placement-detail`, `/placement-menu`.

### Команды

```sh
npm run migrate                 # добавить UF-поля (нужен BITRIX_WEBHOOK_URL)
npm run migrate -- --dry-run    # вывести план без изменений
npm run bind-placements -- --dry-run        # план placement.bind, без вызовов
npm run bind-placements                     # unbind+bind всех управляемых placement'ов
npm run bind-placements -- --check-fields   # дополнительно проверить наличие UF полей
npm test                        # node:test, парсер expocentr и calculateDates
npm run cron:weekly             # вручную запустить сценарий cron
```

### Поддерживаемые домены

- `expocentr.ru` — confidence 1.0 при наличии всех блоков «Сроки/Даты/Монтаж/Демонтаж».
- `rosupack.com`, `neftegaz-expo.ru`, `mitt.ru`, `intercharm.ru` — JSON-LD `Event` или текстовый блок «Часы работы», confidence 0.7.
- `crocus-expo.ru` — fallback, confidence 0.3–0.5.
- Прочее — generic regex-парсер по словам «проведения», «монтаж», «демонтаж», confidence ≤ 0.3.

### Render cron

`render.yaml` определяет сервис `weekly-check` со schedule `0 6 * * 1`. На Render Dashboard задайте секреты: `BITRIX_WEBHOOK_URL`, опционально `CRON_REPORT_CHAT_ID`. Cron будет запускаться каждый понедельник.

> ⚠️ **Внимание оператору.** Текущий веб-сервис на Render был создан вручную через Dashboard. После мерджа этого PR в репозитории появляется `render.yaml` (Blueprint). Если включить «Sync from Blueprint», Render может попытаться создать **новый** сервис `calendar-interpro-app` рядом со старым (или переписать настройки), что нарушит текущий деплой. Безопасный путь:
> 1. Не подключать репозиторий как Blueprint, пока не сверены имена и переменные окружения существующего сервиса.
> 2. Если хочется использовать Blueprint — сначала переименуйте/удалите старый сервис, либо отредактируйте `name:` в `render.yaml`, чтобы он совпадал с уже существующим.
> 3. Cron-сервис `weekly-check` — новый, и его можно создать вручную через Dashboard (Schedule `0 6 * * 1`, `npm install && npx tsx server/cron/weekly-check.ts`), если Blueprint не используется.

Команды `npm run migrate`, `npm run cron:weekly` и сборка зависят от `tsx`. В этом PR `tsx` перенесён из `devDependencies` в `dependencies`, чтобы Render-cron гарантированно мог запускаться даже если когда-нибудь установка пойдёт с `NODE_ENV=production`.

### Переменные окружения

См. `.env.example`. Главные:

- `BITRIX_WEBHOOK_URL` — обязательна для серверных вызовов и cron.
- `BITRIX_UF_ENTITY_ID` — entityId для userfieldconfig (default `CRM_8`; задокументировано почему именно `CRM_8`, а не `CRM_1050`).
- `OWNER_USER_ID`, `CRON_REPORT_CHANNEL`, `CRON_REPORT_CHAT_ID` — куда слать отчёт после еженедельной сверки.

### Bitrix scopes

Нужны: `crm`, `user`, `im`, `userfieldconfig`, `placement`. Если их нет — обновите scope локального приложения и переустановите.

### Гарантии

- Автообновления **никогда** не перезаписывают непустые поля.
- Каждое изменение пишет timeline-комментарий и строку в `UF_CRM_8_PARSE_LOG` (хранится последние 10).
- `VERIFIED=Y` ставится только при `confidence >= 1.0`.
- `CALCULATED=Y` ставится только если монтаж/демонтаж посчитаны эвристикой.

### Что нужно сделать оператору после деплоя

- Установить `BITRIX_WEBHOOK_URL` на Render и локально.
- Один раз запустить `npm run migrate` (или дать кнопку оператору).
- Переустановить приложение в Bitrix24 (страница `/install`), чтобы привязать новые placement-ы.
- Удостовериться, что вебхук имеет нужные scope.

## Ограничения прототипа

- Точные UF-коды можно зафиксировать только после запуска внутри портала с правами пользователя, имеющего доступ к CRM и смарт-процессу.
- Если в CRM поля названы нестандартно, страница диагностики покажет, какие коды нужно указать/доработать вручную.
- Автоматическое сохранение работает только по полям, которые Bitrix24 отдаёт как доступные и не read-only.
- Серверная OAuth-сессия и хранение токенов не реализованы — серверные эндпоинты требуют `BITRIX_WEBHOOK_URL`. Клиентский путь (BX24 SDK в iframe) не затронут.
- `placement.list` LEFT_MENU поддерживается не на всех редакциях Bitrix24; если placement отсутствует, кнопка из меню не появится — используйте `/calendar` или `/placement-menu` напрямую.
