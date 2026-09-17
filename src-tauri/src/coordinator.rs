use crate::audio::{suppress_noise, trim_silence, AudioRecorder};
use crate::hotkey::HotkeyEvent;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::engine::{
    create_local_engine, CloudEngineProvider, EngineProvider, SarvamCloudProvider,
};
use crate::focus::OriginTarget;
use crate::paste::paste_text;

const START_WAV: &[u8] = include_bytes!("../../public/sounds/start.wav");
const DONE_WAV: &[u8] = include_bytes!("../../public/sounds/done.wav");
const CANCEL_WAV: &[u8] = include_bytes!("../../public/sounds/cancel.wav");
const ERROR_WAV: &[u8] = include_bytes!("../../public/sounds/error.wav");

fn play_wav(data: &'static [u8]) {
    let suffix = if std::ptr::eq(data.as_ptr(), START_WAV.as_ptr()) {
        "start"
    } else if std::ptr::eq(data.as_ptr(), DONE_WAV.as_ptr()) {
        "done"
    } else if std::ptr::eq(data.as_ptr(), CANCEL_WAV.as_ptr()) {
        "cancel"
    } else {
        "error"
    };
    let mut tmp = std::env::temp_dir();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    tmp.push(format!(
        "wisper_{}_{}_{}.wav",
        suffix,
        std::process::id(),
        nanos
    ));
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)
        {
            use std::io::Write;
            let _ = f.write_all(data);
            let _ = f.sync_all();
        } else {
            return;
        }
    }
    #[cfg(not(unix))]
    {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
        {
            let _ = f.write_all(data);
        } else {
            return;
        }
    }
    std::thread::spawn(move || {
        let path = tmp.to_string_lossy().to_string();
        let tmp_path = tmp.clone();
        let mut played = false;
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
                played = true;
                break;
            }
        }
        if !played {
            let _ = std::process::Command::new("ffplay")
                .args(["-nodisp", "-autoexit", "-loglevel", "quiet", &path])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map(|mut c| {
                    let _ = c.wait();
                });
        }
        let _ = std::fs::remove_file(&tmp_path);
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
pub static ENGINE_LANGUAGE: Mutex<String> = Mutex::new(String::new());
pub static ENABLED_LANGUAGES: Mutex<Vec<String>> = Mutex::new(Vec::new());
pub static INPUT_DEVICE: Mutex<String> = Mutex::new(String::new()); // empty = system default
pub static PASTE_METHOD: Mutex<String> = Mutex::new(String::new());
pub static PASTE_TOOL: Mutex<String> = Mutex::new(String::new());
pub static PASTE_ADD_TRAILING_SPACE: AtomicBool = AtomicBool::new(true);
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
pub static CLOUD_SARVAM_MODE: Mutex<String> = Mutex::new(String::new());

fn pretty_model_id(id: &str) -> String {
    crate::models::pretty_model_name(id)
}

pub fn model_display_name(path: &std::path::Path) -> String {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    pretty_model_id(&name)
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

/// Chunked recording state — single lock for seq+inflight+results.
/// `gen` isolates consecutive recordings so a new `start_chunked`
/// does not clobber a still-draining pipeline's results.
/// `inflight_by_gen` tracks pending transcriptions per generation.
struct ChunkState {
    token: Option<CancelToken>,
    /// (gen, id, text) — gen tags which recording produced the chunk.
    results: Vec<(u64, u64, String)>,
    seq: u64,
    gen: u64,
    inflight_by_gen: std::collections::HashMap<u64, u64>,
}
static CHUNK: once_cell::sync::Lazy<Mutex<ChunkState>> = once_cell::sync::Lazy::new(|| {
    Mutex::new(ChunkState {
        token: None,
        results: Vec::new(),
        seq: 0,
        gen: 0,
        inflight_by_gen: std::collections::HashMap::new(),
    })
});
static CHUNK_CV: once_cell::sync::Lazy<(Mutex<()>, std::sync::Condvar)> =
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
        let wait_start = std::time::Instant::now();
        while SEQ_TURN.load(Ordering::Relaxed) != my_seq {
            if cancel.load(Ordering::Relaxed) {
                let cur = SEQ_TURN.load(Ordering::Relaxed);
                if cur == my_seq {
                    break;
                }
            }
            if wait_start.elapsed() > std::time::Duration::from_secs(30) {
                eprintln!("[seq] finish_pipeline seq {my_seq} wait timed out — advancing");
                break;
            }
            let (g, _) = cvar
                .wait_timeout(guard, std::time::Duration::from_millis(25))
                .unwrap_or_else(|e| e.into_inner());
            guard = g;
        }
        // Only advance forward — never move the turn backwards or skip over a
        // newer turn set while we were waiting (timeout recovery). Each seq
        // value is owned by exactly one pipeline, so cur == my_seq here in the
        // normal path; otherwise another pipeline already advanced past us.
        let cur = SEQ_TURN.load(Ordering::Relaxed);
        if cur == my_seq {
            SEQ_TURN.store(my_seq + 1, Ordering::Relaxed);
        } else {
            eprintln!("[seq] finish_pipeline seq {my_seq} turn already at {cur} — not clobbering");
        }
        cvar.notify_all();
    }
}

