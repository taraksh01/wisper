/// <reference types="vite/client" />

declare global {
  const __APP_VERSION__: string;

  interface Window {
    electronAPI: {
      onStartRecording: (callback: () => void) => void;
      onStopRecording: (callback: () => void) => void;
      setRecordingState: (state: boolean) => void;
      getRecordingState: () => Promise<boolean>;
      copyToClipboard: (text: string) => Promise<boolean>;
      pasteToCursor: (text: string) => Promise<boolean>;
      hideWindow: () => Promise<void>;
      resizeWindow: (width: number, height: number) => void;
      removeAllListeners: (channel: string) => void;
    };
  }
}

export {};
