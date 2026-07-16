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

  identityDocuments: IdentityDocument[];

  confirmationId?: string;
  bookingStatus: "draft" | "confirmed" | "cancelled";
}

const sessions = new Map<string, TripState>();

export function getOrCreateTrip(sessionId: string): TripState {
  let trip = sessions.get(sessionId);
  if (!trip) {
    trip = {
      sessionId,
      createdAt: Date.now(),
      flightOffers: new Map(),
      hotelOffers: new Map(),
      carOffers: new Map(),
      identityDocuments: [],
      bookingStatus: "draft",
    };
    sessions.set(sessionId, trip);
  }
  return trip;
}

export function getTrip(sessionId: string): TripState | undefined {
  return sessions.get(sessionId);
}
