# 🚀 Деплой TeachOrTell на Google Cloud Run

Этот гайд позволяет развернуть backend (FastAPI) автоматически и удобно, с поддержкой переменных окружения, Google Secret Manager, HTTPS и масштабирования.

---

## 1. Требования
- Аккаунт Google Cloud Platform
- Установленный Google Cloud SDK (https://cloud.google.com/sdk/docs/install)
- Python 3.11 локально для сборки образа и тестирования
______

## 2. Подготовка Dockerfile и .dockerignore
Файлы уже созданы:
- `Tell/backend/Dockerfile`
- `Tell/backend/.dockerignore`

## 3. Изменения main.py
Программно уже поддерживается `PORT` через env.

---

## 4. Настроить Google Cloud

### Войти и выбрать проект
```bash
gcloud init
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### Включить необходимые сервисы
```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable storage-api.googleapis.com
gcloud services enable secretmanager.googleapis.com  # Для хранения секретов
```

### ⚠️ Настроить IAM-права для Cloud Build (ОБЯЗАТЕЛЬНО!)

Если вы получили ошибку `PERMISSION_DENIED` при деплое, это означает, что сервисный аккаунт Cloud Build не имеет необходимых прав. Выполните:

```bash
# Получить номер проекта
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")

# Сервисный аккаунт Cloud Build
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# Дать права сервисному аккаунту Cloud Build:
# 1. Права на запись в Cloud Storage (для временных файлов сборки)
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/storage.admin"

# 2. Права на развертывание в Cloud Run
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/run.admin"

# 3. Права на создание сервисных аккаунтов (если нужно)
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/iam.serviceAccountUser"
```

**Альтернатива:** Если вы не можете изменить IAM-права (например, из-за ограничений организации), попросите администратора проекта дать эти права сервисному аккаунту Cloud Build.

---
## 5. Развернуть приложение на Cloud Run
Перейдите в папку backend:

```bash
cd web_teach_and_tell/Tell/backend

gcloud run deploy teach-tell-backend \
  --source . \
  --platform managed \
  --region europe-west4 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID \
  --memory 1Gi \
  --cpu 1 \
  --timeout 900 \
  --max-instances 10
```
**Пояснения:**
- `YOUR_PROJECT_ID` — ваш проект GCP.
- После развертывания вы получите URL (например, https://teach-tell-backend-xxxxx.run.app)
---

## 6. Настроить Secret Manager для секретов

**⚠️ Важно:** При создании секретов используйте безопасный способ, чтобы ключи не попали в историю команд.

```bash
# Способ 1: Через pipe (рекомендуется, более безопасно)
echo -n "ваш-groq-api-key" | gcloud secrets create groq-api-key --data-file=-
echo -n "название_вашего_bucket" | gcloud secrets create gcs-bucket-name --data-file=-

# Способ 2: Из файла (самый безопасный для чувствительных данных)
echo -n "ваш-groq-api-key" > /tmp/groq-key.txt
gcloud secrets create groq-api-key --data-file=/tmp/groq-key.txt
rm /tmp/groq-key.txt  # Удалить файл после использования

# Дать сервис-аккаунту Cloud Run доступ к секретам
# Вариант 1: До деплоя (использовать compute service account по умолчанию)
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding groq-api-key \
  --member="serviceAccount:$COMPUTE_SA" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding gcs-bucket-name \
  --member="serviceAccount:$COMPUTE_SA" \
  --role="roles/secretmanager.secretAccessor"

# Вариант 2: После деплоя (если назначен другой сервисный аккаунт)
# export SA_EMAIL=$(gcloud run services describe teach-tell-backend --region=europe-west4 --format 'value(spec.template.spec.serviceAccount)')
# if [ ! -z "$SA_EMAIL" ]; then
#   gcloud secrets add-iam-policy-binding groq-api-key \
#     --member="serviceAccount:$SA_EMAIL" \
#     --role="roles/secretmanager.secretAccessor"
#   gcloud secrets add-iam-policy-binding gcs-bucket-name \
#     --member="serviceAccount:$SA_EMAIL" \
#     --role="roles/secretmanager.secretAccessor"
# fi
```

---

## 7. Деплой фронтенда (опционально)
Рекомендую статический хостинг через [Firebase Hosting](https://firebase.google.com/docs/hosting) или Cloud Storage:

### Вариант A: Firebase Hosting (рекомендуется)

**Шаг 1: Установить Firebase CLI**

Выберите один из способов:

**Способ 1: Через npm (нужен Node.js)**
```bash
# Установить Node.js и npm (если еще не установлены)
brew install node

# Установить Firebase CLI
npm install -g firebase-tools
```

**Способ 2: Standalone installer (без npm)**
```bash
# Скачать и установить standalone binary
curl -sL https://firebase.tools | bash
```

**Шаг 2: Деплой**
```bash
cd ../../Tell/frontend  # Перейти в директорию фронтенда

firebase login

# ⚠️ ВАЖНО: Если проект не связан с Firebase:
# 1. Откройте https://console.firebase.google.com/
# 2. Нажмите "Add project" или "Add Firebase to Google Cloud Platform project"
# 3. Выберите ваш проект "academic-torch-476710-u0"
# 4. Подождите завершения настройки

firebase init hosting
# При инициализации:
# - Выбрать "Use an existing project" (НЕ "Add Firebase to an existing Google Cloud Platform project")
# - Выбрать ваш проект из списка
# - Указать "." как public directory (текущая директория, так как только index.html)
# - Настроить single-page app: Yes
# - Не перезаписывать index.html: No

# Обновить API_URL в index.html на URL вашего Cloud Run backend
# Затем деплой:
firebase deploy --only hosting
```

### Вариант B: Cloud Storage (РЕКОМЕНДУЕТСЯ - проще и не требует Firebase)

Если не хотите устанавливать npm/Firebase, можно использовать gsutil (уже установлен):

```bash
# 1. Создать bucket для фронтенда (выберите уникальное имя)
FRONTEND_BUCKET="chicago-formula-frontend-$(date +%s)"  # Или любое уникальное имя
gsutil mb -p $(gcloud config get-value project) -l europe-west4 gs://$FRONTEND_BUCKET

# 2. Настроить bucket как веб-сайт
gsutil web set -m index.html -e index.html gs://$FRONTEND_BUCKET

# 3. Сделать bucket публично доступным для чтения
gsutil iam ch allUsers:objectViewer gs://$FRONTEND_BUCKET

# 4. Обновить API_URL в index.html на URL вашего Cloud Run backend
# (сделаем это в следующем шаге)

# 5. Загрузить файлы фронтенда
cd ../frontend
gsutil -m rsync -r . gs://$FRONTEND_BUCKET

# 6. Получить публичный URL
echo "Ваш фронтенд доступен по адресу:"
echo "http://storage.googleapis.com/$FRONTEND_BUCKET/index.html"
```

**Важно:** 
- Cloud Storage bucket будет доступен по HTTP (не HTTPS)
- Для HTTPS потребуется настроить Cloud Load Balancer (сложнее)
- URL будет выглядеть как `http://storage.googleapis.com/bucket-name/index.html`
- Для production лучше использовать Firebase Hosting (автоматический HTTPS) или настроить Load Balancer

### Вариант C: Создать новый Firebase проект

Если не можете связать существующий GCP проект с Firebase:

1. Создайте новый проект в Firebase Console (https://console.firebase.google.com/)
2. Выберите "Create a new project"
3. Firebase автоматически создаст связанный GCP проект
4. Используйте этот новый проект для Firebase Hosting
5. Backend может оставаться в старом проекте `academic-torch-476710-u0`

**Минус:** Два разных проекта (один для backend, другой для frontend), но это не критично.

___

## 8. Настроить кастомный домен (опционально)

Если вы хотите использовать свой домен (например, `teach-and-tell.com` вместо `academic-torch-476710-u0.web.app`):

### Способ 1: Через Firebase Console (рекомендуется)

1. Откройте [Firebase Console](https://console.firebase.google.com/)
2. Выберите ваш проект `academic-torch-476710-u0`
3. Перейдите в **Hosting** (в левом меню)
4. Нажмите **"Add custom domain"**
5. Введите ваш домен (например, `teach-and-tell.com` или `www.teach-and-tell.com`)
6. Firebase предложит два варианта:
   - **A record** (для домена без www)
   - **CNAME record** (для поддомена www)

### Шаг 2: Настроить DNS записи

Вам нужно добавить DNS записи у вашего регистратора домена:

**Для домена без www (teach-and-tell.com):**
```
Тип: A
Имя: @ (или оставить пустым)
Значение: [IP адрес, который даст Firebase]
```

**Для поддомена www (www.teach-and-tell.com):**
```
Тип: CNAME
Имя: www
Значение: [CNAME значение, которое даст Firebase]
```

Firebase покажет точные значения, которые нужно ввести.

### Шаг 3: Подождать активации

После добавления DNS записей:
- Firebase автоматически проверит их (может занять от нескольких минут до 24 часов)
- SSL сертификат будет автоматически создан и настроен
- Вы получите уведомление, когда домен будет готов

### Шаг 3: Обновить CORS в backend

После подключения кастомного домена нужно добавить его в список разрешенных origins в `Tell/backend/main.py`:

```python
allow_origins=[
    "https://academic-torch-476710-u0.web.app",
    "https://academic-torch-476710-u0.firebaseapp.com",
    "https://teach-and-tell.com",  # ← Добавить ваш кастомный домен
    "https://www.teach-and-tell.com",  # ← Если используете www
    "http://localhost:8001",
    # ...
],
```

Затем перезадеплоить backend:
```bash
cd web_teach_and_tell/Tell/backend
gcloud run deploy teach-tell-backend --source . --platform managed --region europe-west4
```

### Способ 2: Через Firebase CLI

```bash
cd web_teach_and_tell/Tell/frontend
firebase hosting:sites:create [имя-сайта]
firebase target:apply hosting production [имя-сайта]
firebase deploy --only hosting:production
```

---

## 9. Обновить URL API во frontend
В index.html или env надо прописать новый URL backend (Cloud Run URL).

---

## 9. Готово ✔

- Backend всегда онлайн и автоматически масштабируется.
- HTTPS и Google security & logs by default.
- Можно использовать Google Secret Manager для хранения API ключей и т.д.

---
Если возникнут вопросы — пишите здесь! 🎉
