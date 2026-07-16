import { sabrePost } from "./client.js";
import { getOrCreateTrip, getTrip, type TripState } from "../trip/store.js";
import { selectFlight } from "./flights.js";
import { selectHotel } from "./hotels.js";
import { selectCar } from "./cars.js";

export interface SetTravelerParams {
  sessionId: string;
  givenName: string;
  surname: string;
  birthDate?: string; // YYYY-MM-DD
  email?: string;
  phone?: string;
}

export function setTraveler(params: SetTravelerParams) {
  const trip = getOrCreateTrip(params.sessionId);
  trip.traveler = {
    givenName: params.givenName,
    surname: params.surname,
    birthDate: params.birthDate,
    email: params.email,
    phone: params.phone,
  };
  return { ok: true };
}

/**
 * Sabre cert VISA test card, fine for the sandbox/demo, must NOT be reused anywhere real.
 * Number/security code from the collection's example CreateBooking requests; expiryDate
 * format (YYYY-MM, not MMYY as originally guessed) confirmed against the collection's actual
 * environment values on 2026-07-16.
 */
const TEST_CARD_NUMBER = "4487971000000006";
const TEST_CARD_EXPIRY = "2036-07";

/**
 * Sandbox agency/billing address — verified 2026-07-16 that CreateBooking's agency.address
 * and payment.cardHolder.address both require a full US address (street/city/state/postal),
 * not just name+country as originally guessed. We don't collect a real address from the
 * traveler over voice, so this is a fixed placeholder (Sabre's own example agency address),
 * fine for a cert-sandbox demo.
 */
const SANDBOX_ADDRESS = {
  street: "1230 Ellen Ave, apt 10",
  city: "Dallas",
  stateProvince: "TX",
  postalCode: "75063",
  countryCode: "US",
};

function requireTraveler(trip: TripState) {
  if (!trip.traveler?.givenName || !trip.traveler?.surname) {
    throw new Error("No traveler on file for this session — call set_traveler before confirm_booking.");
  }
  return trip.traveler;
}

/**
 * Bundles whatever's currently selected (flight / hotel / car) into a single Sabre order.
 * Full flight+hotel+car is verified end-to-end against the real cert sandbox (2026-07-16,
 * confirmationId PSPJQI — DFW→JFK flight + NYC hotel + JFK rental car, one order).
 */
export async function confirmBooking(sessionId: string) {
  const trip = getTrip(sessionId);
  if (!trip) throw new Error(`No trip found for session ${sessionId}`);
  const traveler = requireTraveler(trip);

  if (!trip.selectedFlight && !trip.selectedHotel && !trip.selectedCar) {
    throw new Error("Nothing selected yet — select a flight, hotel, or car before confirming.");
  }

  // Price-checked offers/booking keys expire fast — verified 2026-07-16 that a hotel booking
  // key can go stale after just a handful of intervening tool calls, and a real voice
  // conversation is far slower than that. Re-run price-check right before booking so every
  // key is fresh regardless of how long the user took to get here. These functions are
  // idempotent (they re-derive from data already cached on the offer), so calling them again
  // is safe even if the offer was just selected a moment ago.
  if (trip.selectedFlight) await selectFlight({ sessionId, offerId: trip.selectedFlight.id });
  if (trip.selectedHotel) await selectHotel({ sessionId, hotelOfferId: trip.selectedHotel.id });
  if (trip.selectedCar) await selectCar({ sessionId, carOfferId: trip.selectedCar.id });

  const body: Record<string, unknown> = {
    agency: {
      address: { name: `${traveler.givenName} ${traveler.surname}`, ...SANDBOX_ADDRESS },
      ticketingPolicy: "TODAY",
    },
    travelers: [
      {
        givenName: traveler.givenName,
        surname: traveler.surname,
        birthDate: traveler.birthDate,
        passengerCode: "ADT",
      },
    ],
    contactInfo: {
      emails: traveler.email ? [traveler.email] : [],
      phones: traveler.phone ? [traveler.phone] : [],
    },
    payment: {
      formsOfPayment: [
        {
          type: "PAYMENTCARD",
          cardTypeCode: "VI",
          cardNumber: TEST_CARD_NUMBER,
          cardSecurityCode: "123",
          expiryDate: TEST_CARD_EXPIRY,
          // Required specifically for hotel bookings (verified 2026-07-16: "Hotel booking
          // with PAYMENTCARD requires: cardHolder") — harmless to always include.
          cardHolder: {
            givenName: traveler.givenName,
            surname: traveler.surname,
            email: traveler.email,
            phone: traveler.phone,
            address: SANDBOX_ADDRESS,
          },
        },
      ],
    },
  };

  if (trip.selectedFlight) {
    // resolvedJourneys carries every leg (all journeys, all connections) — verified against a
    // real /v1/offers/flightShop response on 2026-07-16, see sabre/flights.ts.
    const resolvedJourneys = trip.selectedFlight.raw?.resolvedJourneys ?? [];
    const allFlights = resolvedJourneys.flatMap((j: { flights: any[] }) => j.flights);
    const bookingClassByFlightId: Map<string, string> = trip.selectedFlight.raw?.bookingClassByFlightId ?? new Map();
    body.flightDetails = {
      flights: allFlights.map((f: any) => ({
        flightNumber: f.marketingFlightNumber,
        airlineCode: f.marketingAirlineCode,
        fromAirportCode: f.departureAirportCode,
        toAirportCode: f.arrivalAirportCode,
        departureDate: f.departureDate,
        departureTime: f.departureTime,
        // Mandatory field found via Sabre's "must not be null" error on 2026-07-16 — comes
        // from the checked offer's fare breakdown, not the flight object itself.
        bookingClass: bookingClassByFlightId.get(f.id) ?? "Y",
        flightStatusCode: "NN",
      })),
      flightPricing: [{}],
    };
  }

  if (trip.selectedHotel) {
    const hotelRaw = trip.selectedHotel.raw;
    // bookingKey and paymentPolicy both come from HotelPriceCheckRS.PriceCheckInfo (cached by
    // selectHotel) — verified against a real sandbox call on 2026-07-16, see sabre/hotels.ts.
    body.hotel = {
      bookingKey: hotelRaw?.bookingKey ?? null,
      rooms: [{ travelerIndices: [1] }],
      paymentPolicy: hotelRaw?.paymentPolicy ?? "GUARANTEE",
      formOfPayment: 1,
    };
  }

  if (trip.selectedCar) {
    const carRaw = trip.selectedCar.raw;
    // Matches the Postman collection's "[CB] Car with FOP - simple" example exactly:
    // just { bookingKey } — no rooms/formOfPayment like the hotel block needs. bookingKey
    // comes from VehPriceCheckRS.PriceCheckInfo.BookingKey (cached by selectCar), verified
    // against a real sandbox call on 2026-07-16 — see sabre/cars.ts.
    body.car = { bookingKey: carRaw?.bookingKey ?? null };
  }

  const result = await sabrePost<any>("/v1/trip/orders/createBooking", body);
  trip.confirmationId = result?.confirmationId ?? result?.pnr ?? undefined;
  trip.bookingStatus = "confirmed";

  return { confirmation_id: trip.confirmationId, status: trip.bookingStatus, raw: result };
}