struct PipelineGuard {
    seq: u64,
    cancel: CancelToken,
}

impl Drop for PipelineGuard {
    fn drop(&mut self) {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            finish_pipeline(self.seq, &self.cancel);
        }));
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
    pending_origin: Option<OriginTarget>,
    chunk_token: Option<CancelToken>,
    chunk_gen: Option<u64>,
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
            pending_origin: None,
            chunk_token: None,
            chunk_gen: None,
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
                                self.start_chunked();
                                let origin = crate::focus::capture_origin();
                                self.pending_origin = origin.clone();
                                crate::emit_overlay_origin(origin.as_ref());
                                self.play_sound(800.0, 100);
                                self.set_state(CoordinatorState::Recording);
                            }
                        }
                    } else {
                        match self.state {
                            CoordinatorState::Idle => {
                                if let Err(e) =
                                    self.audio_recorder.start_recording(self.input_device())
                                {
                                    eprintln!("Failed to start recording: {}", e);
                                } else {
                                    self.start_chunked();
                                    let origin = crate::focus::capture_origin();
                                    self.pending_origin = origin.clone();
                                    crate::emit_overlay_origin(origin.as_ref());
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
                        self.stop_chunked();
                        let _ = self.audio_recorder.stop_recording();
                        self.pending_origin = None;
                        crate::emit_overlay_origin(None);
                        self.set_state(CoordinatorState::Idle);
                        play_cancel_sound();
                    }
                }
            }
        }
    }

    fn start_chunked(&mut self) {
        let token: CancelToken = Arc::new(AtomicBool::new(false));
        self.chunk_token = Some(token.clone());
        let my_gen = {
            let mut ch = CHUNK.lock().unwrap_or_else(|e| e.into_inner());
            ch.gen = ch.gen.wrapping_add(1);
            ch.token = Some(token.clone());
            let total_inflight: u64 = ch.inflight_by_gen.values().sum();
            if total_inflight == 0 {
                ch.results.clear();
            }
            ch.seq = 0;
            let g = ch.gen;
            ch.inflight_by_gen.entry(g).or_insert(0);
            ch.gen
        };
        self.chunk_gen = Some(my_gen);
        let recorder = self.audio_recorder.clone();
        thread::spawn(move || {
            let mut next_id: u64 = 0;
            loop {
                if token.load(Ordering::Relaxed) {
                    break;
                }
                thread::sleep(std::time::Duration::from_millis(400));
                if token.load(Ordering::Relaxed) {
                    break;
                }
                let sr = recorder.sample_rate();
                if sr == 0 {
                    continue;
                }
                let chunk_samples = (30.0 * sr as f32) as usize;
                let overlap_samples = (1.0 * sr as f32) as usize;
                if recorder.buffered_len() < chunk_samples {
                    continue;
                }
                let Some(chunk) = recorder.drain_chunk(chunk_samples, overlap_samples) else {
                    continue;
                };
                let id = next_id;
                next_id += 1;
                {
                    let mut ch = CHUNK.lock().unwrap_or_else(|e| e.into_inner());
                    if ch.gen != my_gen {
                        break;
                    }
                    ch.seq = next_id;
                    *ch.inflight_by_gen.entry(my_gen).or_insert(0) += 1;
                }
                thread::spawn(move || {
                    let t = transcribe_chunk(chunk, sr);
                    {
                        let mut ch = CHUNK.lock().unwrap_or_else(|e| e.into_inner());
                        let cnt = ch.inflight_by_gen.entry(my_gen).or_insert(0);
                        *cnt = cnt.saturating_sub(1);
                        if ch.gen == my_gen {
                            if let Some(tt) = t {
                                if !tt.trim().is_empty() {
                                    ch.results.push((my_gen, id, tt));
                                }
                            }
                        }
                    }
                    let (lock, cvar) = &*CHUNK_CV;
                    let _g = lock.lock().unwrap_or_else(|e| e.into_inner());
                    cvar.notify_all();
                });
            }
        });
    }

    fn stop_chunked(&mut self) {
        if let Some(t) = self.chunk_token.take() {
            t.store(true, Ordering::Relaxed);
        }
        if let Some(t) = CHUNK.lock().unwrap_or_else(|e| e.into_inner()).token.take() {
            t.store(true, Ordering::Relaxed);
        }
    }

    fn stop_and_process(&mut self) {
        let my_gen = self.chunk_gen.take().unwrap_or(0);
        let chunk_count = CHUNK.lock().unwrap_or_else(|e| e.into_inner()).seq as usize;
        self.stop_chunked();
        let device_sr = self.audio_recorder.sample_rate();
        let remainder = self.audio_recorder.stop_recording();
        let full_samples = self.audio_recorder.take_full_recording();
        let full_for_save = if full_samples.is_empty() {
            remainder.clone()
        } else {
            full_samples
        };
        let cancel: CancelToken = Arc::new(std::sync::atomic::AtomicBool::new(false));
        ACTIVE_JOBS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(cancel.clone());
        self.set_state(CoordinatorState::Idle);
        let origin = self.pending_origin.take();
        let cancel_for_thread = cancel.clone();
        let my_seq = SEQ_NEXT.fetch_add(1, Ordering::Relaxed);
        if let Err(e) = thread::Builder::new()
            .name("wisper-pipeline".into())
            .spawn(move || {
                run_pipeline_chunked(
                    remainder,
                    full_for_save,
                    device_sr,
                    cancel_for_thread,
                    my_seq,
                    my_gen,
                    chunk_count,
                    origin,
                )
            })
        {
            eprintln!("Failed to spawn pipeline thread: {}", e);
            ACTIVE_JOBS
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .retain(|t| !Arc::ptr_eq(t, &cancel));
        }
    }
}

