# Nonstop

A voice agent for travel — "The Complete Trip": one continuous voice conversation that plans
and books flights, stays, ground transport, dining, and experiences into a single itinerary,
then manages it (modify/cancel) by voice too.

Built on [Sabre](https://developer.sabre.com) (flights/hotels/cars), [Vocal Bridge](https://vocalbridgeai.com)
(the voice/conversation layer), and [LandingAI ADE](https://docs.landing.ai) (extracting
structured fields from photographed travel documents, e.g. a passport).

## Layout

- `backend/` — Node/TypeScript service. Holds every secret (Sabre token, Vocal Bridge API
  key, LandingAI key), mints Vocal Bridge tokens for the client, and exposes the tool
  endpoints Vocal Bridge's agent calls mid-conversation (`backend/src/tools/router.ts`).
- `app/` — Flutter client (targets iOS/Android). Connects to the Vocal Bridge agent over
  LiveKit, shows a live transcript, and renders the itinerary as it's built. Flutter was
  chosen over native Swift because Vocal Bridge has no official Swift SDK.
- `backend/vb-config/` — `api-tools.json` and `client-actions.json`: paste these into the
  Vocal Bridge dashboard (or `vb config set --api-tools-file` / `--client-actions-file`) to
  wire the agent up to this backend.

## Setup

### 1. Backend

```
cd backend
cp .env.example .env   # fill in SABRE_API_TOKEN, VOCAL_BRIDGE_API_KEY, LANDINGAI_API_KEY
npm install
npm run dev             # listens on :8080
```

Sabre sandbox: PCC `S5OM` (uppercase O), endpoint host `api.cert.platform.sabre.com` — already
defaulted in `.env.example`. The example requests in the Sabre Postman collection send the
Authorization header as a raw token with no "Bearer " prefix, but the collection's declared
auth type is `bearer` — `SABRE_AUTH_HEADER_STYLE` defaults to `bearer`; flip it to `raw` if
you get 401s on the first real call.

Expose the backend publicly (Vocal Bridge's agent and LandingAI both need to reach it):

```
ngrok http 8080
```

Then replace every `REPLACE_WITH_YOUR_PUBLIC_BACKEND_URL` in `backend/vb-config/api-tools.json`
with that URL, and set `PUBLIC_BASE_URL` in `.env` to the same value (so uploaded document
URLs resolve).

### 2. Configure the Vocal Bridge agent

```
pip install vocal-bridge
vb auth login vb_your_api_key_here
vb config set --api-tools-file backend/vb-config/api-tools.json
vb config set --client-actions-file backend/vb-config/client-actions.json
```

The agent's system prompt needs to know the tool contract — at minimum: always pass the
`session_id` it received via the `session_start` client action to every trip tool call, ask
for explicit confirmation before calling `confirm_booking` or `cancel_trip` (these are real
Sabre bookings/cancellations, even in the sandbox), and call `extract_travel_document` after a
`document_uploaded` event instead of asking the traveler to read out passport numbers.

### 3. Flutter app

```
cd app
flutter pub get
flutter run --dart-define=BACKEND_URL=https://your-ngrok-url.ngrok-free.app
```

`BACKEND_URL` defaults to `http://localhost:8080`, which won't resolve from a simulator/device
talking to a laptop — pass the same public URL used above.

## Known gaps / things to verify against real sandbox calls

- **Sabre response shapes are inferred, not verified.** The Postman collection only gave us
  request bodies for FlightShop/FlightCheck/ATPCO CreateBooking/hotel CreateBooking — hotel
  and car price-check bodies, the combined flight+hotel+car CreateBooking shape, and every
  response shape are best-effort guesses (see `TODO`s in `backend/src/sabre/*.ts`). Make one
  real call per flow and tighten the field paths in `summarize*`/`confirmBooking` accordingly.
- **Sabre token refresh** isn't implemented — the provided API token is used as-is. Revisit if
  it turns out to be short-lived.
- **Dining/experiences** are a small hardcoded dataset (`backend/src/tools/curated.ts`) since
  Sabre has no product for either — swap for a real API if this needs to be more than a demo.
- **`cancel_pod_endpoint` / `getbooking_pod_endpoint`** (a separate `lightweight-traveler-api`
  host) exist in the Sabre environment but aren't used anywhere yet — unclear if/when they're
  needed instead of the main REST host.
