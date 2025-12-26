export {};

declare global {
  interface Window {
    electronAPI: {
      onStartRecording: (callback: () => void) => void;
      onStopRecording: (callback: () => void) => void;
      setRecordingState: (state: boolean) => void;
      getRecordingState: () => Promise<boolean>;
      copyToClipboard: (text: string) => Promise<boolean>;
      pasteText: (text: string) => Promise<boolean>;
      hideWindow: () => Promise<boolean>;
      resizeWindow: (width: number, height: number) => void;
      onOpenSettings: (callback: () => void) => void;
      removeAllListeners: (channel: string) => void;
      // Hotkey management
      getHotkey: () => Promise<string>;
      setHotkey: (
        hotkey: string
      ) => Promise<{ success: boolean; hotkey: string }>;
    };
  }
}
