import { nanoid } from "nanoid";
import { sabrePost } from "./client.js";
import { getOrCreateTrip, type CachedOffer } from "../trip/store.js";

export interface SearchCarsParams {
  sessionId: string;
  pickupLocationCode: string;
  dropoffLocationCode?: string; // defaults to pickup location
  pickupDate: string; // YYYY-MM-DD
  pickupTime?: string; // HH:MM, default 10:00
  returnDate: string; // YYYY-MM-DD
  returnTime?: string; // HH:MM, default 10:00
}

export async function searchCars(params: SearchCarsParams) {
  const body = {
    GetVehAvailRQ: {
      SearchCriteria: {
        PickUpDate: params.pickupDate,
        ReturnDate: params.returnDate,
        PickUpTime: params.pickupTime ?? "10:00",
        ReturnTime: params.returnTime ?? "10:00",
        SortBy: "Price",
        SortOrder: "ASC",
        AirportRef: {
          PickUpLocation: { LocationCode: params.pickupLocationCode },
          ReturnLocation: { LocationCode: params.dropoffLocationCode ?? params.pickupLocationCode },
        },
      },
    },
  };

  const response = await sabrePost<any>("/v2.0.0/get/vehavail", body);

  const trip = getOrCreateTrip(params.sessionId);
  const rawCars: any[] = response?.GetVehAvailRS?.VehAvails?.VehAvail ?? response?.VehAvails ?? [];
  const offers: CachedOffer[] = rawCars.map((raw) => {
    const id = nanoid(8);
    const cached: CachedOffer = { id, raw, summary: summarizeCar(raw) };
    trip.carOffers.set(id, cached);
    return cached;
  });

  return {
    carCount: offers.length,
    cars: offers.map((o) => ({ car_offer_id: o.id, ...o.summary })),
  };
}

function summarizeCar(raw: any): Record<string, unknown> {
  const veh = raw?.VehAvailCore ?? raw;
  return {
    vendor: veh?.Vendor?.Name ?? veh?.Vendor?.Code ?? "unknown",
    vehicleType: veh?.Vehicle?.VehType ?? veh?.Vehicle?.Class ?? null,
    dailyRate: veh?.TotalCharge?.RateTotalAmount ?? veh?.RentalRate?.VehicleCharges?.[0]?.Amount ?? null,
    currency: veh?.TotalCharge?.CurrencyCode ?? "USD",
  };
}

export interface SelectCarParams {
  sessionId: string;
  carOfferId: string;
}

export async function selectCar({ sessionId, carOfferId }: SelectCarParams) {
  const trip = getOrCreateTrip(sessionId);
  const offer = trip.carOffers.get(carOfferId);
  if (!offer) {
    throw new Error(`No cached car offer ${carOfferId} for session ${sessionId}. Call search_cars first.`);
  }

  // TODO: exact VehPriceCheck body wasn't captured — passing the cached avail record
  // through as a starting point, verify against a real sandbox call.
  const priceChecked = await sabrePost<any>("/v1.0.0/veh/pricecheck", { VehPriceCheckRQ: offer.raw });

  offer.raw = { ...offer.raw, priceChecked };
  offer.summary = { ...offer.summary, priceChecked: true };
  trip.selectedCar = offer;

  return { car_offer_id: offer.id, ...offer.summary };
}
