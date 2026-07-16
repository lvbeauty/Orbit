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
 * Sabre cert VISA test card (from the collection's example CreateBooking requests) — fine
 * for the sandbox/demo, must NOT be reused anywhere real.
 */
const TEST_CARD = {
  type: "PAYMENTCARD",
  cardTypeCode: "VI",
  cardNumber: "4487971000000006",
  cardSecurityCode: "123",
  expiryDate: "1225",
};

function requireTraveler(trip: TripState) {
  if (!trip.traveler?.givenName || !trip.traveler?.surname) {
    throw new Error("No traveler on file for this session — call set_traveler before confirm_booking.");
  }
  return trip.traveler;
}

/**
 * Bundles whatever's currently selected (flight / hotel / car) into a single Sabre order.
 * Field shapes for flightDetails/hotel come from real example bodies in the Postman
 * collection; the `car` block is inferred by the same convention and NOT verified against a
 * real example — check a real cert response/request before relying on it for a car-only demo.
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
      address: {
        name: `${traveler.givenName} ${traveler.surname}`,
        countryCode: "US",
      },
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
    payment: { formsOfPayment: [TEST_CARD] },
  };

  if (trip.selectedFlight) {
    // resolvedJourneys carries every leg (all journeys, all connections) — verified against a
    // real /v1/offers/flightShop response on 2026-07-16, see sabre/flights.ts.
    const resolvedJourneys = trip.selectedFlight.raw?.resolvedJourneys ?? [];
    const allFlights = resolvedJourneys.flatMap((j: { flights: any[] }) => j.flights);
    body.flightDetails = {
      flights: allFlights.map((f: any) => ({
        flightNumber: f.marketingFlightNumber,
        airlineCode: f.marketingAirlineCode,
        fromAirportCode: f.departureAirportCode,
        toAirportCode: f.arrivalAirportCode,
        departureDate: f.departureDate,
        departureTime: f.departureTime,
        flightStatusCode: "NN",
      })),
      flightPricing: [{}],
    };
  }

  if (trip.selectedHotel) {
    const hotelRaw = trip.selectedHotel.raw;
    // bookingKey comes from HotelPriceCheckRS.PriceCheckInfo.BookingKey (cached by
    // selectHotel), verified against a real sandbox call on 2026-07-16 — see sabre/hotels.ts.
    // The `hotel` block's own shape (rooms/formOfPayment) is still unverified against a real
    // CreateBooking call, only against the ATPCO example body's convention.
    body.hotel = {
      bookingKey: hotelRaw?.bookingKey ?? null,
      rooms: [{ travelerIndices: [1] }],
      formOfPayment: 1,
    };
  }

  if (trip.selectedCar) {
    const carRaw = trip.selectedCar.raw;
    // TODO: unverified — no CAR CreateBooking example body was available; shape inferred
    // from the flightDetails/hotel convention.
    body.car = {
      bookingKey: carRaw?.priceChecked?.bookingKey ?? null,
      formOfPayment: 1,
    };
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
