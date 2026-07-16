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

interface SabreFlight {
  id: string;
  departureAirportCode: string;
  departureDate: string;
  departureTime: string;
  arrivalAirportCode: string;
  arrivalDate: string;
  arrivalTime: string;
  operatingAirlineCode: string;
  operatingFlightNumber: number;
  marketingAirlineCode: string;
  marketingFlightNumber: number;
  durationInMinutes?: number;
}

interface SabreJourney {
  id: string;
  flightRefs: string[];
}

interface SabreOffer {
  id: string;
  totalPrice?: { amount: string; currencyCode: string };
  journeyRefs: string[];
}

interface FlightShopResponse {
  offers: SabreOffer[];
  journeys: SabreJourney[];
  flights: SabreFlight[];
}

/** A journey with its flight legs resolved from Sabre's flat id-ref response — this is what
 * gets cached per offer, so selectFlight can rebuild an accurate FlightCheck body (including
 * every leg of a round-trip / every segment of a connection, not just the first one). */
export interface ResolvedJourney {
  journeyId: string;
  flights: SabreFlight[];
}

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
    travelers: Array.from({ length: params.adults ?? 1 }, () => ({ passengerTypeCode: "ADT" })),
    route: { maximumNumberOfStops: 1 },
    sources: { providers: ["Sabre"], distributionModels: ["ATPCO"] },
  };
  if (params.airlineCode) {
    body.airlines = { marketingAirlinesFilter: { airlineCodes: [params.airlineCode] } };
  }

  const response = await sabrePost<FlightShopResponse>("/v1/offers/flightShop", body);

  const flightsById = new Map(response.flights.map((f) => [f.id, f]));
  const journeysById = new Map(response.journeys.map((j) => [j.id, j]));

  const trip = getOrCreateTrip(params.sessionId);
  const offers: CachedOffer<{ offer: SabreOffer; resolvedJourneys: ResolvedJourney[] }>[] = response.offers.map(
    (offer) => {
      const resolvedJourneys: ResolvedJourney[] = offer.journeyRefs.map((journeyId) => {
        const journey = journeysById.get(journeyId);
        const flights = (journey?.flightRefs ?? [])
          .map((flightId) => flightsById.get(flightId))
          .filter((f): f is SabreFlight => Boolean(f));
        return { journeyId, flights };
      });

      const id = nanoid(8);
      const cached: CachedOffer<{ offer: SabreOffer; resolvedJourneys: ResolvedJourney[] }> = {
        id,
        raw: { offer, resolvedJourneys },
        summary: summarizeOffer(offer, resolvedJourneys),
      };
      trip.flightOffers.set(id, cached);
      return cached;
    },
  );

  return {
    offerCount: offers.length,
    offers: offers.map((o) => ({ offer_id: o.id, ...o.summary })),
  };
}

function summarizeOffer(offer: SabreOffer, resolvedJourneys: ResolvedJourney[]): Record<string, unknown> {
  const firstLeg = resolvedJourneys[0]?.flights[0];
  const legCounts = resolvedJourneys.map((j) => j.flights.length);
  return {
    airline: firstLeg?.marketingAirlineCode ?? "unknown",
    flightNumber: firstLeg?.marketingFlightNumber ?? null,
    departureAirport: firstLeg?.departureAirportCode ?? null,
    arrivalAirport: resolvedJourneys[0]?.flights.at(-1)?.arrivalAirportCode ?? null,
    departureDate: firstLeg?.departureDate ?? null,
    departureTime: firstLeg?.departureTime ?? null,
    stopsPerJourney: legCounts.map((n) => n - 1),
    journeyCount: resolvedJourneys.length, // 1 = one-way, 2 = round trip
    price: offer.totalPrice?.amount ?? null,
    currency: offer.totalPrice?.currencyCode ?? null,
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

  const resolvedJourneys: ResolvedJourney[] = offer.raw.resolvedJourneys;
  const checkBody = {
    journeys: resolvedJourneys.map((journey) => ({
      flights: journey.flights.map((f) => ({
        departureAirportCode: f.departureAirportCode,
        departureDate: f.departureDate,
        departureTime: f.departureTime,
        arrivalAirportCode: f.arrivalAirportCode,
        arrivalDate: f.arrivalDate,
        arrivalTime: f.arrivalTime,
        operatingAirlineCode: f.operatingAirlineCode,
        operatingFlightNumber: f.operatingFlightNumber,
        marketingAirlineCode: f.marketingAirlineCode,
        marketingFlightNumber: f.marketingFlightNumber,
      })),
    })),
    travelers: [{ passengerTypeCode: "ADT" }],
  };

  // FlightCheck responds with the same flat { offers, journeys, flights } shape as FlightShop,
  // but can return several re-priced offers for the same itinerary (different fare buckets),
  // linked via additionalOffersRefs — offers[0] is NOT necessarily the fare that was shopped.
  // Verified against a real sandbox call on 2026-07-16: shopping a $144.39 fare came back with
  // offers[0] at $462.40 (a pricier fare class) and the original $144.39 fare as offers[1].
  // Pick whichever checked offer's price matches what was shopped; fall back to the first
  // (and flag it) if none match, since availability can legitimately change between calls.
  const checked = await sabrePost<FlightShopResponse>("/v1/offers/flightCheck", checkBody);
  const shoppedPrice = offer.raw.offer.totalPrice?.amount;
  const matchingOffer =
    checked.offers?.find((o) => o.totalPrice?.amount === shoppedPrice) ?? checked.offers?.[0];

  offer.raw = { ...offer.raw, checked, checkedOffer: matchingOffer };
  offer.summary = {
    ...offer.summary,
    checkedPrice: matchingOffer?.totalPrice?.amount ?? offer.summary.price,
    priceChanged: matchingOffer?.totalPrice?.amount !== shoppedPrice,
  };
  trip.selectedFlight = offer;

  return { offer_id: offer.id, ...offer.summary };
}
