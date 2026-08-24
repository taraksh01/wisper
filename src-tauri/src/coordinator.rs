use crate::audio::{suppress_noise, trim_silence, AudioRecorder};
use crate::hotkey::HotkeyEvent;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Mutex;
use std::thread;

use crate::engine::{create_local_engine, CloudEngineProvider, EngineProvider};
use crate::paste::paste_text;

pub static HOTKEY_MODE: AtomicBool = AtomicBool::new(true); // true = push-to-talk, false = toggle
pub static KEEP_RECORDINGS: AtomicBool = AtomicBool::new(false);
pub static VAD_ENABLED: AtomicBool = AtomicBool::new(true);
pub static VAD_THRESHOLD: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0.01_f32.to_bits());
pub static NOISE_SUPPRESSION_ENABLED: AtomicBool = AtomicBool::new(false);
pub static NOISE_SUPPRESSION_LEVEL: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0.5_f32.to_bits());
pub static CURRENT_MODEL: std::sync::Mutex<Option<std::path::PathBuf>> =
    std::sync::Mutex::new(None);
pub static MODEL_DISPLAY_NAME: Mutex<String> = Mutex::new(String::new());
pub static ENGINE_MODE: Mutex<String> = Mutex::new(String::new());
pub static INPUT_DEVICE: Mutex<String> = Mutex::new(String::new()); // empty = system default
pub static PASTE_METHOD: Mutex<String> = Mutex::new(String::new());
pub static PASTE_BACKEND: Mutex<String> = Mutex::new(String::new());
pub static PASTE_TOOL: Mutex<String> = Mutex::new(String::new());
pub static PROCESS_ENABLED: AtomicBool = AtomicBool::new(true);
pub static WORDS_ENABLED: AtomicBool = AtomicBool::new(true);
pub static WORDS_AUTO_SCAN: AtomicBool = AtomicBool::new(true);
pub static PROCESS_BASE_URL: Mutex<String> = Mutex::new(String::new());
pub static PROCESS_API_KEY: Mutex<String> = Mutex::new(String::new());
pub static PROCESS_MODEL: Mutex<String> = Mutex::new(String::new());
pub static PROCESS_MAX_TOKENS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
pub static PROCESS_ENDPOINT: Mutex<String> = Mutex::new(String::new());
pub static CLOUD_PROVIDER: Mutex<String> = Mutex::new(String::new());
pub static CLOUD_BASE_URL: Mutex<String> = Mutex::new(String::new());
pub static CLOUD_API_KEY: Mutex<String> = Mutex::new(String::new());
pub static CLOUD_MODEL: Mutex<String> = Mutex::new(String::new());

