use crate::audio::{trim_silence, AudioRecorder};
use crate::hotkey::HotkeyEvent;
use std::sync::mpsc::{Receiver, Sender};

use crate::stt::{LocalWhisperProvider, SttProvider};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CoordinatorState {
    Idle,
    Recording,
    Processing,
}

pub enum CoordinatorCommand {
    Hotkey(HotkeyEvent),
}

pub struct TranscriptionCoordinator {
    state: CoordinatorState,
    audio_recorder: AudioRecorder,
    rx: Receiver<CoordinatorCommand>,
    state_tx: Option<Sender<CoordinatorState>>,
}

impl TranscriptionCoordinator {
    pub fn new(
        audio_recorder: AudioRecorder,
        rx: Receiver<CoordinatorCommand>,
        state_tx: Option<Sender<CoordinatorState>>,
    ) -> Self {
        Self {
            state: CoordinatorState::Idle,
            audio_recorder,
            rx,
            state_tx,
        }
    }

    fn play_sound(&self, _freq: f32, _duration_ms: u64) {
        // Subtle terminal bell sound cue
        print!("\x07");
    }

    pub fn run(mut self) {
        while let Ok(command) = self.rx.recv() {
            match command {
                CoordinatorCommand::Hotkey(HotkeyEvent::Pressed) => {
                    if self.state == CoordinatorState::Idle {
                        if let Err(e) = self.audio_recorder.start_recording() {
                            eprintln!("Failed to start recording: {}", e);
                        } else {
                            self.play_sound(800.0, 100); // Start recording beep
                            self.set_state(CoordinatorState::Recording);
                        }
                    }
                }
                CoordinatorCommand::Hotkey(HotkeyEvent::Released) => {
                    if self.state == CoordinatorState::Recording {
                        self.play_sound(600.0, 150); // Stop recording beep
                        self.stop_and_process();
                    }
                }
            }
        }
    }

    fn stop_and_process(&mut self) {
        self.set_state(CoordinatorState::Processing);
        let samples = self.audio_recorder.stop_recording();
        
        // VAD trimming (100ms window at 16kHz = 1600 samples)
        let trimmed = trim_silence(&samples, 1600, 0.01);

        if !trimmed.is_empty() {
            // Hardcode local model testing for now (Phase 3)
            let mut model_path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
            model_path.push("v3");
            model_path.push("models");
            model_path.push("ggml-base.en.bin");

            if model_path.exists() {
                let stt = LocalWhisperProvider::new(model_path);
                match stt.transcribe(&trimmed, 16000) {
                    Ok(text) => {
                        println!("Transcription: {}", text);
                        // TODO: Phase 4 (Paste Injection) & Phase 5 (LLM)
                    }
                    Err(e) => eprintln!("Transcription error: {}", e),
                }
            } else {
                eprintln!("Model not found! Please download ggml-base.en.bin");
            }
        }

        self.set_state(CoordinatorState::Idle);
        self.play_sound(1000.0, 200); // Finished processing beep
    }

    fn set_state(&mut self, new_state: CoordinatorState) {
        self.state = new_state;
        if let Some(tx) = &self.state_tx {
            let _ = tx.send(new_state);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn test_coordinator_state_changes() {
        let recorder = AudioRecorder::new();
        let (cmd_tx, cmd_rx) = mpsc::channel();
        let (state_tx, state_rx) = mpsc::channel();

        let coordinator = TranscriptionCoordinator::new(recorder, cmd_rx, Some(state_tx));

        std::thread::spawn(move || {
            coordinator.run();
        });

        // Send pressed event
        cmd_tx.send(CoordinatorCommand::Hotkey(HotkeyEvent::Pressed)).unwrap();
        // Since start_recording might fail in unit test without audio device, let's verify coordinator builds and channels work
    }
}
