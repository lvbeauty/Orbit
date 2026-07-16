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

- **Flight search/select are verified against the real cert sandbox** (2026-07-16) —
  `search_flights`/`select_flight` now match Sabre's actual response shape: `FlightShop` and
  `FlightCheck` both return a flat `{ offers, journeys, flights }` structure linked by id refs,
  not the nested shape the request bodies implied. Also found and fixed: `FlightCheck` can
  return several re-priced offers for one itinerary (different fare buckets) — picking
  `offers[0]` blindly grabbed a $462 fare instead of the $144 fare that was actually shopped.
  Auth needed `SABRE_AUTH_HEADER_STYLE=bearer` (not `raw`) despite the token's raw-security-token
  look — see `.env.example`.
- **Hotel search/select are verified against the real cert sandbox** (2026-07-16) — `GetHotelAvail`'s
  city lives under `HotelInfo.LocationInfo.Address.CityName.value` (not `HotelInfo.Address`), and
  pricing is a sibling `HotelRateInfo.RateInfos.ConvertedRateInfo[]` block, each with a `RateKey`.
  `HotelPriceCheckRQ` needs `{ RateInfoRef: { RateKey } }` — confirmed via Sabre's own validation
  error (`missing required properties ["RateInfoRef"]`) — and its response returns a *different*
  key, `PriceCheckInfo.BookingKey`, which is what `CreateBooking`'s `hotel.bookingKey` actually
  needs (not the RateKey).
- **Car search/select are verified against the real cert sandbox** (2026-07-16) — `GetVehAvail`
  required two properties (`RatePrefs`, `LocPolicyRef`) that had been trimmed out of the Postman
  example by mistake; results live at `GetVehAvailRS.VehAvailInfos.VehAvailInfo[]` (not
  `VehAvails.VehAvail`), with per-vehicle pricing inside `VehRentalRate[0].VehicleCharges.VehicleCharge[]`
  keyed by `ChargeType` (`BaseRateTotal`, `ApproximateTotalPrice`, etc.). `VehPriceCheckRQ` needs
  `{ VehRateInfoRef: { RateKey } }` — note the *different* key name from hotel's `RateInfoRef` —
  found in the Postman collection's own `VehPriceCheck` example after a hotel-shaped guess was
  rejected by Sabre's schema validation. Response shape mirrors `HotelPriceCheck` exactly
  (`PriceCheckInfo.BookingKey`/`PriceChange`/`PriceDifference`). The `CreateBooking` `car` block
  is simpler than hotel's — just `{ bookingKey }`, no `rooms`/`formOfPayment` — per the
  collection's `[CB] Car with FOP - simple` example.
- **The combined flight+hotel+car `CreateBooking` body is still unverified** — flight, hotel,
  and car have each been separately confirmed to build correctly, but no real call has bundled
  more than one item type into a single order yet (see remaining `TODO` in
  `backend/src/sabre/booking.ts`).
- **Sabre token refresh** isn't implemented — the provided API token is used as-is. Revisit if
  it turns out to be short-lived.
- **Dining/experiences** are a small hardcoded dataset (`backend/src/tools/curated.ts`) since
  Sabre has no product for either — swap for a real API if this needs to be more than a demo.
- **`cancel_pod_endpoint` / `getbooking_pod_endpoint`** (a separate `lightweight-traveler-api`
  host) exist in the Sabre environment but aren't used anywhere yet — unclear if/when they're
  needed instead of the main REST host.
