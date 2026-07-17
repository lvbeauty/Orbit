/**
 * In-memory per-session trip state. Vocal Bridge's Custom HTTP API Tools only support
 * scalar (string/number/boolean) parameters, so the agent can't pass a full flight/hotel/car
 * offer object back to us — it can only pass back a short id we handed it. This store is
 * what makes that possible: search tools cache full Sabre offers here, select tools look them
 * up by id to build the next Sabre call, and confirmBooking reads everything back out.
 *
 * Every tool call must carry a session_id. The Flutter client sends one as soon as it
 * connects, via an app_to_agent "session_start" Client Action (behavior: notify) — see
 * vb-config/client-actions.json — so it's in the agent's context for every subsequent tool call.
 */

export interface CachedOffer<T = any> {
  id: string;
  raw: T;
  summary: Record<string, unknown>;
}

/**
 * Same reasoning as the session_id fallback below: the model can hallucinate a plausible-
 * looking offer_id (observed 2026-07-17: "renaissance_seattle_20260724" instead of a real
 * short random id like "rNMMQyPv") instead of the exact one a search tool returned. If the
 * given id isn't cached, fall back to the most recently cached offer of that type rather than
 * failing outright — in a single-conversation demo there's rarely real ambiguity about which
 * offer "the hotel I just found" refers to.
 */
export function resolveOffer<T>(offers: Map<string, CachedOffer<T>>, offerId: string): CachedOffer<T> | undefined {
  const exact = offers.get(offerId);
  if (exact) return exact;
  const values = [...offers.values()];
  return values.at(-1);
}

export interface IdentityDocument {
  documentType?: string;
  fullName?: string;
  passportNumber?: string;
  nationality?: string;
  dateOfBirth?: string;
  expirationDate?: string;
  issuingCountry?: string;
}

export interface TripState {
  sessionId: string;
  createdAt: number;

  flightOffers: Map<string, CachedOffer>;
  hotelOffers: Map<string, CachedOffer>;
  carOffers: Map<string, CachedOffer>;

  selectedFlight?: CachedOffer;
  selectedHotel?: CachedOffer;
  selectedCar?: CachedOffer;

  traveler?: {
    givenName?: string;
    surname?: string;
    birthDate?: string;
    email?: string;
    phone?: string;
  };

  /**
   * Scoped to one infant (traveling with the primary adult) — matches Sabre's own example
   * shape (a second `travelers[]` entry with passengerCode "INF", own name/birthDate). Multiple
   * distinct adult identities aren't captured at all yet (confirmBooking only ever books the one
   * `traveler` above regardless of `adults` count) — that's a pre-existing gap, not something
   * this infant support fixes.
   */
  infant?: {
    givenName?: string;
    surname?: string;
    birthDate?: string;
  };

  /**
   * Up to two children (passengerCode "CNN") — Custom HTTP API Tools only take flat scalar
   * params, so this is two fixed slots (child1/child2) rather than a real array; a third child
   * isn't representable without adding more tool params.
   */
  children: { givenName?: string; surname?: string; birthDate?: string }[];

  /** Passenger-type mix used for the last flight search, so selectFlight's FlightCheck call can
   * send the same travelers[] composition Sabre priced against in FlightShop. */
  lastFlightSearchPartyMix?: { adults: number; infants: number; children: number };

  identityDocuments: IdentityDocument[];

  confirmationId?: string;
  bookingStatus: "draft" | "confirmed" | "cancelled";
}

const sessions = new Map<string, TripState>();

/**
 * Verified 2026-07-17: over one ~11-minute call, the background model used three different
 * (partly hallucinated) session_id values across tool calls — not a one-off, a real LLM
 * long-context reliability limit, and Vocal Bridge sends no other call/session-identifying
 * header we could use instead (checked the raw HTTP requests it sends). Since this app is a
 * single-conversation-at-a-time demo, not a multi-tenant service, we self-heal instead of
 * failing: an unrecognized session_id falls back to the one active (unconfirmed) trip rather
 * than silently starting over or throwing. This trades strict session isolation (irrelevant
 * here — only one real conversation happens at a time) for actually completing bookings.
 */
let lastActiveSessionId: string | undefined;

function resolveTrip(sessionId: string): TripState | undefined {
  const exact = sessions.get(sessionId);
  if (exact) return exact;
  if (lastActiveSessionId) {
    const fallback = sessions.get(lastActiveSessionId);
    if (fallback && fallback.bookingStatus === "draft") {
      console.warn(`[trip] session_id "${sessionId}" not found — falling back to active trip "${lastActiveSessionId}"`);
      return fallback;
    }
  }
  return undefined;
}

export function getOrCreateTrip(sessionId: string): TripState {
  let trip = resolveTrip(sessionId);
  if (!trip) {
    trip = {
      sessionId,
      createdAt: Date.now(),
      flightOffers: new Map(),
      hotelOffers: new Map(),
      carOffers: new Map(),
      children: [],
      identityDocuments: [],
      bookingStatus: "draft",
    };
    sessions.set(sessionId, trip);
  }
  lastActiveSessionId = trip.sessionId;
  return trip;
}

export function getTrip(sessionId: string): TripState | undefined {
  const trip = resolveTrip(sessionId);
  if (trip) lastActiveSessionId = trip.sessionId;
  return trip;
}
