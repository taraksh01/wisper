use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, Stream};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

static AUDIO_DROP_CTR: AtomicU32 = AtomicU32::new(0);
static AUDIO_FULL_DROP_CTR: AtomicU32 = AtomicU32::new(0);
static AUDIO_CAP_WARNED: AtomicBool = AtomicBool::new(false);

pub fn was_capped_and_reset() -> bool {
    AUDIO_CAP_WARNED.swap(false, Ordering::Relaxed)
}

/// Infallible device label. cpal's `Display for Device` returns
/// `Err(fmt::Error)` when the underlying description query fails (e.g.
/// mic-permission-gated CoreAudio), so `to_string()` on a Device panics —
/// fatally inside wry's `extern "C"` scheme-handler frame. Same query as
/// Display, but through `Result`, degrading to the stable id instead.
fn device_label(d: &cpal::Device) -> String {
    d.description()
        .ok()
        .map(|dd| {
            dd.name()
                .lines()
                .next()
                .map(|s| s.trim().to_string())
                .unwrap_or_default()
        })
        .filter(|s| !s.is_empty())
        .or_else(|| d.id().ok().map(|i| i.to_string()))
        .unwrap_or_default()
}

/// List available audio input devices as (stable id, display name) pairs.
/// ALSA exposes the same physical microphone under many PCM nodes (hw/plughw/
/// sysdefault/front/dsnoop) and even under both its numeric and named card id,
/// so we dedupe by the human-readable device name and keep one capture-capable
/// node per physical microphone. Virtual sinks (null/pipewire/default/playback)
/// are skipped since they are not real microphones.
/// Returns an empty vector if enumeration fails.
pub fn list_input_devices() -> Vec<(String, String)> {
    // cfg!: #[cfg] return would orphan the code below on Windows.
    // macOS joins this branch: CoreAudio ids carry no ALSA node semantics,
    // so the Linux rank/filter path below must not run on them.
    if cfg!(target_os = "windows") || cfg!(target_os = "macos") {
        let host = cpal::default_host();
        let Ok(devices) = host.input_devices() else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for d in devices {
            let raw_name = device_label(&d);
            if raw_name.is_empty() {
                continue;
            }
            let id = d
                .id()
                .ok()
                .map(|i| i.to_string())
                .unwrap_or(raw_name.clone());
            let name = d
                .description()
                .ok()
                .and_then(|dd| {
                    dd.name()
                        .to_string()
                        .lines()
                        .next()
                        .map(|s| s.trim().to_string())
                })
                .filter(|s| !s.is_empty())
                .unwrap_or(raw_name);
            if name.is_empty() {
                continue;
            }
            out.push((id, name));
        }
        out.sort_by(|a, b| a.1.to_ascii_lowercase().cmp(&b.1.to_ascii_lowercase()));
        return out;
    }
    let mut hosts = cpal::available_hosts();
    if hosts.is_empty() {
        hosts.push(cpal::default_host().id());
    }
    if !hosts.contains(&cpal::default_host().id()) {
        hosts.push(cpal::default_host().id());
    }
    let is_bluetooth = |name: &str, id: &str| {
        let lid = id.to_ascii_lowercase();
        let lname = name.to_ascii_lowercase();
        lid.contains("bluetooth") || lid.contains("bluez") || lname.contains("bluetooth")
    };
    let is_virtual = |name: &str, id: &str| {
        if name.contains("Discard all samples") || name.contains("Default ALSA Output") {
            return true;
        }
        if id.contains(":null") || id.contains(":default") {
            return true;
        }
        if is_bluetooth(name, id) {
            return false;
        }
        if id.to_ascii_lowercase().contains("pipewire") {
            return true;
        }
        false
    };
    let rank = |id: &str| {
        let lid = id.to_ascii_lowercase();
        if id.contains("dsnoop") || lid.contains("bluetooth") || lid.contains("bluez") {
            0
        } else if id.contains("hw:CARD") || id.contains("hw=") {
            1
        } else if id.contains("plughw") {
            2
        } else {
            3
        }
    };
    let label_for = |name: &str, id: &str, host_name: &str| -> String {
        if is_bluetooth(name, id) {
            return format!("{} [{}]", name, host_name);
        }
        name.to_string()
    };
    let mut best: std::collections::HashMap<String, (String, String, usize)> =
        std::collections::HashMap::new();
    for host_id in &hosts {
        let Ok(host) = cpal::host_from_id(*host_id) else {
            continue;
        };
        let Ok(devices) = host.input_devices() else {
            continue;
        };
        for d in devices {
            let raw_name = device_label(&d);
            if raw_name.is_empty() {
                continue;
            }
            let Ok(id) = d.id().map(|i| i.to_string()) else {
                continue;
            };
            let name = d
                .description()
                .ok()
                .and_then(|dd| {
                    dd.name()
                        .to_string()
                        .lines()
                        .next()
                        .map(|s| s.trim().to_string())
                })
                .filter(|s| !s.is_empty())
                .unwrap_or(raw_name);
            if name.is_empty() {
                continue;
            }
            if is_virtual(&name, &id) {
                continue;
            }
            let bt = is_bluetooth(&name, &id);
            let key = if bt {
                format!("{}::{}", host_id.name(), name)
            } else {
                name.clone()
            };
            let display = label_for(&name, &id, host_id.name());
            let r = rank(&id);
            match best.get(&key) {
                Some(existing) if existing.2 <= r => {}
                _ => {
                    best.insert(key, (id, display, r));
                }
            }
        }
    }
    let mut out: Vec<(String, String)> =
        best.into_values().map(|(id, name, _)| (id, name)).collect();
    out.sort_by(|a, b| a.1.to_ascii_lowercase().cmp(&b.1.to_ascii_lowercase()));
    out
}

