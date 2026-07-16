import 'package:flutter/material.dart';
import '../models/itinerary.dart';

class ItineraryCard extends StatelessWidget {
  final Itinerary itinerary;

  const ItineraryCard({super.key, required this.itinerary});

  @override
  Widget build(BuildContext context) {
    if (itinerary.isEmpty) return const SizedBox.shrink();

    return Card(
      margin: const EdgeInsets.all(12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('Your trip', style: Theme.of(context).textTheme.titleMedium),
                const Spacer(),
                _StatusChip(status: itinerary.bookingStatus),
              ],
            ),
            if (itinerary.flight != null) _ItineraryLine(icon: Icons.flight, data: itinerary.flight!),
            if (itinerary.hotel != null) _ItineraryLine(icon: Icons.hotel, data: itinerary.hotel!),
            if (itinerary.car != null) _ItineraryLine(icon: Icons.directions_car, data: itinerary.car!),
            if (itinerary.confirmationId != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('Confirmation: ${itinerary.confirmationId}',
                    style: Theme.of(context).textTheme.bodySmall),
              ),
          ],
        ),
      ),
    );
  }
}

class _ItineraryLine extends StatelessWidget {
  final IconData icon;
  final Map<String, dynamic> data;

  const _ItineraryLine({required this.icon, required this.data});

  @override
  Widget build(BuildContext context) {
    final summary = data.entries
        .where((e) => e.value != null)
        .map((e) => '${e.key}: ${e.value}')
        .join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text(summary, style: Theme.of(context).textTheme.bodySmall)),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final String status;

  const _StatusChip({required this.status});

  @override
  Widget build(BuildContext context) {
    final confirmed = status == 'confirmed';
    return Chip(
      label: Text(confirmed ? 'Confirmed' : 'Draft'),
      backgroundColor: confirmed ? Colors.green.shade100 : Colors.grey.shade200,
      visualDensity: VisualDensity.compact,
    );
  }
}
