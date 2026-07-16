import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart' as lk;
import '../models/itinerary.dart';
import '../models/transcript_entry.dart';
import 'backend_api.dart';

/// Connects to the Vocal Bridge agent over LiveKit and exposes transcript / itinerary state
/// to the UI. Vocal Bridge has no official Flutter SDK (only JS/React/Python) — this
/// hand-implements its documented client_actions data-channel protocol on top of the raw
/// livekit_client package, following the Flutter example in the developer guide.
class VoiceAgentService extends ChangeNotifier {
  final BackendApi _api = BackendApi();

  lk.Room? _room;
  lk.EventsListener<lk.RoomEvent>? _listener;
  String? _sessionId;
  bool _disposed = false;

  final List<TranscriptEntry> transcript = [];
  Itinerary itinerary = const Itinerary();
  bool isConnected = false;
  bool isConnecting = false;
  String? lastError;

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  /// [ChangeNotifier.notifyListeners] throws if called after [dispose] — which can happen
  /// here because disconnect()/connect() keep running after a fire-and-forget call from
  /// State.dispose() (which can't await them). Route every notify through this instead.
  void _safeNotify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> connect() async {
    if (isConnected || isConnecting) return;
    isConnecting = true;
    lastError = null;
    _safeNotify();

    try {
      final tokenData = await _api.fetchVoiceToken();
      _sessionId = tokenData.roomName;

      final room = lk.Room();
      _room = room;
      final listener = room.createListener();
      _listener = listener;

      listener.on<lk.DataReceivedEvent>(_handleDataReceived);
      listener.on<lk.RoomDisconnectedEvent>((_) {
        isConnected = false;
        _safeNotify();
      });

      await room.connect(tokenData.livekitUrl, tokenData.token);
      await room.localParticipant?.setMicrophoneEnabled(true);

      isConnected = true;
      isConnecting = false;
      _safeNotify();

      // Tell the agent which session_id to pass back on every trip tool call — see
      // backend/vb-config/client-actions.json ("session_start").
      await _sendClientAction('session_start', {'session_id': _sessionId});
    } catch (e) {
      lastError = e.toString();
      isConnecting = false;
      _safeNotify();
    }
  }

  Future<void> disconnect() async {
    await _listener?.dispose();
    await _room?.disconnect();
    _room = null;
    _listener = null;
    isConnected = false;
    _safeNotify();
  }

  Future<void> toggleMicrophone() async {
    final participant = _room?.localParticipant;
    if (participant == null) return;
    await participant.setMicrophoneEnabled(!participant.isMicrophoneEnabled());
    _safeNotify();
  }

  bool get isMicrophoneEnabled => _room?.localParticipant?.isMicrophoneEnabled() ?? false;

  /// Uploads a captured document photo and notifies the agent it's ready via the
  /// `document_uploaded` client action (see backend/vb-config/client-actions.json).
  Future<void> notifyDocumentUploaded(String filePath) async {
    final url = await _api.uploadDocument(File(filePath));
    await _sendClientAction('document_uploaded', {'document_url': url});
  }

  Future<void> _sendClientAction(String action, Map<String, dynamic> payload) async {
    final room = _room;
    if (room == null) return;
    final message = jsonEncode({'type': 'client_action', 'action': action, 'payload': payload});
    await room.localParticipant?.publishData(
      utf8.encode(message),
      reliable: true,
      topic: 'client_actions',
    );
  }

  void _handleDataReceived(lk.DataReceivedEvent event) {
    if (event.topic != 'client_actions') return;
    final Map<String, dynamic> data;
    try {
      data = jsonDecode(utf8.decode(event.data)) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    if (data['type'] != 'client_action') return;

    final action = data['action'] as String?;
    final payload = (data['payload'] as Map<String, dynamic>?) ?? {};

    switch (action) {
      case 'send_transcript':
        transcript.add(TranscriptEntry(
          role: payload['role'] as String? ?? 'agent',
          text: payload['text'] as String? ?? '',
          timestamp: payload['timestamp'] as int? ?? DateTime.now().millisecondsSinceEpoch,
        ));
        _safeNotify();
        break;
      case 'itinerary_updated':
        itinerary = Itinerary.fromJson(payload);
        _safeNotify();
        break;
      case 'booking_confirmed':
        itinerary = Itinerary(
          flight: itinerary.flight,
          hotel: itinerary.hotel,
          car: itinerary.car,
          bookingStatus: 'confirmed',
          confirmationId: payload['confirmation_id'] as String?,
        );
        _safeNotify();
        break;
      default:
        // heartbeat and other built-in actions are handled by the platform; nothing to do here.
        break;
    }
  }
}