/// Resolve the requested input device by its stable id, searching all available
/// hosts (ALSA/Pulse/PipeWire) so Bluetooth mics on PipeWire are found even
/// when the default host is ALSA. Also handles substring matches because the
/// stable id from `list_input_devices` may be a prefix of what cpal actually
/// hands back. Falls back to the host default when not found.
fn resolve_device(device: Option<&str>) -> Result<cpal::Device, String> {
    if let Some(id) = device {
        if !id.is_empty() {
            for &host_id in cpal::available_hosts().as_slice() {
                if let Ok(host) = cpal::host_from_id(host_id) {
                    if let Ok(mut devices) = host.input_devices() {
                        if let Some(d) = devices
                            .find(|d| d.id().ok().map(|i| i.to_string()) == Some(id.to_string()))
                        {
                            eprintln!("[audio] using device '{}' via host {}", id, host_id.name());
                            return Ok(d);
                        }
                    }
                }
            }
            if let Ok(host) = cpal::host_from_id(cpal::default_host().id()) {
                if let Ok(mut devices) = host.input_devices() {
                    if let Some(d) = devices.find(|d| {
                        let did = d.id().ok().map(|i| i.to_string()).unwrap_or_default();
                        let dname = device_label(d);
                        did.contains(id)
                            || dname.contains(id)
                            || id.contains(&did)
                            || id.contains(&dname)
                    }) {
                        eprintln!(
                            "[audio] using device '{}' via fallback match '{}'",
                            id,
                            d.id().ok().map(|i| i.to_string()).unwrap_or_default()
                        );
                        return Ok(d);
                    }
                }
            }
            let host = cpal::default_host();
            if let Ok(mut devices) = host.input_devices() {
                if let Some(d) = devices.find(|d| {
                    let did = d.id().ok().map(|i| i.to_string()).unwrap_or_default();
                    let dname = device_label(d);
                    did.contains(id)
                        || dname.contains(id)
                        || id.contains(&did)
                        || id.contains(&dname)
                }) {
                    return Ok(d);
                }
            }
            eprintln!("[audio] device '{}' not found, falling back to default", id);
        }
    }
    cpal::default_host()
        .default_input_device()
        .ok_or("No input device available".into())
}

