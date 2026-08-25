import { nanoid } from "nanoid";
import { sabrePost } from "./client.js";
import { getOrCreateTrip, resolveOffer, type CachedOffer } from "../trip/store.js";
import { dedupe } from "../trip/dedupe.js";

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
  const key = JSON.stringify([
    "search_cars",
    params.sessionId,
    params.pickupLocationCode,
    params.dropoffLocationCode,
    params.pickupDate,
    params.returnDate,
  ]);
  return dedupe(key, () => searchCarsImpl(params));
}

async function searchCarsImpl(params: SearchCarsParams) {
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
        // Sabre 400s without these two — trimmed out of the Postman example by mistake
        // originally; restored after hitting "missing required properties" on 2026-07-16.
        RatePrefs: { ConvertedRateInfoOnly: false, SupplierCurrencyOnly: true },
        LocPolicyRef: { Include: true },
      },
    },
  };

  const response = await sabrePost<any>("/v2.0.0/get/vehavail", body);

  // Verified against a real sandbox response on 2026-07-16 — same "XxxInfos.XxxInfo" naming
  // convention as GetHotelAvail, not the VehAvails.VehAvail shape originally guessed.
  const trip = getOrCreateTrip(params.sessionId);
  const rawCars: any[] = response?.GetVehAvailRS?.VehAvailInfos?.VehAvailInfo ?? [];
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

function charge(charges: any[] | undefined, chargeType: string): { Amount?: string; CurrencyCode?: string } | undefined {
  return charges?.find((c) => c.ChargeType === chargeType);
}

function summarizeCar(raw: any): Record<string, unknown> {
  const rate = raw?.VehRentalRate?.[0];
  const charges: any[] = rate?.VehicleCharges?.VehicleCharge ?? [];
  const dailyCharge = charge(charges, "BaseRateTotal");
  const totalCharge = charge(charges, "ApproximateTotalPrice");
  return {
    vendor: raw?.Vendor?.Name ?? raw?.Vendor?.Code ?? "unknown",
    vehicleType: rate?.Vehicle?.VehType ?? null,
    dailyRate: dailyCharge?.Amount ?? null,
    totalPrice: totalCharge?.Amount ?? null,
    // CurrencyCode is only populated on the first charge entry in practice — fall back to USD.
    currency: dailyCharge?.CurrencyCode ?? charges[0]?.CurrencyCode ?? "USD",
  };
}

export interface SelectCarParams {
  sessionId: string;
  carOfferId: string;
}

export async function selectCar({ sessionId, carOfferId }: SelectCarParams) {
  const trip = getOrCreateTrip(sessionId);
  const offer = resolveOffer(trip.carOffers, carOfferId);
  if (!offer) {
    throw new Error(`No cached car offer ${carOfferId} for session ${sessionId}. Call search_cars first.`);
  }

  const rateKey = offer.raw?.VehRentalRate?.[0]?.RateKey;
  if (!rateKey) {
    throw new Error(`Cached car offer ${carOfferId} has no RateKey to price-check.`);
  }

  // Verified against a real sandbox call on 2026-07-16 — found the actual field name
  // (VehRateInfoRef, not RateInfoRef like the hotel endpoint) in the Postman collection's
  // VehPriceCheck example after the hotel-shaped guess got rejected by Sabre's own schema
  // validation. Response shape (PriceCheckInfo.BookingKey/PriceChange/PriceDifference)
  // mirrors HotelPriceCheck exactly.
  const priceChecked = await sabrePost<any>("/v1.0.0/veh/pricecheck", {
    VehPriceCheckRQ: { VehRateInfoRef: { RateKey: rateKey } },
  });
  const priceCheckInfo = priceChecked?.VehPriceCheckRS?.PriceCheckInfo;

  offer.raw = { ...offer.raw, priceChecked, bookingKey: priceCheckInfo?.BookingKey };
  offer.summary = {
    ...offer.summary,
    priceChanged: priceCheckInfo?.PriceChange ?? false,
    priceDifference: priceCheckInfo?.PriceDifference ?? "0.00",
  };
  trip.selectedCar = offer;

  return { car_offer_id: offer.id, ...offer.summary };
}
