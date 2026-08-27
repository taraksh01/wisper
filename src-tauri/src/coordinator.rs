use crate::audio::{suppress_noise, trim_silence, AudioRecorder};
use crate::hotkey::HotkeyEvent;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::engine::{create_local_engine, CloudEngineProvider, EngineProvider};
use crate::paste::paste_text;

const START_WAV: &[u8] = include_bytes!("../../public/sounds/start.wav");
const DONE_WAV: &[u8] = include_bytes!("../../public/sounds/done.wav");
const CANCEL_WAV: &[u8] = include_bytes!("../../public/sounds/cancel.wav");
const ERROR_WAV: &[u8] = include_bytes!("../../public/sounds/error.wav");

fn play_wav(data: &'static [u8]) {
    // Write to /tmp once and play via aplay (ALSA) — lightweight, no extra
    // Rust audio deps (rodio conflicts with cpal 0.18). Falls back silently.
    let path = if std::ptr::eq(data.as_ptr(), START_WAV.as_ptr()) {
        "/tmp/wisper_start.wav"
    } else if std::ptr::eq(data.as_ptr(), DONE_WAV.as_ptr()) {
        "/tmp/wisper_done.wav"
    } else if std::ptr::eq(data.as_ptr(), CANCEL_WAV.as_ptr()) {
        "/tmp/wisper_cancel.wav"
    } else {
        "/tmp/wisper_error.wav"
    };
    let _ = std::fs::write(path, data);
    std::thread::spawn(move || {
        let path = path.to_string();
        // Try aplay (ALSA), then paplay (Pulse), then ffplay, else silent.
        for prog in &["aplay", "paplay", "pw-play"] {
            let mut cmd = std::process::Command::new(prog);
            if *prog == "aplay" {
                cmd.args(["-q", &path]);
            } else {
                cmd.arg(&path);
            }
            cmd.stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            if let Ok(mut child) = cmd.spawn() {
                let _ = child.wait();
                return;
            }
        }
        // Last resort: ffplay (no window, auto exit)
        let _ = std::process::Command::new("ffplay")
            .args(["-nodisp", "-autoexit", "-loglevel", "quiet", &path])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|mut c| {
                let _ = c.wait();
            });
    });
}
fn play_start_sound() {
    if !SOUND_ENABLED.load(Ordering::Relaxed) || !SOUND_ON_START.load(Ordering::Relaxed) {
        return;
    }
    play_wav(START_WAV);
}
fn play_done_sound() {
    if !SOUND_ENABLED.load(Ordering::Relaxed) || !SOUND_ON_DONE.load(Ordering::Relaxed) {
        return;
    }
    play_wav(DONE_WAV);
}
fn play_cancel_sound() {
    if !SOUND_ENABLED.load(Ordering::Relaxed) || !SOUND_ON_CANCEL.load(Ordering::Relaxed) {
        return;
    }
    play_wav(CANCEL_WAV);
}
fn play_error_sound() {
    if !SOUND_ENABLED.load(Ordering::Relaxed) || !SOUND_ON_ERROR.load(Ordering::Relaxed) {
        return;
    }
    play_wav(ERROR_WAV);
}

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
pub static PASTE_TOOL: Mutex<String> = Mutex::new(String::new());
pub static WORDS_ENABLED: AtomicBool = AtomicBool::new(true);
pub static WORDS_AUTO_SCAN: AtomicBool = AtomicBool::new(true);
pub static SOUND_ENABLED: AtomicBool = AtomicBool::new(true);
pub static SOUND_ON_START: AtomicBool = AtomicBool::new(false);
pub static SOUND_ON_DONE: AtomicBool = AtomicBool::new(false);
pub static SOUND_ON_CANCEL: AtomicBool = AtomicBool::new(true);
pub static SOUND_ON_ERROR: AtomicBool = AtomicBool::new(true);
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
    Error,
}

pub enum CoordinatorCommand {
    Hotkey(HotkeyEvent),
    Cancel,
}

static CANCEL_SENDER: once_cell::sync::Lazy<Mutex<Option<Sender<CoordinatorCommand>>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

type CancelToken = Arc<std::sync::atomic::AtomicBool>;

static ACTIVE_JOBS: once_cell::sync::Lazy<Mutex<Vec<CancelToken>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(Vec::new()));

