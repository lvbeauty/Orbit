import { nanoid } from "nanoid";
import { sabrePost } from "./client.js";
import { getOrCreateTrip, resolveOffer, type CachedOffer } from "../trip/store.js";
import { dedupe } from "../trip/dedupe.js";

export interface SearchHotelsParams {
  sessionId: string;
  /** Sabre location code to search around (airport or city code), e.g. "NYC" */
  locationCode: string;
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string; // YYYY-MM-DD
  adults?: number;
  radiusKm?: number;
}

export async function searchHotels(params: SearchHotelsParams) {
  const key = JSON.stringify([
    "search_hotels",
    params.sessionId,
    params.locationCode,
    params.checkInDate,
    params.checkOutDate,
    params.adults,
  ]);
  return dedupe(key, () => searchHotelsImpl(params));
}

async function searchHotelsImpl(params: SearchHotelsParams) {
  const body = {
    GetHotelAvailRQ: {
      SearchCriteria: {
        PageSize: 20,
        SortBy: "SabreRating",
        SortOrder: "DESC",
        GeoSearch: {
          GeoRef: {
            Radius: params.radiusKm ?? 30,
            UOM: "KM",
            RefPoint: {
              Value: params.locationCode,
              ValueContext: "CODE",
              RefPointType: "6",
            },
          },
        },
        RateInfoRef: {
          CurrencyCode: "USD",
          BestOnly: "2",
          StayDateTimeRange: {
            StartDate: params.checkInDate,
            EndDate: params.checkOutDate,
          },
          Rooms: { Room: [{ Index: 1, Adults: params.adults ?? 1 }] },
          RateSource: "100",
        },
      },
    },
  };

  const response = await sabrePost<any>("/v5/get/hotelavail", body);

  const trip = getOrCreateTrip(params.sessionId);
  const rawHotels: any[] = response?.GetHotelAvailRS?.HotelAvailInfos?.HotelAvailInfo ?? [];
  const offers: CachedOffer[] = rawHotels.map((raw) => {
    const id = nanoid(8);
    const cached: CachedOffer = { id, raw, summary: summarizeHotel(raw) };
    trip.hotelOffers.set(id, cached);
    return cached;
  });

  return {
    hotelCount: offers.length,
    hotels: offers.map((o) => ({ hotel_offer_id: o.id, ...o.summary })),
  };
}

// Verified against a real /v5/get/hotelavail sandbox response on 2026-07-16 — city lives
// under HotelInfo.LocationInfo.Address, not HotelInfo.Address, and pricing is a sibling
// HotelRateInfo block (not nested in HotelInfo) keyed by a RateKey needed for price-check.
function summarizeHotel(raw: any): Record<string, unknown> {
  const hotel = raw?.HotelInfo ?? {};
  const rate = raw?.HotelRateInfo?.RateInfos?.ConvertedRateInfo?.[0];
  // RateKey deliberately excluded — it's a long opaque string the agent has no reason to
  // speak or the app to display, and selectHotel reads it straight from the cached raw offer.
  return {
    name: hotel?.HotelName ?? "unknown",
    hotelCode: hotel?.HotelCode ?? null,
    city: hotel?.LocationInfo?.Address?.CityName?.value ?? null,
    nightlyRate: rate?.AverageNightlyRate ?? null,
    totalPrice: rate?.ApproxTotalPrice ?? null,
    currency: rate?.CurrencyCode ?? "USD",
  };
}

// CreateBooking's hotel.paymentPolicy is an enum (GUARANTEE/DEPOSIT/LATE) — verified
// 2026-07-16 via Sabre's own "not one of the values accepted" error — but the price-check
// response reports it as a different internal code (GuaranteeType: GUAR/DEP/...).
const PAYMENT_POLICY_MAP: Record<string, string> = { GUAR: "GUARANTEE", DEP: "DEPOSIT", LATE: "LATE" };

export interface SelectHotelParams {
  sessionId: string;
  hotelOfferId: string;
}

export async function selectHotel({ sessionId, hotelOfferId }: SelectHotelParams) {
  const trip = getOrCreateTrip(sessionId);
  const offer = resolveOffer(trip.hotelOffers, hotelOfferId);
  if (!offer) {
    throw new Error(`No cached hotel offer ${hotelOfferId} for session ${sessionId}. Call search_hotels first.`);
  }

  const rateKey = offer.raw?.HotelRateInfo?.RateInfos?.ConvertedRateInfo?.[0]?.RateKey;
  if (!rateKey) {
    throw new Error(`Cached hotel offer ${hotelOfferId} has no RateKey to price-check.`);
  }

  // Verified against a real sandbox call on 2026-07-16: HotelPriceCheckRQ needs a
  // RateInfoRef.RateKey (from the avail response), and returns a *different* key —
  // PriceCheckInfo.BookingKey — which is what CreateBooking actually needs.
  const priceChecked = await sabrePost<any>("/v5/hotel/pricecheck", {
    HotelPriceCheckRQ: { RateInfoRef: { RateKey: rateKey } },
  });
  const priceCheckInfo = priceChecked?.HotelPriceCheckRS?.PriceCheckInfo;
  const guaranteeType = priceCheckInfo?.HotelRateInfo?.Rooms?.Room?.[0]?.RatePlans?.RatePlan?.[0]?.RateInfo?.Guarantee?.GuaranteeType;
  const paymentPolicy = PAYMENT_POLICY_MAP[guaranteeType] ?? "GUARANTEE";

  offer.raw = { ...offer.raw, priceChecked, bookingKey: priceCheckInfo?.BookingKey, paymentPolicy };
  offer.summary = {
    ...offer.summary,
    priceChanged: priceCheckInfo?.PriceChange ?? false,
    priceDifference: priceCheckInfo?.PriceDifference ?? "0.00",
  };
  trip.selectedHotel = offer;

  return { hotel_offer_id: offer.id, ...offer.summary };
}