export async function getBooking(confirmationId: string) {
  return sabrePost<any>("/v1/trip/orders/getBooking", { confirmationId });
}

/**
 * Verified against a real sandbox call on 2026-07-16 — the field is `cancelAll`, not the
 * originally-guessed `cancelType: "CANCEL_ALL"` (which Sabre would have silently ignored
 * rather than erroring on, since cancelBooking's body validation is looser than createBooking's).
 * Confirmed the cancellation actually took by re-fetching the booking afterward and seeing the
 * flight segment gone.
 */
export async function cancelBooking(confirmationId: string) {
  return sabrePost<any>("/v1/trip/orders/cancelBooking", {
    confirmationId,
    retrieveBooking: true,
    cancelAll: true,
    errorHandlingPolicy: "ALLOW_PARTIAL_CANCEL",
  });
}

/**
 * ModifyBooking is a before/after diff API, not a partial-update one — it needs the current
 * traveler state (`before`) plus the desired state (`after`), and a `bookingSignature` fetched
 * from GetBooking immediately beforehand. This isn't something a voice agent's LLM could
 * reliably construct itself even if we exposed it as a raw passthrough tool, which is what the
 * original (unverified) design assumed — scoped to the one concrete flow actually verified
 * against the sandbox (2026-07-16): updating the primary traveler's contact info.
 */
export async function modifyContactInfo(confirmationId: string, updates: { email?: string; phone?: string }) {
  const current = await getBooking(confirmationId);
  const bookingSignature = current?.bookingSignature;
  const traveler = current?.travelers?.[0];
  if (!bookingSignature || !traveler) {
    throw new Error(`Could not load booking ${confirmationId} to modify — no bookingSignature/traveler found.`);
  }

  const travelerIdentity = {
    givenName: traveler.givenName,
    surname: traveler.surname,
    passengerCode: traveler.passengerCode,
  };

  const body = {
    bookingSignature,
    confirmationId,
    before: {
      travelers: [{ ...travelerIdentity, ...(traveler.emails ? { emails: traveler.emails } : {}), ...(traveler.phones ? { phones: traveler.phones } : {}) }],
    },
    after: {
      travelers: [
        {
          ...travelerIdentity,
          emails: updates.email ? [updates.email] : traveler.emails,
          phones: updates.phone ? [{ number: updates.phone }] : traveler.phones,
        },
      ],
    },
    retrieveBooking: true,
  };

  return sabrePost<any>("/v1/trip/orders/modifyBooking", body);
}