fn dedup_chunk_overlap(texts: &[(u64, String)], overlap_words: usize) -> String {
    if texts.is_empty() {
        return String::new();
    }
    let parts: Vec<&str> = texts
        .iter()
        .map(|(_, t)| t.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if parts.is_empty() {
        return String::new();
    }
    if overlap_words == 0 || parts.len() == 1 {
        return parts.join(" ");
    }
    let mut out_words: Vec<&str> = Vec::new();
    for (idx, text) in parts.iter().enumerate() {
        let words: Vec<&str> = text.split_whitespace().collect();
        if idx == 0 {
            out_words.extend(words);
        } else {
            let k = overlap_words.min(words.len()).min(out_words.len());
            let prev_tail = if k > 0 {
                &out_words[out_words.len() - k..]
            } else {
                &[][..]
            };
            let cur_head = if k > 0 { &words[..k] } else { &[][..] };
            if k > 0 && prev_tail == cur_head {
                out_words.extend(words[k..].iter().copied());
            } else {
                out_words.extend(words);
            }
        }
    }
    out_words.join(" ")
}

fn chunk_inflight(gen: u64) -> u64 {
    CHUNK
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .inflight_by_gen
        .get(&gen)
        .copied()
        .unwrap_or(0)
}
fn take_chunk_results_for(gen: u64) -> Vec<(u64, String)> {
    let mut ch = CHUNK.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = Vec::new();
    let mut keep = Vec::new();
    for (g, id, t) in std::mem::take(&mut ch.results) {
        if g == gen {
            out.push((id, t));
        } else {
            keep.push((g, id, t));
        }
    }
    ch.results = keep;
    out
}
fn wait_for_chunk_results(my_gen: u64, expected: usize, timeout_ms: u64) -> Vec<(u64, String)> {
    if chunk_inflight(my_gen) == 0 {
        let mut v = take_chunk_results_for(my_gen);
        v.sort_by_key(|(id, _)| *id);
        let _ = expected;
        CHUNK
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .inflight_by_gen
            .remove(&my_gen);
        return v;
    }
    let (lock, cvar) = &*CHUNK_CV;
    let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let start = std::time::Instant::now();
    while chunk_inflight(my_gen) != 0 {
        let elapsed = start.elapsed();
        if elapsed.as_millis() as u64 >= timeout_ms {
            break;
        }
        let remaining = std::time::Duration::from_millis(timeout_ms) - elapsed;
        let wait_for = remaining.min(std::time::Duration::from_millis(200));
        let (g, _) = cvar
            .wait_timeout(guard, wait_for)
            .unwrap_or_else(|e| e.into_inner());
        guard = g;
    }
    drop(guard);
    if chunk_inflight(my_gen) != 0 {
        let (lock2, cvar2) = &*CHUNK_CV;
        let g2 = lock2.lock().unwrap_or_else(|e| e.into_inner());
        let _ = cvar2.wait_timeout(g2, std::time::Duration::from_millis(150));
    }
    let mut v = take_chunk_results_for(my_gen);
    v.sort_by_key(|(id, _)| *id);
    CHUNK
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .inflight_by_gen
        .remove(&my_gen);
    v
}

fn transcribe_chunk(chunk: Vec<f32>, sr: u32) -> Option<String> {
    let trimmed = prepare_audio(chunk, sr);
    if trimmed.is_empty() {
        return None;
    }
    transcribe_samples(&trimmed, 16000)
        .ok()
        .filter(|t| !t.trim().is_empty())
}

fn prepare_audio(samples: Vec<f32>, sr: u32) -> Vec<f32> {
    let resampled = if sr != 16000 {
        crate::engine::resample(&samples, sr, 16000)
    } else {
        samples
    };
    let denoised = if NOISE_SUPPRESSION_ENABLED.load(Ordering::Relaxed) {
        let lvl = f32::from_bits(NOISE_SUPPRESSION_LEVEL.load(Ordering::Relaxed));
        suppress_noise(&resampled, 16000, lvl)
    } else {
        resampled
    };
    if VAD_ENABLED.load(Ordering::Relaxed) {
        let thresh = f32::from_bits(VAD_THRESHOLD.load(Ordering::Relaxed));
        let t = trim_silence(&denoised, 1600, thresh);
        if t.is_empty() && !denoised.is_empty() {
            let max_amp = denoised.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
            if max_amp > 0.015 {
                return denoised;
            }
            return Vec::new();
        }
        t
    } else {
        denoised
    }
}

fn transcribe_samples(trimmed: &[f32], sr: u32) -> Result<String, String> {
    let mode = ENGINE_MODE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    if mode == "cloud" {
        let provider = CLOUD_PROVIDER
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if provider == "sarvam" {
            let api_key = CLOUD_API_KEY
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            if api_key.trim().is_empty() {
                return Err("Sarvam API key not configured".into());
            }
            let mut model = CLOUD_MODEL
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            if model.trim().is_empty() {
                model = "saaras:v4".into();
            }
            let mut sarvam_mode = CLOUD_SARVAM_MODE
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            if sarvam_mode.trim().is_empty() {
                sarvam_mode = "transcribe".into();
            }
            return SarvamCloudProvider::new(api_key, model, sarvam_mode).transcribe(trimmed, sr);
        } else {
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
                return Err("Cloud provider not configured (missing base URL)".into());
            }
            let api_key = CLOUD_API_KEY
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            let model = CLOUD_MODEL
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            return CloudEngineProvider::new(base_url, api_key, model).transcribe(trimmed, sr);
        }
    }
    let model_path = CURRENT_MODEL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    match model_path {
        Some(path) if path.exists() => create_local_engine(path).transcribe(trimmed, sr),
        Some(path) => Err(format!("Model file not found: {}", path.display())),
        None => Err("No model selected. Open the Engine tab to activate one.".into()),
    }
}

