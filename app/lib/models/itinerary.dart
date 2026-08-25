/// Mirrors the backend's get_draft_itinerary / itinerary_updated payload shape
/// (see backend/src/tools/router.ts). Kept as a loose map-backed model since the
/// underlying Sabre field shapes are still being firmed up.
class Itinerary {
  final Map<String, dynamic>? flight;
  final Map<String, dynamic>? hotel;
  final Map<String, dynamic>? car;
  final String bookingStatus;
  final String? confirmationId;

  const Itinerary({
    this.flight,
    this.hotel,
    this.car,
    this.bookingStatus = 'draft',
    this.confirmationId,
  });

  factory Itinerary.fromJson(Map<String, dynamic> json) {
    return Itinerary(
      flight: json['flight'] as Map<String, dynamic>?,
      hotel: json['hotel'] as Map<String, dynamic>?,
      car: json['car'] as Map<String, dynamic>?,
      bookingStatus: json['bookingStatus'] as String? ?? 'draft',
      confirmationId: json['confirmationId'] as String?,
    );
  }

  bool get isEmpty => flight == null && hotel == null && car == null;
}
