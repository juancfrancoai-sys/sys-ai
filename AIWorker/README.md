# AIWorker — WhatsApp AI Agent

Worker de WhatsApp con IA (Groq + Gemini) que responde mensajes automáticamente.

## Stack
- **WhatsApp**: Baileys (sin costo)
- **IA texto**: Groq / Llama 3.1 70B (gratis)
- **IA imágenes**: Google Gemini Flash (gratis)
- **Base de datos**: Neon Postgres (gratis)
- **Deploy**: Render free tier

## Setup

### 1. Variables de entorno
Copiá `.env.example` a `.env` y completá:
```
DATABASE_URL=     # tu string de Neon
GROQ_API_KEY=     # console.groq.com
GEMINI_API_KEY=   # aistudio.google.com
ADMIN_PHONE=      # tu número sin + (ej: 5491112345678)
PORT=3000
```

### 2. Base de datos
Ejecutá `schema.sql` en el SQL Editor de Neon.

### 3. Instalar y correr
```bash
npm install
npm start
```

Escaneá el QR que aparece en la consola con WhatsApp.

### 4. Deploy en Render
- Build command: `npm install`
- Start command: `node src/index.js`
- Health check: `/health`

### 5. UptimeRobot
Configurá un monitor HTTP a `https://tu-app.onrender.com/health` cada 5 minutos.

## Endpoints
- `GET /health` — estado del sistema (uptime, mensajes, reinicios)
