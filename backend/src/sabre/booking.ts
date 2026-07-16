import { sabrePost } from "./client.js";
import { getOrCreateTrip, getTrip, type TripState } from "../trip/store.js";

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
 * The flight+hotel combination is verified end-to-end against the real cert sandbox
 * (2026-07-16, confirmationId PRPIQL — real DFW→JFK flight + NYC hotel, one order). The car
 * block matches the collection's own example literally but hasn't been included in a
 * successful combined booking yet — worth one more real call before fully trusting it.
 */
export async function confirmBooking(sessionId: string) {
  const trip = getTrip(sessionId);
  if (!trip) throw new Error(`No trip found for session ${sessionId}`);
  const traveler = requireTraveler(trip);

  if (!trip.selectedFlight && !trip.selectedHotel && !trip.selectedCar) {
    throw new Error("Nothing selected yet — select a flight, hotel, or car before confirming.");
  }

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

export async function cancelBooking(confirmationId: string) {
  const result = await sabrePost<any>("/v1/trip/orders/cancelBooking", {
    confirmationId,
    cancelType: "CANCEL_ALL",
  });
  return result;
}

/**
 * `changes` is a passthrough of whatever fields the caller wants modified — ModifyBooking's
 * exact payload varies a lot by what's being changed (contact info, SSRs, travelers, loyalty,
 * FOP — see the collection's ModifyBookingAPI folder for the full menu) and wasn't fully
 * captured here. This wraps the endpoint; construct `changes` per the specific modification.
 */
export async function modifyBooking(confirmationId: string, changes: Record<string, unknown>) {
  return sabrePost<any>("/v1/trip/orders/modifyBooking", { confirmationId, ...changes });
}