fn cancel_active_jobs() -> usize {
    let jobs = ACTIVE_JOBS.lock().unwrap_or_else(|e| e.into_inner());
    let n = jobs.len();
    for t in jobs.iter() {
        t.store(true, Ordering::Relaxed);
    }
    n
}

pub fn active_job_count() -> usize {
    ACTIVE_JOBS.lock().unwrap_or_else(|e| e.into_inner()).len()
}

static SEQ_NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static SEQ_TURN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static SEQ_CV: once_cell::sync::Lazy<(Mutex<()>, std::sync::Condvar)> =
    once_cell::sync::Lazy::new(|| (Mutex::new(()), std::sync::Condvar::new()));

fn finish_pipeline(my_seq: u64, cancel: &CancelToken) {
    ACTIVE_JOBS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|t| !Arc::ptr_eq(t, cancel));
    let state_lock = crate::tray::STATE_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let recording_now = *state_lock == CoordinatorState::Recording;
    let error_now = *state_lock == CoordinatorState::Error;
    drop(state_lock);
    if !recording_now && active_job_count() == 0 && !error_now {
        crate::hide_overlay();
    }
    {
        let (lock, cvar) = &*SEQ_CV;
        let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        while SEQ_TURN.load(Ordering::Relaxed) != my_seq {
            guard = cvar
                .wait_timeout(guard, std::time::Duration::from_millis(10))
                .unwrap()
                .0;
        }
        SEQ_TURN.store(my_seq + 1, Ordering::Relaxed);
        cvar.notify_all();
    }
}

pub fn set_cancel_sender(tx: Sender<CoordinatorCommand>) {
    *CANCEL_SENDER.lock().unwrap_or_else(|e| e.into_inner()) = Some(tx);
}

pub fn cancel_all() {
    let n = cancel_active_jobs();
    crate::hide_overlay();
    eprintln!("[cancel] cancel_all: {n} background pipeline(s) flagged, overlay hidden");
    if n > 0 {
        play_cancel_sound();
    }
    if let Some(tx) = CANCEL_SENDER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        let _ = tx.send(CoordinatorCommand::Cancel);
    }
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

    fn play_sound(&self, freq: f32, _duration_ms: u64) {
        if freq >= 700.0 {
            play_start_sound();
        } else {
            play_done_sound();
        }
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
                        self.stop_and_process();
                    }
                }
                CoordinatorCommand::Cancel => {
                    if self.state == CoordinatorState::Recording {
                        eprintln!("[cancel] discarding active recording");
                        let _ = self.audio_recorder.stop_recording();
                        self.set_state(CoordinatorState::Idle);
                        play_cancel_sound();
                    }
                }
            }
        }
    }

    fn stop_and_process(&mut self) {
        let samples = self.audio_recorder.stop_recording();
        let device_sr = self.audio_recorder.sample_rate();

        let cancel: CancelToken = Arc::new(std::sync::atomic::AtomicBool::new(false));
        ACTIVE_JOBS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(cancel.clone());

        self.set_state(CoordinatorState::Idle);

        let cancel_for_thread = cancel.clone();
        let my_seq = SEQ_NEXT.fetch_add(1, Ordering::Relaxed);
        if let Err(e) = thread::Builder::new()
            .name("wisper-pipeline".into())
            .spawn(move || run_pipeline(samples, device_sr, cancel_for_thread, my_seq))
        {
            eprintln!("Failed to spawn pipeline thread: {}", e);
            ACTIVE_JOBS
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .retain(|t| !Arc::ptr_eq(t, &cancel));
        }
    }
}

