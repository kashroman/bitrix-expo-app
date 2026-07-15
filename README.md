# Bitrix Expo Analytics — Static SPA

**Календарь выставок** — аналитическое приложение для Bitrix24, работающее как статичная React SPA в iframe.

![Version](https://img.shields.io/badge/version-2.0.0--static-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Build](https://img.shields.io/badge/build-vite-green)

## ✨ Возможности

- 📊 **Gantt календарь** — визуализация выставок по месяцам с фазами монтажа/проведения/демонтажа
- 📈 **График застройки** — сделки в smart-process с цветными полосками по стадиям (8/9/WON)
- 🎯 **Фильтры** — по стадиям сделок и менеджерам с сохранением в URL
- 🔗 **Модальное открытие** — клик на сделку открывает карточку в Bitrix24 (BX24.openSlider)
- ✏️ **Inline-edit** — компоненты для редактирования дат и полей (готовы к интеграции)
- 📱 **Полностью клиентская** — работает через `BX24.callMethod()`, не требует backend

## 🚀 Быстрый старт

### Локальная разработка

```bash
npm install
npm run dev       # Vite dev server на http://localhost:5173
npm run check     # TypeScript проверка
npm run build     # Собрать production (dist/public/)
npm run preview   # Preview production build
```

### Развертывание

1. **GitHub Pages** (бесплатно, рекомендуется):
   ```bash
   npm run build
   # GitHub Actions автоматически развернёт на https://username.github.io/bitrix-expo-app
   ```

2. **Netlify / Vercel**:
   - Подключить репозиторий
   - Build: `npm run build`
   - Publish: `dist/public`

📖 **Подробный гайд:** [DEPLOYMENT.md](./DEPLOYMENT.md)

## 📋 Регистрация в Bitrix24

После развертывания на HTTPS:

1. Откройте **Администратор** → **Настройки приложений**
2. Установите приложение и зарегистрируйте placement-ы:
   - `CRM_ANALYTICS_MENU` → `/calendar` (главное меню Аналитика)
   - `CRM_DEAL_DETAIL_TAB` → `/deal-tab` (вкладка на сделке)
   - `CRM_LEAD_DETAIL_TAB` → `/lead-tab` (вкладка на лиде)

📖 **Пошаговое руководство:** [BITRIX_SETUP.md](./BITRIX_SETUP.md)

## 🏗️ Архитектура

```
client/src/
├── pages/
│   ├── calendar.tsx         # Gantt с фильтрами по стадиям/менеджерам
│   ├── event-detail.tsx     # Карточка выставки
│   └── crm-tab.tsx          # Вкладки на сделках/лидах
├── components/
│   ├── gantt.tsx            # Gantt timeline визуализация
│   ├── inline-edit.tsx      # Редакторы дат и текста
│   └── ui/                  # Radix UI компоненты
├── lib/
│   ├── bitrix.ts            # BX24 обёртка (callBx, openDealCard)
│   ├── expo-data.ts         # Data fetching + filtering
│   ├── expo-fields.ts       # Auto-discovery UF field codes
│   ├── expo-link.ts         # Deal/Lead link field detection
│   └── config.ts            # Static configuration (stage IDs, field codes)
└── hooks/
    └── use-bulk-counts.ts   # React Query helper for bulk fetches
```

**Стек:**
- **React 18** + TypeScript
- **Vite** (сборка)
- **React Query** (кэширование данных)
- **Wouter** (маршрутизация)
- **Radix UI** + Tailwind CSS (компоненты и стили)
- **Zod** (валидация)

## 🔧 Фазы реализации

| Фаза | Статус | Описание |
|------|--------|---------|
| **1** | ✅ | Удален backend (Express, парсеры, миграции) |
| **2** | ✅ | Добавлены фильтры (по стадиям и менеджерам) |
| **3** | ✅ | Создана система inline-edit компонентов |
| **4** | ✅ | Реализовано открытие сделок в модали (BX24.openSlider) |
| **5** | ⏭️ | Опционально: inline-edit в строках Gantt |
| **6** | ✅ | Подготовка к развертыванию (GitHub Pages, Netlify) |

## 📐 Конфигурация

### Smart-process и поля (автоматически определяются)

```typescript
// client/src/lib/config.ts
export const EXPO_ENTITY_TYPE_ID = 1050;        // Smart-process "Выставки"
export const EXPO_LINK_FIELD = "PARENT_ID_1050"; // Link to exhibitions

// Exact UF codes (verified on 2026-05-06):
export const EXPO_DATE_FIELDS = {
  eventStart: "ufCrm8_1766066484758",
  eventEnd: "ufCrm8_1766066501630",
  mountStart: "ufCrm8_1778070067219",
  mountEnd: "ufCrm8_1778070672",
  dismantleStart: "ufCrm8_1778070708",
  dismantleEnd: "ufCrm8_1778070734",
};
```

### Stage IDs для "График застройки"

Заказываемые сделки на стадиях: **8** (Подписываем договор), **9** (Строим), **WON** (Проект завершён)

Переопределить через env:
```bash
VITE_BUILD_SCHEDULE_STAGE_IDS=8,9,WON npm run build
```

## 🧪 Тестирование

```bash
npm run test      # node:test (парсеры, утилиты)
npm run check     # TypeScript type checking
npm run build     # Production build (проверяет также на ошибки)
```

**Локальное тестирование в Bitrix24:**
1. Запустите `npm run dev`
2. В Bitrix24 откройте меню → выберите приложение
3. Приложение откроется с dev сервера (http://localhost:5173)

## 📊 Производительность

**Размер бандла:**
- `index.js`: 541 KB (160 KB gzipped)
- `index.css`: 76 KB (12.6 KB gzipped)
- **Итого:** ~13 KB gzipped (основная нагрузка на JS)

**Оптимизации:**
- Lazy loading компонентов (`React.lazy`)
- React Query кэширование с стейл-тайм 60 сек
- Месячная фильтрация выставок (не загружаются все сразу)
- Динамическая пагинация для больших наборов

## 🐛 Troubleshooting

### "BX24 не определён"
→ Это демо-режим вне Bitrix24. Откройте приложение из меню Bitrix24.

### "CORS error" при открытии модали
→ Убедитесь, что приложение на HTTPS и правильно зарегистрировано в Bitrix24.

### Таймауты API
→ Откройте диагностику Gantt (внизу страницы) и посмотрите, какой запрос падает. Может быть слишком много выставок.

## 📚 Документация

- [DEPLOYMENT.md](./DEPLOYMENT.md) — развертывание на GitHub Pages, Netlify, Vercel
- [BITRIX_SETUP.md](./BITRIX_SETUP.md) — регистрация приложения в Bitrix24
- [CLAUDE.md](./CLAUDE.md) — архитектура и разработка (для Claude Code)

## 🔐 Безопасность

- Нет хранения credentials (всё через iframe + BX24.callMethod)
- Нет запросов к third-party API (кроме Bitrix24)
- CORS настроены только для Bitrix24 портала
- Все редактирования выполняются с правами текущего пользователя

## 📄 Лицензия

MIT — свободно используйте в своих проектах.

## 🤝 Поддержка

- 🐛 GitHub Issues: [создать issue](https://github.com/kashroman/bitrix-expo-app/issues)
- 📖 Bitrix24 API: https://dev.1c-bitrix.ru/rest_help/
- 💬 Bitrix24 Community: https://community.bitrix24.ru/

---

**Версия:** 2.0.0 (Static SPA)  
**Обновлено:** 2026-07-15  
**Автор:** [kashroman](https://github.com/kashroman)
