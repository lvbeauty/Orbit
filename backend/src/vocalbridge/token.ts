import axios from "axios";
import { config } from "../config.js";

export interface VoiceToken {
  livekit_url: string;
  token: string;
  room_name: string;
  participant_identity: string;
  expires_in: number;
  agent_mode: string;
}

/** Mints a short-lived LiveKit token for the Flutter client — never expose VOCAL_BRIDGE_API_KEY client-side. */
export async function mintVoiceToken(participantName: string): Promise<VoiceToken> {
  const headers: Record<string, string> = {
    "X-API-Key": config.vocalBridge.apiKey,
    "Content-Type": "application/json",
  };
  if (config.vocalBridge.agentId) {
    headers["X-Agent-Id"] = config.vocalBridge.agentId;
  }

  const res = await axios.post<VoiceToken>(
    `${config.vocalBridge.apiUrl}/api/v1/token`,
    { participant_name: participantName },
    { headers, timeout: 15_000 },
  );

  return res.data;
}
