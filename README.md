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
- **Combined flight+hotel `CreateBooking` is verified against the real cert sandbox**
  (2026-07-16, `confirmationId: PSCNRD` — real DFW→JFK Delta flight + Hampton Inn NYC, one
  order, then round-tripped through `get_trip`). Getting there required four more fixes beyond
  the individual flight/hotel ones above: `flightDetails.flights[].bookingClass` is mandatory
  and only exists in the *checked* offer's fare breakdown (`items[].fares[].fareComponents[].segmentDetails[]`,
  keyed by flight id) — not on the flight object; `agency.address` and `payment.formsOfPayment[0].cardHolder.address`
  both need a full US address (street/city/state/postal), not just name+country; hotel bookings
  specifically require `cardHolder` on the payment card; and `hotel.paymentPolicy` is an enum
  (`GUARANTEE`/`DEPOSIT`/`LATE`) that has to be mapped from the price-check response's internal
  `Guarantee.GuaranteeType` code (`GUAR`/`DEP`/...) — passing the raw code straight through 400s.
  The test-card `expiryDate` format was also wrong (`MMYY` guessed vs. the real `YYYY-MM`).
- **Full flight+hotel+car `CreateBooking` is verified against the real cert sandbox**
  (2026-07-16, `confirmationId: PSPJQI` — DFW→JFK Delta flight + NYC hotel + Thrifty rental at
  JFK, all three in one order). No new field-shape fixes needed beyond the flight+hotel work
  above — the `car` block's literal-example shape held up as-is.
- **Price-checked offers expire fast — fixed.** The first combined-booking attempt failed with
  `UNABLE_TO_BOOK_HOTEL_EXPIRED_BOOKING_KEY` purely because a handful of ordinary tool calls
  (searching/selecting a car, setting the traveler) happened between selecting the hotel and
  confirming — a real voice conversation is much slower than a test script, so this would
  happen constantly in practice. `confirmBooking` now unconditionally re-runs
  `selectFlight`/`selectHotel`/`selectCar` (re-pricing against Sabre) for whatever's selected,
  immediately before building the `CreateBooking` body — confirmed fixed by reproducing the
  original failure (20s delay + intervening car search/select + set_traveler between hotel
  selection and confirm) and getting a clean booking on the first try (`confirmationId: PVOZXE`).
- **Cancel and modify are verified against the real cert sandbox** (2026-07-16). `CancelBooking`'s
  real field is `cancelAll: true` (plus `retrieveBooking: true` and `errorHandlingPolicy:
  "ALLOW_PARTIAL_CANCEL"`) — the originally-guessed `cancelType: "CANCEL_ALL"` would have been
  silently ignored rather than erroring, since cancelBooking's validation is looser than
  createBooking's, so this could easily have shipped broken without a real test. `ModifyBooking`
  turned out to be a **before/after diff API**, not a partial-update one: it needs the current
  traveler state (`before`), the desired state (`after`), and a `bookingSignature` fetched from
  `GetBooking` immediately beforehand. That's not something a voice agent's LLM could construct
  as a raw JSON blob (the original `modify_trip` tool design, taking an opaque `changes_json`
  string, would never have worked in practice) — replaced with a scoped `modifyContactInfo`
  function/tool (`email`/`phone` params) matching the one flow actually verified. Confirmed both
  by round-tripping through `get_trip`: modify showed the updated email on the traveler, cancel
  removed the flight segment entirely.
- **Infant travelers are supported and verified against the real cert sandbox** (2026-07-17,
  `confirmationId: RMBNUS` — 1 adult + 1 infant, DFW→JFK, booked and confirmed with both
  travelers present in the response). An infant is just a second `travelers[]` entry with
  `passengerCode: "INF"` and its own name/birthDate — Sabre auto-adds the required infant SSR,
  nothing else to construct. `search_flights`/`select_flight`/`set_traveler`/`confirmBooking`
  all thread a shared `{adults, infants}` party mix through so FlightShop and FlightCheck price
  against the same composition. Fixed a related pre-existing bug along the way: `select_flight`
  always sent a single hardcoded ADT to FlightCheck regardless of how many/what type of
  travelers were actually searched. Scope is intentionally narrow — one infant, one adult
  identity captured (multiple distinct adult names, or a non-infant child fare, aren't
  supported; the agent is prompted to say so plainly if either comes up).
- **Sabre token refresh** isn't implemented — the provided API token is used as-is. Revisit if
  it turns out to be short-lived.
- **Dining/experiences** are a small hardcoded dataset (`backend/src/tools/curated.ts`) since
  Sabre has no product for either — swap for a real API if this needs to be more than a demo.
- **`cancel_pod_endpoint` / `getbooking_pod_endpoint`** (a separate `lightweight-traveler-api`
  host) exist in the Sabre environment but aren't used anywhere yet — unclear if/when they're
  needed instead of the main REST host.
