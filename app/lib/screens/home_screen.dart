import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../services/voice_agent_service.dart';
import '../widgets/itinerary_card.dart';
import '../widgets/transcript_view.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final VoiceAgentService _agent = VoiceAgentService();
  final ImagePicker _picker = ImagePicker();
  bool _uploadingDocument = false;

  @override
  void dispose() {
    _agent.disconnect();
    _agent.dispose();
    super.dispose();
  }

  Future<void> _captureDocument() async {
    final photo = await _picker.pickImage(source: ImageSource.camera);
    if (photo == null) return;
    setState(() => _uploadingDocument = true);
    try {
      await _agent.notifyDocumentUploaded(photo.path);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Upload failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _uploadingDocument = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Nonstop')),
      body: AnimatedBuilder(
        animation: _agent,
        builder: (context, _) {
          return SafeArea(
            child: Column(
              children: [
                if (_agent.lastError != null)
                  Container(
                    width: double.infinity,
                    color: Colors.red.shade100,
                    padding: const EdgeInsets.all(8),
                    child: Text(_agent.lastError!, style: const TextStyle(color: Colors.red)),
                  ),
                ItineraryCard(itinerary: _agent.itinerary),
                Expanded(child: TranscriptView(entries: _agent.transcript)),
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      IconButton.filledTonal(
                        onPressed: _uploadingDocument ? null : _captureDocument,
                        icon: _uploadingDocument
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.camera_alt),
                        tooltip: 'Photograph a travel document',
                      ),
                      FilledButton.icon(
                        onPressed: _agent.isConnecting
                            ? null
                            : (_agent.isConnected ? _agent.disconnect : _agent.connect),
                        icon: Icon(_agent.isConnected ? Icons.call_end : Icons.mic),
                        label: Text(
                          _agent.isConnecting
                              ? 'Connecting…'
                              : (_agent.isConnected ? 'End Call' : 'Start Voice Chat'),
                        ),
                      ),
                      IconButton.filledTonal(
                        onPressed: _agent.isConnected ? _agent.toggleMicrophone : null,
                        icon: Icon(_agent.isMicrophoneEnabled ? Icons.mic : Icons.mic_off),
                        tooltip: 'Mute / unmute',
                      ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