#[derive(Clone)]
pub struct AudioRecorder {
    buffer: Arc<Mutex<Vec<f32>>>,
    full_buffer: Arc<Mutex<Vec<f32>>>,
    stream: Arc<Mutex<Option<Stream>>>,
    preview_stream: Arc<Mutex<Option<Stream>>>,
    preview_device: Arc<Mutex<Option<String>>>,
    sample_rate: Arc<Mutex<u32>>,
    level: Arc<AtomicU32>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            buffer: Arc::new(Mutex::new(Vec::new())),
            full_buffer: Arc::new(Mutex::new(Vec::new())),
            stream: Arc::new(Mutex::new(None)),
            preview_stream: Arc::new(Mutex::new(None)),
            preview_device: Arc::new(Mutex::new(None)),
            sample_rate: Arc::new(Mutex::new(16000)),
            level: Arc::new(AtomicU32::new(0)),
        }
    }

    /// Current input amplitude (RMS, 0.0..~1.0). 0 when not recording.
    pub fn current_level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }

    pub fn start_recording(&self, device: Option<String>) -> Result<(), String> {
        // Stop preview without dropping Stream inside the mutex.
        {
            let old = self
                .preview_stream
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take();
            drop(old);
        }
        *self
            .preview_device
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
        let device = resolve_device(device.as_deref())?;

        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get input config: {}", e))?;

        if cfg!(debug_assertions) {
            eprintln!(
                "[audio] input config: {}Hz {}ch {:?}",
                config.sample_rate(),
                config.channels(),
                config.sample_format()
            );
        }

        {
            self.buffer
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clear();
            self.full_buffer
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clear();
        }
        self.level.store(0, Ordering::Relaxed);

        let buffer_clone = self.buffer.clone();
        let full_clone = self.full_buffer.clone();
        let level_clone = self.level.clone();

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => Self::build_stream_with_full::<f32>(
                &device,
                &config.into(),
                buffer_clone,
                Some(full_clone),
                level_clone,
            ),
            cpal::SampleFormat::I16 => Self::build_stream_with_full::<i16>(
                &device,
                &config.into(),
                buffer_clone,
                Some(full_clone.clone()),
                level_clone.clone(),
            ),
            cpal::SampleFormat::U16 => Self::build_stream_with_full::<u16>(
                &device,
                &config.into(),
                buffer_clone,
                Some(full_clone.clone()),
                level_clone.clone(),
            ),
            cpal::SampleFormat::I32 => Self::build_stream_with_full::<i32>(
                &device,
                &config.clone().into(),
                buffer_clone,
                Some(full_clone.clone()),
                level_clone.clone(),
            ),
            cpal::SampleFormat::U32 => Self::build_stream_with_full::<u32>(
                &device,
                &config.clone().into(),
                buffer_clone,
                Some(full_clone.clone()),
                level_clone.clone(),
            ),
            cpal::SampleFormat::F64 => Self::build_stream_with_full::<f64>(
                &device,
                &config.clone().into(),
                buffer_clone,
                Some(full_clone),
                level_clone,
            ),
            other => Err(format!("Unsupported sample format: {:?}", other))?,
        }?;

        stream
            .play()
            .map_err(|e| format!("Failed to play stream: {}", e))?;
        // Publish sample_rate + stream only on success — don't poison on failure.
        {
            let mut sr = self.sample_rate.lock().unwrap_or_else(|e| e.into_inner());
            *sr = config.sample_rate();
        }
        let old = self
            .stream
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .replace(stream);
        drop(old);

        Ok(())
    }

    pub fn stop_recording(&self) -> Vec<f32> {
        let old = self.stream.lock().unwrap_or_else(|e| e.into_inner()).take();
        drop(old);
        self.level.store(0, Ordering::Relaxed);
        let mut buffer = self.buffer.lock().unwrap_or_else(|e| e.into_inner());
        std::mem::take(&mut *buffer)
    }

    pub fn take_full_recording(&self) -> Vec<f32> {
        self.full_buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain(..)
            .collect()
    }

    pub fn full_recorded_len(&self) -> usize {
        self.full_buffer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .len()
    }

    /// Open the input stream to feed the live level meter without recording
    /// or transcribing. Used by the mic-test preview in settings.
    pub fn start_preview(&self, device: Option<String>) -> Result<(), String> {
        // Don't start preview if already recording - use separate slot
        if self
            .stream
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
        {
            return Ok(());
        }
        // Resolve first so we can compare by the actual device identity (cpal may
        // alias the same mic under hw/plughw/dsnoop). This avoids the stale-raw-id
        // bug where switching from "hw:CARD=..." to "plughw:CARD=..." for the same
        // mic would unnecessarily tear down and recreate.
        let resolved = resolve_device(device.as_deref())?;
        let resolved_id = resolved
            .id()
            .ok()
            .map(|i| i.to_string())
            .unwrap_or_else(|| device_label(&resolved));
        {
            let cur_dev = self
                .preview_device
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            let preview_active = self
                .preview_stream
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_some();
            if preview_active && cur_dev.as_deref() == Some(resolved_id.as_str()) {
                return Ok(());
            }
            if preview_active {
                *self
                    .preview_stream
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = None;
                *self
                    .preview_device
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = None;
            }
        }
        let device_id_for_log = Some(resolved_id.clone());
        let device = resolved;
        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get input config: {}", e))?;
        {
            let mut sr = self.sample_rate.lock().unwrap_or_else(|e| e.into_inner());
            *sr = config.sample_rate();
        }
        self.level.store(0, Ordering::Relaxed);
        // Throwaway buffer; the callback only needs it to update `level`.
        let buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
        let level_clone = self.level.clone();
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                Self::build_stream::<f32>(&device, &config.into(), buf.clone(), level_clone)
            }
            cpal::SampleFormat::I16 => {
                Self::build_stream::<i16>(&device, &config.into(), buf.clone(), level_clone)
            }
            cpal::SampleFormat::U16 => {
                Self::build_stream::<u16>(&device, &config.into(), buf.clone(), level_clone)
            }
            cpal::SampleFormat::I32 => {
                Self::build_stream::<i32>(&device, &config.clone().into(), buf.clone(), level_clone)
            }
            cpal::SampleFormat::U32 => {
                Self::build_stream::<u32>(&device, &config.clone().into(), buf.clone(), level_clone)
            }
            cpal::SampleFormat::F64 => {
                Self::build_stream::<f64>(&device, &config.clone().into(), buf.clone(), level_clone)
            }
            other => Err(format!("Unsupported sample format: {:?}", other))?,
        }?;
        stream
            .play()
            .map_err(|e| format!("Failed to play stream: {}", e))?;
        *self
            .preview_stream
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(stream);
        *self
            .preview_device
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = device_id_for_log;
        Ok(())
    }

    pub fn stop_preview(&self) {
        let old = self
            .preview_stream
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        drop(old);
        *self
            .preview_device
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
        self.level.store(0, Ordering::Relaxed);
    }

    pub fn buffered_len(&self) -> usize {
        self.buffer.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    pub fn drain_chunk(&self, n: usize, overlap: usize) -> Option<Vec<f32>> {
        let overlap = overlap.min(n.saturating_sub(1));
        let mut b = self.buffer.lock().unwrap_or_else(|e| e.into_inner());
        if b.len() < n {
            return None;
        }
        let take = n;
        let drain_end = n.saturating_sub(overlap);
        let chunk: Vec<f32> = b[..take].to_vec();
        b.drain(..drain_end);
        Some(chunk)
    }

    pub fn sample_rate(&self) -> u32 {
        *self.sample_rate.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn build_stream<T>(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        buffer: Arc<Mutex<Vec<f32>>>,
        level: Arc<AtomicU32>,
    ) -> Result<Stream, String>
    where
        T: Sample + cpal::SizedSample,
        f32: FromSample<T>,
    {
        Self::build_stream_with_full(device, config, buffer, None, level)
    }

    fn build_stream_with_full<T>(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        buffer: Arc<Mutex<Vec<f32>>>,
        full_buffer: Option<Arc<Mutex<Vec<f32>>>>,
        level: Arc<AtomicU32>,
    ) -> Result<Stream, String>
    where
        T: Sample + cpal::SizedSample,
        f32: FromSample<T>,
    {
        let channels = config.channels as usize;
        if channels == 0 {
            return Err("Audio device reports zero channels".into());
        }
        let err_fn = |err: cpal::Error| {
            if matches!(err.kind(), cpal::ErrorKind::Xrun) {
                return;
            }
            eprintln!("an error occurred on stream: {}", err);
        };

        let stream = device
            .build_input_stream(
                config.clone(),
                move |data: &[T], _: &_| {
                    let mut b = match buffer.try_lock() {
                        Ok(g) => g,
                        Err(_) => {
                            let c = AUDIO_DROP_CTR.fetch_add(1, Ordering::Relaxed);
                            if c % 1000 == 0 {
                                eprintln!("[audio] buffer contention: dropped {} frames", c + 1);
                            }
                            return;
                        }
                    };
                    if b.len() > 50_000_000 {
                        if !AUDIO_CAP_WARNED.swap(true, Ordering::Relaxed) {
                            eprintln!(
                                "[audio] buffer cap reached (50M samples), dropping further input"
                            );
                        }
                        return;
                    }
                    let mut fb_guard = match full_buffer.as_ref().map(|fb| fb.try_lock()) {
                        Some(Ok(g)) => {
                            if g.len() > 50_000_000 {
                                None
                            } else {
                                Some(g)
                            }
                        }
                        Some(Err(_)) => {
                            let c = AUDIO_FULL_DROP_CTR.fetch_add(1, Ordering::Relaxed);
                            if c % 1000 == 0 {
                                eprintln!(
                                    "[audio] full_buffer contention: dropped {} chunks",
                                    c + 1
                                );
                            }
                            None
                        }
                        None => None,
                    };
                    let mut sum_sq: f32 = 0.0;
                    let mut count: usize = 0;
                    for frame in data.chunks(channels) {
                        let mut sum: f32 = 0.0;
                        for sample in frame {
                            sum += sample.to_sample::<f32>();
                        }
                        let mono = sum / channels as f32;
                        b.push(mono);
                        if let Some(ref mut fb) = fb_guard {
                            fb.push(mono);
                        }
                        sum_sq += mono * mono;
                        count += 1;
                    }
                    drop(fb_guard);
                    drop(b);
                    if count > 0 {
                        let rms = (sum_sq / count as f32).sqrt();
                        let prev = f32::from_bits(level.load(Ordering::Relaxed));
                        let smoothed = if rms > prev {
                            prev + (rms - prev) * 0.6
                        } else {
                            prev + (rms - prev) * 0.3
                        };
                        level.store(smoothed.to_bits(), Ordering::Relaxed);
                    }
                },
                err_fn,
                Some(Duration::from_secs(5)), // Timeout
            )
            .map_err(|e| format!("Failed to build input stream: {}", e))?;

        Ok(stream)
    }
}

pub fn save_wav(
    filename: impl AsRef<std::path::Path>,
    data: &[f32],
    sample_rate: u32,
) -> Result<(), hound::Error> {
    let path = filename.as_ref();
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .or_else(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    std::fs::remove_file(path)?;
                    std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .mode(0o600)
                        .open(path)
                } else {
                    Err(e)
                }
            })?;
        let mut writer = hound::WavWriter::new(std::io::BufWriter::new(file), spec)?;
        for &sample in data {
            writer.write_sample(sample)?;
        }
        writer.finalize()?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let mut writer = hound::WavWriter::create(path, spec)?;
        for &sample in data {
            writer.write_sample(sample)?;
        }
        writer.finalize()?;
        Ok(())
    }
}

