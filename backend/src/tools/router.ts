import { Router, type Request, type Response, type NextFunction } from "express";
import { searchFlights, selectFlight } from "../sabre/flights.js";
import { searchHotels, selectHotel } from "../sabre/hotels.js";
import { searchCars, selectCar } from "../sabre/cars.js";
import { setTraveler, confirmBooking, getBooking, cancelBooking, modifyBooking } from "../sabre/booking.js";
import { getTrip, getOrCreateTrip } from "../trip/store.js";
import { extractIdentityDocument } from "../landingai/client.js";
import { recommendDining, recommendExperiences } from "./curated.js";

/**
 * One endpoint per Vocal Bridge Custom HTTP API Tool (see vb-config/api-tools.json).
 * All tools take/return flat JSON — Custom HTTP API Tool parameters are string/number/boolean
 * only, so anything nested (offers, trip state) is cached server-side in trip/store.ts and
 * referenced by a short id instead of being passed through the agent.
 */
export const toolsRouter = Router();

function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await fn(req, res);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };
}

toolsRouter.post(
  "/search_flights",
  wrap(async (req) => {
    const { session_id, origin, destination, departure_date, return_date, adults } = req.body;
    return searchFlights({
      sessionId: session_id,
      origin,
      destination,
      departureDate: departure_date,
      returnDate: return_date,
      adults,
    });
  }),
);

toolsRouter.post(
  "/select_flight",
  wrap(async (req) => {
    const { session_id, offer_id } = req.body;
    return selectFlight({ sessionId: session_id, offerId: offer_id });
  }),
);

toolsRouter.post(
  "/search_hotels",
  wrap(async (req) => {
    const { session_id, location_code, check_in_date, check_out_date, adults } = req.body;
    return searchHotels({
      sessionId: session_id,
      locationCode: location_code,
      checkInDate: check_in_date,
      checkOutDate: check_out_date,
      adults,
    });
  }),
);

toolsRouter.post(
  "/select_hotel",
  wrap(async (req) => {
    const { session_id, hotel_offer_id } = req.body;
    return selectHotel({ sessionId: session_id, hotelOfferId: hotel_offer_id });
  }),
);

toolsRouter.post(
  "/search_cars",
  wrap(async (req) => {
    const { session_id, pickup_location_code, dropoff_location_code, pickup_date, return_date } = req.body;
    return searchCars({
      sessionId: session_id,
      pickupLocationCode: pickup_location_code,
      dropoffLocationCode: dropoff_location_code,
      pickupDate: pickup_date,
      returnDate: return_date,
    });
  }),
);

toolsRouter.post(
  "/select_car",
  wrap(async (req) => {
    const { session_id, car_offer_id } = req.body;
    return selectCar({ sessionId: session_id, carOfferId: car_offer_id });
  }),
);

toolsRouter.post(
  "/set_traveler",
  wrap(async (req) => {
    const { session_id, given_name, surname, birth_date, email, phone } = req.body;
    return setTraveler({ sessionId: session_id, givenName: given_name, surname, birthDate: birth_date, email, phone });
  }),
);

toolsRouter.post(
  "/get_draft_itinerary",
  wrap(async (req) => {
    const { session_id } = req.body;
    const trip = getTrip(session_id);
    if (!trip) return { hasItinerary: false };
    return {
      hasItinerary: true,
      flight: trip.selectedFlight?.summary ?? null,
      hotel: trip.selectedHotel?.summary ?? null,
      car: trip.selectedCar?.summary ?? null,
      traveler: trip.traveler ?? null,
      identityDocuments: trip.identityDocuments,
      bookingStatus: trip.bookingStatus,
      confirmationId: trip.confirmationId ?? null,
    };
  }),
);

toolsRouter.post(
  "/confirm_booking",
  wrap(async (req) => {
    const { session_id } = req.body;
    return confirmBooking(session_id);
  }),
);

toolsRouter.post(
  "/get_trip",
  wrap(async (req) => {
    const { confirmation_id } = req.body;
    return getBooking(confirmation_id);
  }),
);

toolsRouter.post(
  "/cancel_trip",
  wrap(async (req) => {
    const { confirmation_id } = req.body;
    return cancelBooking(confirmation_id);
  }),
);

toolsRouter.post(
  "/modify_trip",
  wrap(async (req) => {
    const { confirmation_id, changes_json } = req.body;
    let changes: Record<string, unknown> = {};
    try {
      changes = changes_json ? JSON.parse(changes_json) : {};
    } catch {
      throw new Error("changes_json must be a valid JSON string");
    }
    return modifyBooking(confirmation_id, changes);
  }),
);

toolsRouter.post(
  "/recommend_dining",
  wrap(async (req) => {
    const { city, cuisine } = req.body;
    return { picks: recommendDining(city, cuisine) };
  }),
);

toolsRouter.post(
  "/recommend_experiences",
  wrap(async (req) => {
    const { city, interest } = req.body;
    return { picks: recommendExperiences(city, interest) };
  }),
);

toolsRouter.post(
  "/extract_travel_document",
  wrap(async (req) => {
    const { session_id, document_url } = req.body;
    const fields = await extractIdentityDocument(document_url);
    const trip = getOrCreateTrip(session_id);
    trip.identityDocuments.push(fields);
    return { extracted: fields };
  }),
);