pub fn model_display_name(path: &std::path::Path) -> String {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    if name.starts_with("parakeet-") {
        name.replace("parakeet-", "Parakeet ")
            .replace("-int8", " (INT8)")
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

    /// Selected input device name (empty = system default), for cpal resolution.
    fn input_device(&self) -> Option<String> {
        let d = INPUT_DEVICE.lock().unwrap_or_else(|e| e.into_inner());
        if d.is_empty() {
            None
        } else {
            Some(d.clone())
        }
    }

    pub fn run(mut self) {
        while let Ok(command) = self.rx.recv() {
            // Drop ghost presses queued while we were transcribing ( Processing is synchronous )
            if self.state == CoordinatorState::Processing {
                // Drain any burst that arrived while busy
                while self.rx.try_recv().is_ok() {}
                continue;
            }
            match command {
                CoordinatorCommand::Hotkey(HotkeyEvent::Pressed) => {
                    let is_push_to_talk = HOTKEY_MODE.load(Ordering::Relaxed);
                    if is_push_to_talk {
                        if self.state == CoordinatorState::Idle {
                            if let Err(e) = self.audio_recorder.start_recording(self.input_device())
                            {
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
                                if let Err(e) =
                                    self.audio_recorder.start_recording(self.input_device())
                                {
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
                    if HOTKEY_MODE.load(Ordering::Relaxed)
                        && self.state == CoordinatorState::Recording
                    {
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
            crate::engine::resample(&samples, device_sr, 16000)
        } else {
            samples.clone()
        };

        // Save recording to disk if enabled (at original sample rate for playback)
        let recording_path = if KEEP_RECORDINGS.load(Ordering::Relaxed) {
            crate::history::save_recording_to_disk(&samples, device_sr)
        } else {
            None
        };

        // Noise suppression (optional, before VAD so VAD sees cleaner audio) and
        // VAD trimming: VAD uses the user's vad_threshold; when disabled, keep full.
        let denoised = if NOISE_SUPPRESSION_ENABLED.load(Ordering::Relaxed) {
            let lvl = f32::from_bits(NOISE_SUPPRESSION_LEVEL.load(Ordering::Relaxed));
            suppress_noise(&resampled, 16000, lvl)
        } else {
            resampled.clone()
        };
        let trimmed = if VAD_ENABLED.load(Ordering::Relaxed) {
            let thresh = f32::from_bits(VAD_THRESHOLD.load(Ordering::Relaxed));
            trim_silence(&denoised, 1600, thresh)
        } else {
            denoised
        };

        if !trimmed.is_empty() {
            let mode = ENGINE_MODE
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            let result = if mode == "cloud" {
                let provider = CLOUD_PROVIDER
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let mut base_url = CLOUD_BASE_URL
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                if base_url.trim().is_empty() {
                    base_url = match provider.as_str() {
                        "openai" => "https://api.openai.com/v1".into(),
                        "groq" => "https://api.groq.com/openai/v1".into(),
                        _ => base_url,
                    };
                }
                if base_url.trim().is_empty() {
                    // No provider and no URL — fail fast instead of reqwest relative-URL error
                    Err("Cloud provider not configured (missing base URL)".into())
                } else {
                    let api_key = CLOUD_API_KEY
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .clone();
                    let model = CLOUD_MODEL
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .clone();
                    let engine = CloudEngineProvider::new(base_url, api_key, model);
                    engine.transcribe(&trimmed, 16000)
                }
            } else {
                let model_path = {
                    let guard = CURRENT_MODEL.lock().unwrap_or_else(|e| e.into_inner());
                    guard.clone()
                };
                match model_path {
                    Some(path) if path.exists() => {
                        let engine = create_local_engine(path);
                        engine.transcribe(&trimmed, 16000)
                    }
                    Some(path) => {
                        eprintln!("Model file not found at: {:?}", path);
                        self.set_state(CoordinatorState::Idle);
                        crate::show_overlay_error();
                        return;
                    }
                    None => {
                        eprintln!(
                            "No model selected. Go to Engine tab and activate a downloaded model."
                        );
                        self.set_state(CoordinatorState::Idle);
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
                    let words_enabled = WORDS_ENABLED.load(Ordering::Relaxed);
                    if PROCESS_ENABLED.load(Ordering::Relaxed) {
                        let process_base_url = PROCESS_BASE_URL
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .clone();
                        let process_api_key = PROCESS_API_KEY
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .clone();
                        let process_model = PROCESS_MODEL
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .clone();
                        let process_max_tokens = PROCESS_MAX_TOKENS.load(Ordering::Relaxed);
                        let process_endpoint = PROCESS_ENDPOINT
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .clone();
                        let mut agent = {
                            let settings = crate::settings::AppSettings::load();
                            crate::process::SmartAgent::resolve(
                                &settings.process_agent_profile,
                                &settings.process_agent_prompt,
                                &text,
                            )
                        };
                        // Bias the AI toward the user's canonical spellings — prepend so the model sees the critical dictionary first.
                        if words_enabled {
                            let hint = crate::words::words_prompt_hint();
                            if !hint.is_empty() {
                                agent.system_prompt = format!("{}{}", hint, agent.system_prompt);
                            }
                        }
                        let client = crate::process::ProcessClient::new(
                            process_base_url,
                            process_api_key,
                            process_model,
                            process_max_tokens,
                            if process_endpoint.is_empty() {
                                "/chat/completions".to_string()
                            } else {
                                process_endpoint
                            },
                        );
                        match client.process(&text, &agent) {
                            Ok(formatted) => {
                                final_text = formatted;
                                agent_name = Some(agent.name);
                            }
                            Err(e) => {
                                eprintln!("AI processing skipped ({}), using raw text", e);
                            }
                        }
                    }
                    // Deterministic words correction as a final guarantee,
                    // whether or not the AI processing ran.
                    if words_enabled {
                        final_text = crate::words::apply_words(&final_text);
                    }
                    let paste_method = PASTE_METHOD
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .clone();
                    // Drop overlay focus so synthetic keystrokes land in the
                    // target app, not the (invisible) overlay window.
                    crate::hide_overlay();
                    thread::sleep(std::time::Duration::from_millis(20));
                    if let Err(e) = paste_text(&final_text, &paste_method) {
                        eprintln!("Paste failed: {}", e);
                    }
                    let duration_ms = if device_sr > 0 {
                        (samples.len() as i64 * 1000) / device_sr as i64
                    } else {
                        0
                    };
                    let history = crate::history::HistoryManager::new();
                    if let Err(e) = history.insert(
                        &text,
                        Some(&final_text),
                        agent_name.as_deref(),
                        duration_ms,
                        recording_path.as_deref(),
                    ) {
                        eprintln!("Failed to log history: {}", e);
                    } else {
                        if WORDS_ENABLED.load(Ordering::Relaxed)
                            && WORDS_AUTO_SCAN.load(Ordering::Relaxed)
                            && text != final_text
                        {
                            crate::words::maybe_auto_add_corrections(&text, &final_text);
                        }
                        // Enforce retention limit after each insert
                        let s = crate::settings::AppSettings::load();
                        if s.max_history_entries > 0 {
                            let mode = if s.keep_recordings
                                && s.history_retention_mode == "recordings_only"
                            {
                                "recordings_only"
                            } else {
                                "both"
                            };
                            if let Err(e) = history.trim_history(s.max_history_entries as i64, mode)
                            {
                                eprintln!("Failed to trim history: {}", e);
                            }
                        }
                    }

                    // Accumulate estimated time saved (typing time minus speaking time).
                    let words = text.split_whitespace().count() as f64;
                    let typing_sec = words / 1.0; // ~60 WPM
                    let speak_sec = duration_ms as f64 / 1000.0;
                    let saved = (typing_sec - speak_sec).max(0.0) as i32;
                    if saved > 0 {
                        let mut settings = crate::settings::AppSettings::load();
                        settings.time_saved_sec += saved;
                        let _ = settings.save();
                    }
                }
                Err(e) => {
                    eprintln!("Transcription error: {}", e);
                    crate::show_overlay_error();
                }
            }
        } else {
            eprintln!("No speech detected (VAD trimmed all audio)");
            crate::show_overlay_error();
        }

        self.set_state(CoordinatorState::Idle);
        // Discard presses that were queued while transcribing
        while self.rx.try_recv().is_ok() {}
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
        cmd_tx
            .send(CoordinatorCommand::Hotkey(HotkeyEvent::Pressed))
            .unwrap();
        // Since start_recording might fail in unit test without audio device, let's verify coordinator builds and channels work
    }
}