pub fn load_wav(filename: &str) -> Result<(Vec<f32>, u32), String> {
    let mut reader =
        hound::WavReader::open(filename).map_err(|e| format!("Failed to open WAV: {}", e))?;
    let spec = reader.spec();
    let sample_rate = spec.sample_rate;
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?,
        hound::SampleFormat::Int => {
            let max = 2i32.pow(spec.bits_per_sample as u32 - 1) as f32;
            reader
                .samples::<i32>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|s| s as f32 / max)
                .collect()
        }
    };
    Ok((samples, sample_rate))
}

/// Lightweight noise suppression: high-pass at ~85 Hz plus spectral gate.
/// `strength` 0.0 = mild, 1.0 = aggressive. Attenuates stationary background.
pub fn suppress_noise(samples: &[f32], sample_rate: u32, strength: f32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }
    // One-pole high-pass - removes DC and low-frequency rumble.
    let rc = 1.0 / (2.0 * std::f32::consts::PI * 85.0);
    let dt = 1.0 / sample_rate as f32;
    let alpha = rc / (rc + dt);
    let mut hp = Vec::with_capacity(samples.len());
    let mut prev_in = 0.0_f32;
    let mut prev_out = 0.0_f32;
    for &s in samples {
        let out = alpha * (prev_out + s - prev_in);
        hp.push(out);
        prev_in = s;
        prev_out = out;
    }

    // Estimate noise floor from the quietest 10% of 20 ms windows.
    let win = (sample_rate as usize / 50).max(1);
    let mut energies: Vec<f32> = hp
        .chunks(win)
        .map(|w| (w.iter().map(|&s| s * s).sum::<f32>() / w.len() as f32).sqrt())
        .collect();
    energies.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let noise_floor = energies[energies.len() / 10].max(0.002);
    let s = strength.clamp(0.0, 1.0);
    // strength 0 → mild (high threshold, gentle attenuation), 1 → aggressive
    let gate_thresh = noise_floor * (3.0 - s * 1.6); // 3.0 → 1.4
    let floor_gain = 0.6 - s * 0.45; // 0.6 → 0.15
    let exponent = 0.8 + s * 1.2; // 0.8 → 2.0

    // Gate: attenuate windows below threshold, keep speech at full gain.
    let mut out = Vec::with_capacity(hp.len());
    for window in hp.chunks(win) {
        let rms = (window.iter().map(|&s| s * s).sum::<f32>() / window.len() as f32).sqrt();
        let gain = if rms < gate_thresh {
            (rms / gate_thresh).powf(exponent) * floor_gain
        } else {
            1.0
        };
        for &s in window {
            out.push(s * gain);
        }
    }
    out
}

