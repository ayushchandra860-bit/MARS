import { exec } from 'child_process';

export class VoiceAssistant {
  private static instance: VoiceAssistant;
  private enabled: boolean = true;
  private lastAnnouncements: Map<string, number> = new Map();

  private constructor() {}

  public static getInstance(): VoiceAssistant {
    if (!VoiceAssistant.instance) {
      VoiceAssistant.instance = new VoiceAssistant();
    }
    return VoiceAssistant.instance;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public getIsEnabled(): boolean {
    return this.enabled;
  }

  public announceSignal(asset: string, action: string, expiry: string, confidence: number): void {
    if (!this.enabled) return;

    const now = Date.now();
    const key = `${asset}_${action}`;
    const lastTime = this.lastAnnouncements.get(key) || 0;

    // Debounce announcements (minimum 5 seconds)
    if (now - lastTime < 5000) {
      return;
    }
    
    this.lastAnnouncements.set(key, now);

    const message = `${asset} ${action} ${expiry} confirmed. Confidence ${confidence} percent.`;
    const safeMessage = message.replace(/'/g, "''").replace(/["$`]/g, '');
    
    // Use Windows SAPI via PowerShell command with sanitized input
    const psCommand = `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${safeMessage}')`;
    
    exec(`powershell -Command "${psCommand}"`, (error) => {
        if (error) {
            console.error('VoiceAssistant synthesis error:', error);
        }
    });
  }
}
