# Деплой в Yandex Cloud

Проект использует единственный production-контур: **Yandex Cloud Serverless Containers**.

## Что происходит после коммита в `master`

Workflow `.github/workflows/deploy-yandex.yml`:

1. устанавливает зависимости;
2. запускает TypeScript-проверку и тесты;
3. собирает Docker-образ;
4. отправляет образ в Yandex Container Registry;
5. создаёт новую ревизию Serverless Container;
6. проверяет endpoint `/health`.

Автодеплой выполняется только когда GitHub Variable `YC_DEPLOY_ENABLED` равна
`true`. Тот же workflow можно запустить вручную в GitHub Actions.

## Настройки GitHub

Secret:

- `YC_SA_JSON_CREDENTIALS` — JSON-ключ сервисного аккаунта Yandex Cloud.

Variables:

- `YC_DEPLOY_ENABLED=true`;
- `YC_FOLDER_ID` — каталог Yandex Cloud;
- `YC_REGISTRY_ID` — Container Registry;
- `YC_CONTAINER_NAME` — имя Serverless Container;
- `YC_SA_ID` — сервисный аккаунт контейнера;
- `BITRIX_PORTAL_URL` — URL портала, например `https://example.bitrix24.ru`;
- `COMPANY_NAME` — подпись компании, обычно `interpro.pro`;
- `APP_BASE_URL` — публичный URL контейнера; используется workflow привязки placement-ов.

## Привязка вкладок Bitrix24

Workflow `.github/workflows/rebind-placements.yml` регистрирует обработчики:

- вкладка сделки `/deal-tab`;
- вкладка лида `/lead-tab`;
- вкладка выставки `/expo-tab`;
- пункт аналитики и левое меню `/calendar`.

Для него нужен Secret `BITRIX_WEBHOOK_URL`. Сначала запускайте режим `dry-run`,
проверяйте план в логе и только затем — `apply`. Поле `stale_base_url` оставляйте
пустым, если старый адрес удалять не требуется.

При `rebind` также удаляются принадлежавшие приложению отменённые обработчики
`/placement-detail`, `/placement-list` и `/placement-menu`, в том числе на
текущем Yandex-адресе.

## Локальная проверка

```bash
npm ci
npm run check
npm test
npm run build
docker build -t bitrix-expo-app:local .
```

Проверка работающего контейнера:

```bash
curl -fsS https://bba8ln220jfloq5251dv.containers.yandexcloud.net/health
```

Ожидаемый ответ: `{"ok":true,"app":"bitrix-expo-app"}`.
