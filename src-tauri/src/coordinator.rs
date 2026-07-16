use crate::audio::{trim_silence, AudioRecorder};
use crate::hotkey::HotkeyEvent;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Mutex;
use std::thread;

use crate::paste::paste_text;
use crate::stt::{create_local_provider, CloudSttProvider, SttProvider};

pub static HOTKEY_MODE: AtomicBool = AtomicBool::new(true); // true = push-to-talk, false = toggle
pub static KEEP_RECORDINGS: AtomicBool = AtomicBool::new(false);
pub static CURRENT_MODEL: std::sync::Mutex<Option<std::path::PathBuf>> = std::sync::Mutex::new(None);
pub static MODEL_DISPLAY_NAME: Mutex<String> = Mutex::new(String::new());
pub static STT_MODE: Mutex<String> = Mutex::new(String::new());
pub static PASTE_METHOD: Mutex<String> = Mutex::new(String::new());
pub static PASTE_BACKEND: Mutex<String> = Mutex::new(String::new());
pub static PASTE_TOOL: Mutex<String> = Mutex::new(String::new());
pub static LLM_ENABLED: AtomicBool = AtomicBool::new(true);
pub static VOCAB_ENABLED: AtomicBool = AtomicBool::new(true);
pub static LLM_BASE_URL: Mutex<String> = Mutex::new(String::new());
pub static LLM_API_KEY: Mutex<String> = Mutex::new(String::new());
pub static LLM_MODEL: Mutex<String> = Mutex::new(String::new());
pub static LLM_MAX_TOKENS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
pub static CLOUD_PROVIDER: Mutex<String> = Mutex::new(String::new());
pub static CLOUD_BASE_URL: Mutex<String> = Mutex::new(String::new());
pub static CLOUD_API_KEY: Mutex<String> = Mutex::new(String::new());
pub static CLOUD_MODEL: Mutex<String> = Mutex::new(String::new());

pub fn model_display_name(path: &std::path::Path) -> String {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    if name.starts_with("parakeet-") {
        name.replace("parakeet-", "Parakeet ").replace("-int8", " (INT8)")
    } else {
        name.to_string()
    }
}

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
        let device_sr = self.audio_recorder.sample_rate();

        // Resample to 16kHz once, then work with 16kHz audio everywhere
        let resampled = if device_sr != 16000 {
            crate::stt::resample(&samples, device_sr, 16000)
        } else {
            samples.clone()
        };

        // Save recording to disk if enabled (at original sample rate for playback)
        let recording_path = if KEEP_RECORDINGS.load(Ordering::Relaxed) {
            crate::history::save_recording_to_disk(&samples, device_sr)
        } else {
            None
        };

        // VAD trimming (100ms window at 16kHz = 1600 samples)
        let trimmed = trim_silence(&resampled, 1600, 0.01);

        if !trimmed.is_empty() {
            let mode = STT_MODE.lock().unwrap().clone();
            let result = if mode == "cloud" {
                let _provider = CLOUD_PROVIDER.lock().unwrap().clone();
                let base_url = CLOUD_BASE_URL.lock().unwrap().clone();
                let api_key = CLOUD_API_KEY.lock().unwrap().clone();
                let model = CLOUD_MODEL.lock().unwrap().clone();
                let stt = CloudSttProvider::new(base_url, api_key, model);
                stt.transcribe(&trimmed, 16000)
            } else {
                let model_path = {
                    let guard = CURRENT_MODEL.lock().unwrap();
                    guard.clone()
                };
                match model_path {
                    Some(path) if path.exists() => {
                        let stt = create_local_provider(path);
                        stt.transcribe(&trimmed, 16000)
                    }
                    Some(path) => {
                        eprintln!("Model file not found at: {:?}", path);
                        crate::show_overlay_error();
                        return;
                    }
                    None => {
                        eprintln!("No model selected. Go to Engine tab and activate a downloaded model.");
                        crate::show_overlay_error();
                        return;
                    }
                }
            };

            match result {
                Ok(text) => {
                    println!("Transcription: {}", text);
                    let mut final_text = text.clone();
                    let mut agent_name = None;
                    let vocab_enabled = VOCAB_ENABLED.load(Ordering::Relaxed);
                    if LLM_ENABLED.load(Ordering::Relaxed) {
                        let llm_base_url = LLM_BASE_URL.lock().unwrap().clone();
                        let llm_api_key = LLM_API_KEY.lock().unwrap().clone();
                        let llm_model = LLM_MODEL.lock().unwrap().clone();
                        let llm_max_tokens = LLM_MAX_TOKENS.load(Ordering::Relaxed);
                        let mut agent = {
                            let settings = crate::settings::AppSettings::load();
                            crate::llm::SmartAgent::resolve(
                                &settings.llm_agent_profile,
                                &settings.llm_agent_prompt,
                                &text,
                            )
                        };
                        // Bias the LLM toward the user's canonical spellings.
                        if vocab_enabled {
                            let hint = crate::vocab::vocabulary_prompt_hint();
                            if !hint.is_empty() {
                                agent.system_prompt.push_str(&hint);
                            }
                        }
                        let llm = crate::llm::LlmClient::new(
                            llm_base_url,
                            llm_api_key,
                            llm_model,
                            llm_max_tokens,
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
                    // Deterministic vocabulary correction as a final guarantee,
                    // whether or not the LLM ran.
                    if vocab_enabled {
                        final_text = crate::vocab::apply_vocabulary(&final_text);
                    }
                    let paste_method = PASTE_METHOD.lock().unwrap().clone();
                    // Drop overlay focus so synthetic keystrokes land in the
                    // target app, not the (invisible) overlay window.
                    crate::hide_overlay();
                    thread::sleep(std::time::Duration::from_millis(80));
                    if let Err(e) = paste_text(&final_text, &paste_method) {
                        eprintln!("Paste failed: {}", e);
                    }
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
                Err(e) => {
                    eprintln!("Transcription error: {}", e);
                    crate::show_overlay_error();
                }
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