fn run_pipeline_chunked(
    mut remainder: Vec<f32>,
    full_for_save: Vec<f32>,
    device_sr: u32,
    cancel: CancelToken,
    my_seq: u64,
    my_gen: u64,
    chunk_count: usize,
    origin: Option<OriginTarget>,
) {
    let _guard = PipelineGuard {
        seq: my_seq,
        cancel: cancel.clone(),
    };
    let cancelled = || cancel.load(Ordering::Relaxed);
    if cancelled() {
        return;
    }
    if crate::audio::was_capped_and_reset() {
        eprintln!("[audio] recording capped, truncated");
    }
    let total_len = remainder.len();
    let mut chunk_texts = wait_for_chunk_results(my_gen, chunk_count, 30000);

    // The chunker leaves a 1s overlap at the buffer head for context, so the
    // remainder starts with a second that the last chunk already transcribed.
    // Strip it deterministically — the 4-word exact dedup below misses
    // paraphrased boundaries and duplicated phrases on 30s+ recordings.
    if chunk_count > 0 && !remainder.is_empty() {
        let sr = if device_sr == 0 { 16000 } else { device_sr };
        let overlap = (1.0 * sr as f32) as usize;
        if remainder.len() > overlap {
            remainder.drain(..overlap);
        }
    }
    if !remainder.is_empty() {
        let sr = if device_sr == 0 { 16000 } else { device_sr };
        if let Some(t) = transcribe_chunk(remainder, sr) {
            if !t.trim().is_empty() {
                chunk_texts.push((chunk_count as u64, t));
            }
        }
    }
    chunk_texts.sort_by_key(|(id, _)| *id);
    let raw_text = dedup_chunk_overlap(&chunk_texts, 4);

    if raw_text.trim().is_empty() {
        if total_len == 0 && chunk_texts.is_empty() {
            eprintln!("No speech detected");
            crate::show_overlay_error(Some(
                "No speech detected - try speaking closer to the mic.".into(),
            ));
            play_error_sound();
            return;
        }
        if chunk_count == 0 {
            eprintln!("No speech detected (VAD trimmed all audio)");
            crate::show_overlay_error(Some(
                "No speech detected - try speaking closer to the mic.".into(),
            ));
            play_error_sound();
            return;
        }
    }

    let samples_for_stats = full_for_save.len();
    finalize_transcription(
        raw_text,
        samples_for_stats,
        full_for_save,
        device_sr,
        cancel,
        my_seq,
        origin,
    );
}

