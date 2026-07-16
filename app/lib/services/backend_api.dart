import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../config.dart';

class VoiceTokenResponse {
  final String livekitUrl;
  final String token;
  final String roomName;

  VoiceTokenResponse({required this.livekitUrl, required this.token, required this.roomName});

  factory VoiceTokenResponse.fromJson(Map<String, dynamic> json) {
    return VoiceTokenResponse(
      livekitUrl: json['livekit_url'] as String,
      token: json['token'] as String,
      roomName: json['room_name'] as String,
    );
  }
}

class BackendApi {
  /// Calls our backend, which proxies Vocal Bridge's POST /api/v1/token with the API key
  /// kept server-side (never call vocalbridgeai.com directly from the app).
  Future<VoiceTokenResponse> fetchVoiceToken({String participantName = 'Nonstop User'}) async {
    final res = await http.post(
      Uri.parse('$backendBaseUrl/api/voice-token'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'participant_name': participantName}),
    );
    if (res.statusCode != 200) {
      throw Exception('Failed to fetch voice token: ${res.statusCode} ${res.body}');
    }
    return VoiceTokenResponse.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }

  /// Uploads a photographed document and returns a URL the agent (via extract_travel_document)
  /// and LandingAI ADE can fetch.
  Future<String> uploadDocument(File file) async {
    final request = http.MultipartRequest('POST', Uri.parse('$backendBaseUrl/uploads'));
    request.files.add(await http.MultipartFile.fromPath('file', file.path));
    final streamed = await request.send();
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode != 200) {
      throw Exception('Upload failed: ${res.statusCode} ${res.body}');
    }
    return (jsonDecode(res.body) as Map<String, dynamic>)['url'] as String;
  }
}
