# Развертывание Bitrix Expo App

Приложение — это статичная React SPA, которая работает полностью в Bitrix24 iframe через `BX24.callMethod()`. Не требует backend-сервера.

## Варианты хостинга

### 1️⃣ GitHub Pages (рекомендуется)

**Преимущества:**
- Бесплатный хостинг
- Автоматическое развертывание при push
- Встроенная поддержка HTTPS
- Просто включить в настройках репо

**Шаги:**

1. **Активировать GitHub Pages в репозитории:**
   - Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main` (или любая другая)
   - Folder: `/ (root)` или `/docs`

2. **Дополнительно:** Если хочешь развертывать из папки `/dist/public`, скопируй содержимое в корень или `/docs`:
   ```bash
   # После npm run build
   cp -r dist/public/* docs/
   git add docs/
   git commit -m "Deploy to GitHub Pages"
   git push
   ```

3. **Получить URL приложения:**
   - Репозиторий `username/bitrix-expo-app` → `https://username.github.io/bitrix-expo-app`
   - Если приватный репо → проверить настройки Pages

### 2️⃣ Netlify

**Преимущества:**
- Простая настройка через UI
- Автоматическое развертывание при push
- Легко переключать между ветками
- Встроенный preview для PR

**Шаги:**

1. Перейти на [netlify.com](https://netlify.com)
2. Нажать "New site from Git"
3. Выбрать GitHub репозиторий
4. Настройки сборки:
   - Build command: `npm run build`
   - Publish directory: `dist/public`
5. Deploy

**URL:** `https://your-site-name.netlify.app`

### 3️⃣ Vercel

Аналогично Netlify, но от создателей Next.js:

1. [vercel.com](https://vercel.com) → Import Project
2. Выбрать репозиторий GitHub
3. Build: `npm run build`
4. Output: `dist/public`
5. Deploy

## Регистрация в Bitrix24

После развертывания нужно зарегистрировать placement-ы в Bitrix24.

### Получить webhook URL

1. **Bitrix24 Admin** → **Настройки приложений** → **Внешние приложения**
2. Нажать на приложение или создать новое
3. Скопировать **Webhook URL** (вида `https://b24-abc123.bitrix24.ru/rest/...`)

### Зарегистрировать placement-ы

Используй `client/src/lib/bitrix.ts` функцию `getManagedPlacements()` для получения списка placement-ов:

```ts
// Placement-ы:
- "CRM_DEAL_DETAIL_TAB"        // Вкладка на карточке сделки
- "CRM_LEAD_DETAIL_TAB"        // Вкладка на карточке лида  
- "CRM_ANALYTICS_MENU"         // Меню Аналитика
- "LEFT_MENU"                  // Левое меню
```

**Регистрация через REST API:**

```bash
curl -X POST https://b24-xxx.bitrix24.ru/rest/app.scope.set \
  -d "scope=placement,placement.bind"

curl -X POST https://b24-xxx.bitrix24.ru/rest/placement.bind \
  -d "PLACEMENT=CRM_ANALYTICS_MENU" \
  -d "HANDLER=https://YOUR_DOMAIN/calendar" \
  -d "TITLE=Календарь выставок"
```

Или вручную через админ-панель Bitrix24.

## Переменные окружения

Приложение не требует переменных окружения для runtime (все API вызовы идут через `BX24.callMethod()`).

**Build-time переменные (опционально):**

```bash
# .env.local или в CI/CD переменные
VITE_BITRIX_PORTAL_URL=https://your-portal.bitrix24.ru
VITE_BUILD_SCHEDULE_STAGE_IDS=8,9,WON
```

## Структура для хостинга

```
dist/public/
├── index.html          # Точка входа SPA
├── favicon.svg         # Иконка
└── assets/
    ├── index-*.css     # Стили (~12 KB gzipped)
    └── index-*.js      # Бандл (~160 KB gzipped)
```

**Требования веб-сервера:**
- Поддержка CORS (для BX24.callMethod)
- SPA fallback: все неизвестные пути должны возвращать `index.html`
- HTTPS обязателен (требование Bitrix24)

### GitHub Pages (автоматическое)
GitHub Pages автоматически настраивает SPA fallback.

### Netlify (автоматическое)
Netlify автоматически обрабатывает SPA маршруты.

### Vercel (автоматическое)
Vercel автоматически обрабатывает SPA маршруты.

### Свой сервер (nginx)

```nginx
location / {
    try_files $uri $uri/ /index.html;
    add_header Access-Control-Allow-Origin "*";
}
```

## Чек-лист перед развертыванием

- [ ] Выполнен `npm run build` без ошибок
- [ ] `dist/public/index.html` содержит React SPA
- [ ] Приложение размещено на HTTPS домене
- [ ] CORS настроен для Bitrix24 портала
- [ ] Placement-ы зарегистрированы в Bitrix24
- [ ] Webhook URL скопирован в настройки приложения
- [ ] Тестирование в Bitrix24: Аналитика → Календарь выставок

## Локальное тестирование

```bash
npm run dev      # Dev server на http://localhost:5173
npm run build    # Собрать для production
npm run preview  # Запустить preview сборки
```

Для полного тестирования нужен доступ к Bitrix24 iframe (открыть через меню Bitrix24).

## Troubleshooting

**❌ "BX24 не определён"**
- Приложение запущено вне Bitrix24 iframe (ожидаемо)
- Откройте из меню Bitrix24: CRM → Аналитика → Календарь выставок

**❌ "CORS error"**
- Убедитесь, что приложение доступно на HTTPS
- Проверьте настройки placement-а в Bitrix24

**❌ "API вызовы падают с таймаутом"**
- Bitrix24 часто медленный при большом объёме данных
- Проверьте лимиты запросов в диагностике Gantt

## Масштабирование

Текущая конфигурация поддерживает:
- 100+ тыс. выставок (pagination по месяцам)
- 1000+ сделок в месяц (бюджет на загрузку ~35 сек)

Если нужны оптимизации:
1. Код-сплиттинг (динамические импорты)
2. Lazy loading компонентов
3. Виртуализация списков (>1000 строк)

## Поддержка

Все API вызовы работают через официальный Bitrix REST API.
Документация: https://dev.1c-bitrix.ru/rest_help/

Приложение совместимо с Bitrix24.

---

**Дата обновления:** 2026-07-15  
**Версия:** Static SPA (Phase 6)
