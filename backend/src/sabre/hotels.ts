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

function summarizeHotel(raw: any): Record<string, unknown> {
  const hotel = raw?.HotelInfo ?? raw;
  const rate = raw?.RateInfo ?? raw?.RateRange;
  return {
    name: hotel?.HotelName ?? hotel?.Name ?? "unknown",
    hotelCode: hotel?.HotelCode ?? null,
    city: hotel?.Address?.CityName ?? null,
    nightlyRate: rate?.AverageRate ?? rate?.MinRate ?? null,
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

  // TODO: exact HotelPriceCheck request body wasn't captured from the collection for this
  // path — this passes the cached HotelAvailInfo straight through, which is a reasonable
  // starting guess (Sabre's price-check APIs generally accept the avail response back) but
  // should be verified against a real sandbox call.
  const priceChecked = await sabrePost<any>("/v5/hotel/pricecheck", { HotelPriceCheckRQ: offer.raw });

  offer.raw = { ...offer.raw, priceChecked };
  offer.summary = { ...offer.summary, priceChecked: true };
  trip.selectedHotel = offer;

  return { hotel_offer_id: offer.id, ...offer.summary };
}
