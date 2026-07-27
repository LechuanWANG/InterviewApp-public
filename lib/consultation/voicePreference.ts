const CONSULT_VOICE_ENABLED_PREFIX = "consult-voice-enabled:";

export function readConsultVoiceEnabled(consultId: string): boolean {
  if (typeof window === "undefined") return true;
  return sessionStorage.getItem(consultVoiceEnabledKey(consultId)) !== "0";
}

export function saveConsultVoiceEnabled(consultId: string, enabled: boolean) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(consultVoiceEnabledKey(consultId), enabled ? "1" : "0");
}

function consultVoiceEnabledKey(consultId: string): string {
  return `${CONSULT_VOICE_ENABLED_PREFIX}${consultId}`;
}
