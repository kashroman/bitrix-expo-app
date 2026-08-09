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

## Привязка вкладок Bitrix24

Placement-ы регистрируются только из страницы `/install`, открытой внутри
Bitrix24 администратором. Это необходимо, потому что методы `placement.bind`,
`placement.get` и `placement.unbind` требуют контекст установленного приложения
и scope `placement`; входящий вебхук для этой операции не подходит.

В настройках локального приложения Bitrix24 должны быть включены права:

- CRM (`crm`);
- Встраивание приложений (`placement`);
- Пользователи (минимальный) (`user_basic`) — для отображения фамилий и имён
  ответственных вместо числовых ID.

Страница установки регистрирует:

- вкладку сделки `/deal-tab`;
- вкладку лида `/lead-tab`;
- вкладку выставки `/expo-tab`;
- пункт аналитики CRM `/calendar`.

Отдельный `LEFT_MENU` не регистрируется: у локального приложения уже есть
стандартный пункт в левом меню Bitrix24. При переустановке старый дублирующий
handler `LEFT_MENU` удаляется автоматически.

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