/// Encode f32 mono samples to 16-bit WAV bytes in memory (for playback).
pub fn wav_bytes_from_samples(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    use std::io::Write;
    let mut raw = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        raw.extend_from_slice(&((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).to_le_bytes());
    }
    let data_size = raw.len() as u32;
    let file_size = 36 + data_size;
    let mut buf = Vec::with_capacity((44 + data_size) as usize);
    buf.write_all(b"RIFF").map_err(|e| e.to_string())?;
    buf.write_all(&file_size.to_le_bytes())
        .map_err(|e| e.to_string())?;
    buf.write_all(b"WAVE").map_err(|e| e.to_string())?;
    buf.write_all(b"fmt ").map_err(|e| e.to_string())?;
    buf.write_all(&16u32.to_le_bytes())
        .map_err(|e| e.to_string())?;
    buf.write_all(&1u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    buf.write_all(&1u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    buf.write_all(&sample_rate.to_le_bytes())
        .map_err(|e| e.to_string())?;
    buf.write_all(&(sample_rate * 2u32).to_le_bytes())
        .map_err(|e| e.to_string())?;
    buf.write_all(&2u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    buf.write_all(&16u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    buf.write_all(b"data").map_err(|e| e.to_string())?;
    buf.write_all(&data_size.to_le_bytes())
        .map_err(|e| e.to_string())?;
    buf.write_all(&raw).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Trims leading and trailing silence based on RMS energy windowing.
pub fn trim_silence(samples: &[f32], window_size: usize, threshold: f32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    let mut start_idx = 0;
    let mut end_idx = samples.len();
    let mut found = false;

    // Find start of speech
    for (i, window) in samples.chunks(window_size).enumerate() {
        let rms: f32 = (window.iter().map(|&s| s * s).sum::<f32>() / window.len() as f32).sqrt();
        if rms > threshold {
            start_idx = i * window_size;
            found = true;
            break;
        }
    }
    if !found {
        return Vec::new();
    }

    // Find end of speech
    for (i, window) in samples.chunks(window_size).rev().enumerate() {
        let rms: f32 = (window.iter().map(|&s| s * s).sum::<f32>() / window.len() as f32).sqrt();
        if rms > threshold {
            end_idx = samples.len() - (i * window_size);
            break;
        }
    }

    if start_idx >= end_idx {
        return Vec::new();
    }

    samples[start_idx..end_idx].to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trim_silence() {
        // Create 100 silent samples, 100 loud samples, 100 silent samples
        let mut audio = vec![0.001_f32; 100];
        audio.extend(vec![0.5_f32; 100]);
        audio.extend(vec![0.001_f32; 100]);

        let trimmed = trim_silence(&audio, 10, 0.05);
        assert_eq!(trimmed.len(), 100);
        assert_eq!(trimmed[0], 0.5);
    }
}