fn finalize_transcription(
    text: String,
    samples_len: usize,
    full_for_save: Vec<f32>,
    device_sr: u32,
    cancel: CancelToken,
    my_seq: u64,
    origin: Option<OriginTarget>,
) {
    let cancelled = || cancel.load(Ordering::Relaxed);
    let result: Result<String, String> = Ok(text);
    match result {
        Ok(text) => {
            if cancelled() {
                return;
            }
            println!("Transcription: {}", text);
            let mut final_text = text.clone();
            let mut agent_name = None;
            let settings_snapshot = crate::settings::AppSettings::load();
            let words_enabled = settings_snapshot.words_enabled;
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
                        "/chat/completions".into()
                    } else {
                        process_endpoint
                    },
                );
                let timeout_secs = settings_snapshot.process_timeout_secs.clamp(3, 120) as u64;
                let ai_timeout = std::time::Duration::from_secs(timeout_secs);
                let agent_name_snapshot = agent.name.clone();
                if cancelled() {
                    eprintln!("[cancel] pipeline cancelled before AI phase");
                    return;
                }
                let cancel_for_ai = cancel.clone();
                let text_for_ai = text.clone();
                let agent_for_ai = agent.clone();
                let result =
                    crate::process::process_runtime().block_on(client.process_with_cancel(
                        &text_for_ai,
                        &agent_for_ai,
                        ai_timeout,
                        cancel_for_ai,
                    ));
                match result {
                    Ok(formatted) => {
                        if cancelled() {
                            return;
                        }
                        final_text = formatted;
                        agent_name = Some(agent_name_snapshot);
                    }
                    Err(e) if e == "Cancelled" => {
                        eprintln!("[cancel] AI request cancelled");
                        return;
                    }
                    Err(e) => {
                        eprintln!("AI processing skipped ({}), using raw text", e);
                    }
                }
            }
            if cancelled() {
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
                let wait_start = std::time::Instant::now();
                while SEQ_TURN.load(Ordering::Relaxed) != my_seq {
                    if cancelled() {
                        drop(guard);
                        return;
                    }
                    if wait_start.elapsed() > std::time::Duration::from_secs(30) {
                        break;
                    }
                    let (g, _) = cvar
                        .wait_timeout(guard, std::time::Duration::from_millis(25))
                        .unwrap_or_else(|e| e.into_inner());
                    guard = g;
                }
            }
            let recording_now = *crate::tray::STATE_LOCK
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                == CoordinatorState::Recording;
            if !recording_now {
                crate::hide_overlay();
                for _ in 0..5 {
                    if !crate::is_overlay_visible() {
                        break;
                    }
                    thread::sleep(std::time::Duration::from_millis(5));
                }
            }
            let to_paste = if PASTE_ADD_TRAILING_SPACE.load(Ordering::Relaxed)
                && !final_text.is_empty()
                && !final_text.ends_with(' ')
                && !final_text.ends_with('\n')
            {
                format!("{} ", final_text)
            } else {
                final_text.clone()
            };
            let mut skip_paste = false;
            if let Some(ref target) = origin {
                let is_placeholder = target.backend == "placeholder"
                    || (target.backend == "x11-fallback"
                        && crate::paste::detect_session_type() == "wayland");
                if is_placeholder {
                    eprintln!("[focus] placeholder {}", target.backend);
                } else if target.backend == "x11-fallback" {
                    if !crate::focus::focus_origin(target) {
                        eprintln!("[focus] x11-fallback failed {:?}", target.addr);
                    } else {
                        thread::sleep(std::time::Duration::from_millis(30));
                    }
                } else if !crate::focus::focus_origin(target) {
                    if crate::focus::is_origin_alive(target) {
                        eprintln!("[focus] activate failed but alive {:?}", target.addr);
                        thread::sleep(std::time::Duration::from_millis(30));
                    } else {
                        eprintln!("[focus] origin gone: {:?}", target.addr);
                        crate::show_overlay_error(Some(
                            "Original window closed — transcription saved to history".into(),
                        ));
                        play_error_sound();
                        skip_paste = true;
                    }
                } else {
                    thread::sleep(std::time::Duration::from_millis(30));
                }
            }
            if !skip_paste {
                if let Err(e) = paste_text(&to_paste, &paste_method) {
                    eprintln!("Paste failed: {}", e);
                }
            }
            crate::emit_overlay_origin(None);
            // Past this point paste is done — move disk I/O off the hot path so the
            // user sees instant paste even while we fsync wav and touch SQLite.
            let duration_ms = if device_sr > 0 {
                (samples_len as i64 * 1000) / device_sr as i64
            } else {
                0
            };
            let raw_words = text.split_whitespace().count();
            let final_words = final_text.split_whitespace().count();
            if raw_words == 0 && final_words == 0 {
                eprintln!("[history] skipping zero-word entry");
                return;
            }
            let text_bg = text.clone();
            let final_text_bg = final_text.clone();
            let agent_name_bg = agent_name.clone();
            std::thread::spawn(move || {
                let recording_path = if KEEP_RECORDINGS.load(Ordering::Relaxed) {
                    crate::history::save_recording_to_disk(&full_for_save, device_sr)
                } else {
                    None
                };
                let history = crate::history::HistoryManager::new();
                if let Err(e) = history.insert(
                    &text_bg,
                    Some(&final_text_bg),
                    agent_name_bg.as_deref(),
                    duration_ms,
                    recording_path.as_deref(),
                ) {
                    eprintln!("Failed to log history: {}", e);
                    if let Some(p) = recording_path {
                        let _ = std::fs::remove_file(p);
                    }
                } else {
                    let words = raw_words as f64;
                    let typing_sec = words / 1.0;
                    let speak_sec = duration_ms as f64 / 1000.0;
                    let saved = (typing_sec - speak_sec).max(0.0) as i64;
                    crate::settings::add_dictation_stats(raw_words as i64, saved);
                    if WORDS_ENABLED.load(Ordering::Relaxed)
                        && WORDS_AUTO_SCAN.load(Ordering::Relaxed)
                        && text_bg != final_text_bg
                    {
                        crate::words::maybe_auto_add_corrections(&text_bg, &final_text_bg);
                    }
                    let s = crate::settings::AppSettings::load();
                    if s.max_history_entries > 0 {
                        let mode =
                            if s.keep_recordings && s.history_retention_mode == "recordings_only" {
                                "recordings_only"
                            } else {
                                "both"
                            };
                        if let Err(e) = history.trim_history(s.max_history_entries as i64, mode) {
                            eprintln!("Failed to trim history: {}", e);
                        }
                    }
                    crate::emit_history_changed();
                }
            });
        }
        Err(e) => {
            eprintln!("Transcription error: {}", e);
            crate::show_overlay_error(Some(format!("Transcription failed: {}", e)));
            play_error_sound();
            return;
        }
    }
    play_done_sound();
}

