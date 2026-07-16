import { nanoid } from "nanoid";
import { sabrePost } from "./client.js";
import { getOrCreateTrip, type CachedOffer } from "../trip/store.js";

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
  const rawHotels: any[] =
    response?.GetHotelAvailRS?.HotelAvailInfos?.HotelAvailInfo ??
    response?.HotelAvailInfos ??
    [];
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

export interface SelectHotelParams {
  sessionId: string;
  hotelOfferId: string;
}

export async function selectHotel({ sessionId, hotelOfferId }: SelectHotelParams) {
  const trip = getOrCreateTrip(sessionId);
  const offer = trip.hotelOffers.get(hotelOfferId);
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

  offer.raw = { ...offer.raw, priceChecked, bookingKey: priceCheckInfo?.BookingKey };
  offer.summary = {
    ...offer.summary,
    priceChanged: priceCheckInfo?.PriceChange ?? false,
    priceDifference: priceCheckInfo?.PriceDifference ?? "0.00",
  };
  trip.selectedHotel = offer;

  return { hotel_offer_id: offer.id, ...offer.summary };
}
