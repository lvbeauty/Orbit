class TranscriptEntry {
  final String role; // 'user' or 'agent'
  final String text;
  final int timestamp;

  const TranscriptEntry({required this.role, required this.text, required this.timestamp});
}