#[allow(dead_code)]
fn run_pipeline(
    samples: Vec<f32>,
    device_sr: u32,
    cancel: CancelToken,
    my_seq: u64,
    origin: Option<OriginTarget>,
) {
    let _guard = PipelineGuard {
        seq: my_seq,
        cancel: cancel.clone(),
    };
    let cancelled = || cancel.load(Ordering::Relaxed);

    if cancelled() {
        return;
    }

    if crate::audio::was_capped_and_reset() {
        eprintln!("[audio] recording capped at 5min, truncated");
    }
    let recording_path = if KEEP_RECORDINGS.load(Ordering::Relaxed) {
        crate::history::save_recording_to_disk(&samples, device_sr)
    } else {
        None
    };

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
            if t.is_empty() && !denoised.is_empty() {
                let max_amp = denoised.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
                if max_amp > 0.015 {
                    eprintln!("[vad] trimmed empty but max {max_amp:.4}, using denoised");
                    denoised
                } else {
                    t
                }
            } else {
                t
            }
        } else {
            denoised
        };
        (trimmed, samples_len)
    };

    if !trimmed.is_empty() {
        if cancelled() {
            eprintln!("[cancel] pipeline cancelled before transcription");
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
            if provider == "sarvam" {
                let api_key = CLOUD_API_KEY
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                if api_key.trim().is_empty() {
                    Err("Sarvam API key not configured".into())
                } else {
                    let mut model = CLOUD_MODEL
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .clone();
                    if model.trim().is_empty() {
                        model = "saaras:v4".to_string();
                    }
                    let mut sarvam_mode = CLOUD_SARVAM_MODE
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .clone();
                    if sarvam_mode.trim().is_empty() {
                        sarvam_mode = "transcribe".to_string();
                    }
                    let engine = SarvamCloudProvider::new(api_key, model, sarvam_mode);
                    engine.transcribe(&trimmed, 16000)
                }
            } else {
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
                    return;
                }
            }
        };

        match result {
            Ok(text) => {
                if cancelled() {
                    eprintln!("[cancel] pipeline cancelled after transcription - discarding text");
                    return;
                }
                println!("Transcription: {}", text);
                let mut final_text = text.clone();
                let mut agent_name = None;
                let settings_snapshot = crate::settings::AppSettings::load();
                let words_enabled = settings_snapshot.words_enabled;
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
                        return;
                    }
                    let cancel_for_ai = cancel.clone();
                    let text_for_ai = text.clone();
                    let agent_for_ai = agent.clone();
                    let result =
                        crate::process::process_runtime().block_on(client.process_with_cancel(
                            &text_for_ai,
                            &agent_for_ai,
                            ai_timeout,
                            cancel_for_ai,
                        ));
                    match result {
                        Ok(formatted) => {
                            if cancelled() {
                                eprintln!(
                                    "[cancel] AI result discarded (cancelled during processing)"
                                );
                                return;
                            }
                            final_text = formatted;
                            agent_name = Some(agent_name_snapshot);
                        }
                        Err(e) if e == "Cancelled" => {
                            eprintln!("[cancel] AI request cancelled, discarding pipeline");
                            return;
                        }
                        Err(e) => {
                            eprintln!("AI processing skipped ({}), using raw text", e);
                        }
                    }
                }
                if cancelled() {
                    eprintln!("[cancel] pipeline cancelled before words/paste - discarding");
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
                    let wait_start = std::time::Instant::now();
                    while SEQ_TURN.load(Ordering::Relaxed) != my_seq {
                        if cancelled() {
                            drop(guard);
                            eprintln!(
                                "[cancel] pipeline cancelled while waiting for paste turn {my_seq}"
                            );
                            return;
                        }
                        if wait_start.elapsed() > std::time::Duration::from_secs(30) {
                            eprintln!(
                                "[paste] seq {my_seq} turn wait timed out - pasting out of order"
                            );
                            break;
                        }
                        let (g, _) = cvar
                            .wait_timeout(guard, std::time::Duration::from_millis(25))
                            .unwrap_or_else(|e| e.into_inner());
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
                let recording_now = *crate::tray::STATE_LOCK
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    == CoordinatorState::Recording;
                if !recording_now {
                    crate::hide_overlay();
                    for _ in 0..20 {
                        if !crate::is_overlay_visible() {
                            break;
                        }
                        thread::sleep(std::time::Duration::from_millis(10));
                    }
                }
                let to_paste = if crate::coordinator::PASTE_ADD_TRAILING_SPACE
                    .load(std::sync::atomic::Ordering::Relaxed)
                    && !final_text.is_empty()
                    && !final_text.ends_with(' ')
                    && !final_text.ends_with('\n')
                {
                    format!("{} ", final_text)
                } else {
                    final_text.clone()
                };
                let mut skip_paste = false;
                if let Some(ref target) = origin {
                    let is_placeholder = target.backend == "placeholder"
                        || (target.backend == "x11-fallback"
                            && crate::paste::detect_session_type() == "wayland");
                    if is_placeholder {
                        eprintln!(
                            "[focus] placeholder backend {} - pasting to current focus (Wayland X11-fallback unreliable)",
                            target.backend
                        );
                    } else if target.backend == "x11-fallback" {
                        if !crate::focus::focus_origin(target) {
                            eprintln!(
                                "[focus] x11-fallback activate failed for {:?} — pasting at current focus",
                                target.addr
                            );
                        } else {
                            thread::sleep(std::time::Duration::from_millis(30));
                        }
                    } else if !crate::focus::focus_origin(target) {
                        if crate::focus::is_origin_alive(target) {
                            eprintln!("[focus] activate failed but window alive {:?} - pasting at current focus", target.addr);
                            thread::sleep(std::time::Duration::from_millis(30));
                        } else {
                            eprintln!("[focus] origin gone: {:?}", target.addr);
                            crate::show_overlay_error(Some(
                                "Original window closed — transcription saved to history".into(),
                            ));
                            play_error_sound();
                            skip_paste = true;
                        }
                    } else {
                        thread::sleep(std::time::Duration::from_millis(30));
                    }
                }
                if !skip_paste {
                    if let Err(e) = paste_text(&to_paste, &paste_method) {
                        eprintln!("Paste failed: {}", e);
                    }
                }
                crate::emit_overlay_origin(None);
                let duration_ms = if device_sr > 0 {
                    (samples_len as i64 * 1000) / device_sr as i64
                } else {
                    0
                };
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
                        let words = raw_words as f64;
                        let typing_sec = words / 1.0; // ~60 WPM
                        let speak_sec = duration_ms as f64 / 1000.0;
                        let saved = (typing_sec - speak_sec).max(0.0) as i64;
                        crate::settings::add_dictation_stats(raw_words as i64, saved);
                        if WORDS_ENABLED.load(Ordering::Relaxed)
                            && WORDS_AUTO_SCAN.load(Ordering::Relaxed)
                            && text != final_text
                        {
                            crate::words::maybe_auto_add_corrections(&text, &final_text);
                        }
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
                        crate::emit_history_changed();
                    }
                }
            }
            Err(e) => {
                eprintln!("Transcription error: {}", e);
                crate::show_overlay_error(Some(format!("Transcription failed: {}", e)));
                play_error_sound();
                return;
            }
        }
    } else {
        eprintln!("No speech detected (VAD trimmed all audio)");
        crate::show_overlay_error(Some(
            "No speech detected - try speaking closer to the mic.".into(),
        ));
        play_error_sound();
        return;
    }

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
