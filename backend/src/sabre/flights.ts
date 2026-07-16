import { nanoid } from "nanoid";
import { sabrePost } from "./client.js";
import { getOrCreateTrip, type CachedOffer } from "../trip/store.js";

export interface SearchFlightsParams {
  sessionId: string;
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD, omit for one-way
  adults?: number;
  airlineCode?: string;
}

/**
 * NOTE: field names below (journeys[].flights[], pricedItinerary, etc.) are inferred from the
 * Sabre Postman collection's *request* shape and general Offers API conventions — we haven't
 * seen a real FlightShop response yet. The extraction in `summarizeOffer` is defensive
 * (falls back to raw dump) specifically because of that; once you make a real sandbox call,
 * tighten `summarizeOffer` to match the actual field paths.
 */
export async function searchFlights(params: SearchFlightsParams) {
  const journeys = [
    {
      departureLocation: { airportCode: params.origin },
      arrivalLocation: { airportCode: params.destination },
      departureDate: params.departureDate,
    },
  ];
  if (params.returnDate) {
    journeys.push({
      departureLocation: { airportCode: params.destination },
      arrivalLocation: { airportCode: params.origin },
      departureDate: params.returnDate,
    });
  }

  const body: Record<string, unknown> = {
    journeys,
    travelers: [{ passengerTypeCode: "ADT" }].slice(0, 1).flatMap((t) =>
      Array.from({ length: params.adults ?? 1 }, () => t),
    ),
    route: { maximumNumberOfStops: 1 },
    sources: { providers: ["Sabre"], distributionModels: ["ATPCO"] },
  };
  if (params.airlineCode) {
    body.airlines = { marketingAirlinesFilter: { airlineCodes: [params.airlineCode] } };
  }

  const response = await sabrePost<any>("/v1/offers/flightShop", body);

  const trip = getOrCreateTrip(params.sessionId);
  const rawOffers: any[] = response?.offers ?? response?.pricedItineraries ?? [];
  const offers: CachedOffer[] = rawOffers.map((raw) => {
    const id = nanoid(8);
    const cached: CachedOffer = { id, raw, summary: summarizeOffer(raw) };
    trip.flightOffers.set(id, cached);
    return cached;
  });

  return {
    offerCount: offers.length,
    offers: offers.map((o) => ({ offer_id: o.id, ...o.summary })),
  };
}

function summarizeOffer(raw: any): Record<string, unknown> {
  const flight = raw?.journeys?.[0]?.flights?.[0] ?? raw?.flights?.[0];
  return {
    airline: flight?.marketingAirlineCode ?? flight?.operatingAirlineCode ?? "unknown",
    flightNumber: flight?.marketingFlightNumber ?? flight?.operatingFlightNumber ?? null,
    departureAirport: flight?.departureAirportCode ?? null,
    arrivalAirport: flight?.arrivalAirportCode ?? null,
    departureDate: flight?.departureDate ?? null,
    departureTime: flight?.departureTime ?? null,
    price: raw?.price?.totalPrice ?? raw?.totalFare?.totalPrice ?? null,
    currency: raw?.price?.currencyCode ?? raw?.totalFare?.currency ?? null,
  };
}

export interface SelectFlightParams {
  sessionId: string;
  offerId: string;
}

export async function selectFlight({ sessionId, offerId }: SelectFlightParams) {
  const trip = getOrCreateTrip(sessionId);
  const offer = trip.flightOffers.get(offerId);
  if (!offer) {
    throw new Error(`No cached flight offer ${offerId} for session ${sessionId}. Call search_flights first.`);
  }

  const rawFlight = offer.raw?.journeys?.[0]?.flights?.[0] ?? offer.raw?.flights?.[0] ?? {};
  const checkBody = {
    journeys: [
      {
        flights: [
          {
            departureAirportCode: rawFlight.departureAirportCode,
            departureDate: rawFlight.departureDate,
            departureTime: rawFlight.departureTime,
            arrivalAirportCode: rawFlight.arrivalAirportCode,
            arrivalDate: rawFlight.arrivalDate,
            arrivalTime: rawFlight.arrivalTime,
            operatingAirlineCode: rawFlight.operatingAirlineCode ?? rawFlight.marketingAirlineCode,
            operatingFlightNumber: rawFlight.operatingFlightNumber ?? rawFlight.marketingFlightNumber,
            marketingAirlineCode: rawFlight.marketingAirlineCode,
            marketingFlightNumber: rawFlight.marketingFlightNumber,
          },
        ],
      },
    ],
    travelers: [{ passengerTypeCode: "ADT" }],
  };

  const checked = await sabrePost<any>("/v1/offers/flightCheck", checkBody);

  offer.raw = { ...offer.raw, checked };
  offer.summary = { ...offer.summary, checkedPrice: checked?.price?.totalPrice ?? checked?.totalFare?.totalPrice ?? null };
  trip.selectedFlight = offer;

  return { offer_id: offer.id, ...offer.summary };
}
