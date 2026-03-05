# WhatsApp Server

Node.js service using [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) for WhatsApp Web QR login and sending messages. Used by the Laravel app for project-level WhatsApp notifications.

## Setup

```bash
cd services/whatsapp
npm install
```

## Run

```bash
npm start
# or with auto-reload
npm run dev
```

By default the server listens on port 3000. Set `PORT` to change it.

### Run with PM2

From the **project root** (not `services/whatsapp`), use the ecosystem file so PM2 loads env from the root `.env`:

```bash
# Start
pm2 start ecosystem.config.cjs

# View logs
pm2 logs wera-whatsapp

# Status
pm2 status wera-whatsapp

# Restart / stop
pm2 restart wera-whatsapp
pm2 stop wera-whatsapp
```

The app name in PM2 is `wera-whatsapp`. The ecosystem config sets `PORT`, `APP_URL`, and `WHATSAPP_CALLBACK_TOKEN` from the root `.env` (e.g. `WHATSAPP_SERVICE_PORT` or `PORT` for the port).

## Endpoints

- **GET /qr?session_id=project-1** – JSON: `{ qr?: string, connected?: boolean }`. Call this to get the current QR (data URL) or connection status. Use the same `session_id` as in the project’s WhatsApp settings (e.g. `project-1`).
- **GET /qr/page?session_id=project-1** – HTML page that shows the QR and polls until connected. Open in a browser to scan with WhatsApp.
- **GET /status?session_id=project-1** – JSON: `{ connected: boolean }`.
- **POST /send** – Body: `{ "session_id": "project-1", "to": "1234567890", "message": "Hello" }`. `to` is the phone number (digits only).

## Incoming messages (bot commands)

When users send a message to the WhatsApp number linked to a session, Baileys can forward it to Laravel for a reply. Set:

- `APP_URL` – Backend base URL (e.g. `https://your-app.test`)
- Optionally `WHATSAPP_CALLBACK_TOKEN` – same as in Laravel for `X-Callback-Token` on incoming requests

Laravel exposes `POST /api/whatsapp-incoming` (body: `session_id`, `from`, `message`) and returns `{ "reply": "..." }`. Baileys sends that reply back to the user.

**Commands** (user says *wera* for help):

- *wera* / *help* – List commands
- *How many tasks do I have?* / *my tasks* – Task count in this project (phone must be in profile)
- *How many overdue?* / *overdue* – Overdue task count
- *How is project X going?* / *project status* – Project summary (tasks, overdue)

## Callback (optional, for real-time QR in Filament)

When Laravel broadcasts (e.g. Reverb/Pusher) are configured, set in the Baileys service `.env`:

- `LARAVEL_WHATSAPP_CALLBACK_URL` – full URL to Laravel callback (e.g. `https://your-app.test/api/whatsapp-callback`)
- `WHATSAPP_CALLBACK_TOKEN` – same as `WHATSAPP_CALLBACK_TOKEN` in Laravel `.env` (optional, for auth)

Baileys will POST QR and connection status to Laravel, which broadcasts to the Filament UI so the QR updates without polling.

## Laravel config

Set `WHATSAPP_BAILEYS_URL` in Laravel `.env` (e.g. `http://localhost:3000`) so the app can call this service. In Filament, open a project → Edit → "Connect WhatsApp" to show the QR in a modal; session is `project-{id}`.
is service. In Filament, open a project → Edit → "Connect WhatsApp" to show the QR in a modal; session is `project-{id}`.