fn run_pipeline(samples: Vec<f32>, device_sr: u32, cancel: CancelToken, my_seq: u64) {
    let cancelled = || cancel.load(Ordering::Relaxed);

    if cancelled() {
        finish_pipeline(my_seq, &cancel);
        return;
    }

    // Save recording to disk if enabled (at original sample rate for playback)
    let recording_path = if KEEP_RECORDINGS.load(Ordering::Relaxed) {
        crate::history::save_recording_to_disk(&samples, device_sr)
    } else {
        None
    };

    // Resample -> denoise -> VAD in a scoped block so intermediate buffers
    // are freed before we wait for the paste turn (saves ~6 MB while queued).
    let (trimmed, samples_len) = {
        let samples_len = samples.len();
        let resampled = if device_sr != 16000 {
            let r = crate::engine::resample(&samples, device_sr, 16000);
            drop(samples);
            r
        } else {
            samples
        };
        let denoised = if NOISE_SUPPRESSION_ENABLED.load(Ordering::Relaxed) {
            let lvl = f32::from_bits(NOISE_SUPPRESSION_LEVEL.load(Ordering::Relaxed));
            let d = suppress_noise(&resampled, 16000, lvl);
            drop(resampled);
            d
        } else {
            resampled
        };
        let trimmed = if VAD_ENABLED.load(Ordering::Relaxed) {
            let thresh = f32::from_bits(VAD_THRESHOLD.load(Ordering::Relaxed));
            let t = trim_silence(&denoised, 1600, thresh);
            drop(denoised);
            t
        } else {
            denoised
        };
        (trimmed, samples_len)
    };

    if !trimmed.is_empty() {
        if cancelled() {
            eprintln!("[cancel] pipeline cancelled before transcription");
            finish_pipeline(my_seq, &cancel);
            return;
        }
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
                    crate::show_overlay_error(Some(format!(
                        "Model file not found: {}",
                        path.display()
                    )));
                    play_error_sound();
                    finish_pipeline(my_seq, &cancel);
                    return;
                }
                None => {
                    eprintln!(
                        "No model selected. Go to Engine tab and activate a downloaded model."
                    );
                    crate::show_overlay_error(Some(
                        "No model selected. Open the Engine tab to activate one.".into(),
                    ));
                    play_error_sound();
                    finish_pipeline(my_seq, &cancel);
                    return;
                }
            }
        };

        match result {
            Ok(text) => {
                if cancelled() {
                    eprintln!("[cancel] pipeline cancelled after transcription — discarding text");
                    finish_pipeline(my_seq, &cancel);
                    return;
                }
                println!("Transcription: {}", text);
                let mut final_text = text.clone();
                let mut agent_name = None;
                let settings_snapshot = crate::settings::AppSettings::load();
                let words_enabled = settings_snapshot.words_enabled;
                // Skip AI entirely for very short utterances — just words+paste.
                let min_words = settings_snapshot.process_min_words;
                let do_ai = if settings_snapshot.process_enabled {
                    if min_words == 0 {
                        true
                    } else {
                        let wc = text.split_whitespace().count() as u32;
                        if wc < min_words {
                            eprintln!(
                                "[process] skipping AI ({} words < min {}), using raw text",
                                wc, min_words
                            );
                            false
                        } else {
                            true
                        }
                    }
                } else {
                    false
                };
                if do_ai {
                    let process_base_url = settings_snapshot.process_base_url.clone();
                    let process_api_key = settings_snapshot.process_api_key.clone();
                    let process_model = settings_snapshot.process_model.clone();
                    let process_max_tokens = settings_snapshot.process_max_tokens;
                    let process_endpoint = settings_snapshot.process_endpoint.clone();
                    let mut agent = crate::process::SmartAgent::resolve(
                        &settings_snapshot.process_agent_profile,
                        &settings_snapshot.process_agent_prompt,
                        &text,
                    );
                    if words_enabled {
                        let hint = crate::words::words_prompt_hint(&text);
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
                    let timeout_secs = settings_snapshot.process_timeout_secs.clamp(3, 120) as u64;
                    let ai_timeout = std::time::Duration::from_secs(timeout_secs);
                    let agent_name_snapshot = agent.name.clone();
                    if cancelled() {
                        eprintln!("[cancel] pipeline cancelled before AI phase");
                        finish_pipeline(my_seq, &cancel);
                        return;
                    }
                    // Cancellable AI request: dropping the reqwest future closes the
                    // TCP connection so the remote model stops and the user is not billed.
                    let cancel_for_ai = cancel.clone();
                    let text_for_ai = text.clone();
                    let agent_for_ai = agent.clone();
                    let result = match tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                    {
                        Ok(rt) => rt.block_on(client.process_with_cancel(
                            &text_for_ai,
                            &agent_for_ai,
                            ai_timeout,
                            cancel_for_ai,
                        )),
                        Err(e) => {
                            eprintln!("[process] failed to create runtime: {} — using raw text", e);
                            Err(format!("runtime error: {}", e))
                        }
                    };
                    match result {
                        Ok(formatted) => {
                            if cancelled() {
                                eprintln!(
                                    "[cancel] AI result discarded (cancelled during processing)"
                                );
                                finish_pipeline(my_seq, &cancel);
                                return;
                            }
                            final_text = formatted;
                            agent_name = Some(agent_name_snapshot);
                        }
                        Err(e) if e == "Cancelled" => {
                            eprintln!("[cancel] AI request cancelled, discarding pipeline");
                            finish_pipeline(my_seq, &cancel);
                            return;
                        }
                        Err(e) => {
                            eprintln!("AI processing skipped ({}), using raw text", e);
                        }
                    }
                }
                // Deterministic words correction as a final guarantee,
                // whether or not the AI processing ran.
                if cancelled() {
                    eprintln!("[cancel] pipeline cancelled before words/paste — discarding");
                    finish_pipeline(my_seq, &cancel);
                    return;
                }
                if words_enabled {
                    final_text = crate::words::apply_words(&final_text);
                }
                let paste_method = PASTE_METHOD
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                {
                    let (lock, cvar) = &*SEQ_CV;
                    let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
                    while SEQ_TURN.load(Ordering::Relaxed) != my_seq {
                        if cancelled() {
                            drop(guard);
                            eprintln!(
                                "[cancel] pipeline cancelled while waiting for paste turn {my_seq}"
                            );
                            finish_pipeline(my_seq, &cancel);
                            return;
                        }
                        let (g, _) = cvar
                            .wait_timeout(guard, std::time::Duration::from_millis(25))
                            .unwrap();
                        guard = g;
                    }
                }
                if cfg!(debug_assertions) {
                    eprintln!(
                        "[paste] seq {my_seq} turn acquired, method={} text_len={}",
                        paste_method,
                        final_text.len()
                    );
                }
                // Drop overlay focus so synthetic keystrokes land in the
                // target app, not the (invisible) overlay window.
                let recording_now = *crate::tray::STATE_LOCK
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    == CoordinatorState::Recording;
                if !recording_now {
                    crate::hide_overlay();
                    // Condition-based wait: poll until overlay reports hidden
                    // (hide is async via run_on_main_thread). Up to 200ms max,
                    // faster than fixed 80ms when compositor is quick.
                    for _ in 0..20 {
                        if !crate::is_overlay_visible() {
                            break;
                        }
                        thread::sleep(std::time::Duration::from_millis(10));
                    }
                }
                if let Err(e) = paste_text(&final_text, &paste_method) {
                    eprintln!("Paste failed: {}", e);
                }
                let duration_ms = if device_sr > 0 {
                    (samples_len as i64 * 1000) / device_sr as i64
                } else {
                    0
                };
                // Skip zero-word entries — they just pollute history (user request).
                let raw_words = text.split_whitespace().count();
                let final_words = final_text.split_whitespace().count();
                if raw_words == 0 && final_words == 0 {
                    eprintln!("[history] skipping zero-word entry");
                    if let Some(ref p) = recording_path {
                        let _ = std::fs::remove_file(p);
                    }
                } else {
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
                    let words = raw_words as f64;
                    let typing_sec = words / 1.0; // ~60 WPM
                    let speak_sec = duration_ms as f64 / 1000.0;
                    let saved = (typing_sec - speak_sec).max(0.0) as i64;
                    if saved > 0 {
                        crate::settings::add_time_saved(saved);
                    }
                }
            }
            Err(e) => {
                eprintln!("Transcription error: {}", e);
                crate::show_overlay_error(Some(format!("Transcription failed: {}", e)));
                play_error_sound();
            }
        }
    } else {
        eprintln!("No speech detected (VAD trimmed all audio)");
        crate::show_overlay_error(Some(
            "No speech detected — try speaking closer to the mic.".into(),
        ));
        play_error_sound();
    }

    finish_pipeline(my_seq, &cancel);
    play_done_sound();
}

impl TranscriptionCoordinator {
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

        let coordinator = TranscriptionCoordinator::new(recorder, cmd_rx, None);

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
