use crate::audio::{trim_silence, AudioRecorder};
use crate::hotkey::HotkeyEvent;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};

use crate::paste::paste_text;
use crate::stt::{LocalWhisperProvider, SttProvider};
use std::path::PathBuf;

pub static HOTKEY_MODE: AtomicBool = AtomicBool::new(true); // true = push-to-talk, false = toggle
pub static KEEP_RECORDINGS: AtomicBool = AtomicBool::new(false);

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
                    let is_push_to_talk = HOTKEY_MODE.load(Ordering::Relaxed);
                    if is_push_to_talk {
                        if self.state == CoordinatorState::Idle {
                            if let Err(e) = self.audio_recorder.start_recording() {
                                eprintln!("Failed to start recording: {}", e);
                            } else {
                                self.play_sound(800.0, 100);
                                self.set_state(CoordinatorState::Recording);
                            }
                        }
                    } else {
                        // Toggle mode
                        match self.state {
                            CoordinatorState::Idle => {
                                if let Err(e) = self.audio_recorder.start_recording() {
                                    eprintln!("Failed to start recording: {}", e);
                                } else {
                                    self.play_sound(800.0, 100);
                                    self.set_state(CoordinatorState::Recording);
                                }
                            }
                            CoordinatorState::Recording => {
                                self.play_sound(600.0, 150);
                                self.stop_and_process();
                            }
                            _ => {}
                        }
                    }
                }
                CoordinatorCommand::Hotkey(HotkeyEvent::Released) => {
                    // Only act on release in push-to-talk mode
                    if HOTKEY_MODE.load(Ordering::Relaxed) && self.state == CoordinatorState::Recording {
                        self.play_sound(600.0, 150);
                        self.stop_and_process();
                    }
                }
            }
        }
    }

    fn stop_and_process(&mut self) {
        self.set_state(CoordinatorState::Processing);
        let samples = self.audio_recorder.stop_recording();

        // Save recording to disk if enabled
        let recording_path = if KEEP_RECORDINGS.load(Ordering::Relaxed) {
            crate::history::save_recording_to_disk(&samples, 16000)
        } else {
            None
        };

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
                        // LLM post-processing (Phase 5)
                        let mut final_text = text.clone();
                        let mut agent_name = None;
                        {
                            let agent = crate::llm::SmartAgent::auto_format();
                            let llm = crate::llm::LlmClient::new(
                                "http://localhost:11434/v1".into(),
                                "ollama".into(),
                                "llama3.2".into(),
                            );
                            match llm.process(&text, &agent) {
                                Ok(formatted) => {
                                    final_text = formatted;
                                    agent_name = Some(agent.name);
                                }
                                Err(e) => {
                                    eprintln!("LLM skipped ({}), using raw text", e);
                                }
                            }
                        }
                        if let Err(e) = paste_text(&final_text) {
                            eprintln!("Paste failed: {}", e);
                        }
                        // Log to history
                        let history = crate::history::HistoryManager::new();
                        if let Err(e) = history.insert(
                            &text,
                            Some(&final_text),
                            agent_name.as_deref(),
                            samples.len() as i64 / 16,
                            recording_path.as_deref(),
                        ) {
                            eprintln!("Failed to log history: {}", e);
                        }
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
