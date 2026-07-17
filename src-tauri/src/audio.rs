use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, Stream};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// List available audio input devices as (stable id, display name) pairs.
/// ALSA exposes the same physical microphone under many PCM nodes (hw/plughw/
/// sysdefault/front/dsnoop) and even under both its numeric and named card id,
/// so we dedupe by the human-readable device name and keep one capture-capable
/// node per physical microphone. Virtual sinks (null/pipewire/default/playback)
/// are skipped since they are not real microphones.
/// Returns an empty vector if enumeration fails.
pub fn list_input_devices() -> Vec<(String, String)> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devices| {
            // Best capture node per physical device name: dsnoop > hw > plughw > rest.
            let rank = |id: &str| {
                if id.contains("dsnoop") { 0 }
                else if id.contains("hw:CARD") || id.contains("hw=") { 1 }
                else if id.contains("plughw") { 2 }
                else { 3 }
            };
            let is_virtual = |name: &str, id: &str| {
                id.contains(":null")
                    || id.contains("pipewire")
                    || id.contains(":default")
                    || name.contains("Discard all samples")
                    || name.contains("Default ALSA Output")
            };
            let mut best: std::collections::HashMap<String, (String, usize)> = std::collections::HashMap::new();
            for d in devices {
                let name = d.to_string();
                if name.is_empty() {
                    continue;
                }
                let id = match d.id() {
                    Ok(i) => i.to_string(),
                    Err(_) => continue,
                };
                if is_virtual(&name, &id) {
                    continue;
                }
                let r = rank(&id);
                match best.get(&name) {
                    Some(existing) if existing.1 <= r => {}
                    _ => { best.insert(name.clone(), (id, r)); }
                }
            }
            best.into_iter().map(|(name, (id, _))| (id, name)).collect()
        })
        .unwrap_or_default()
}

/// Resolve the requested input device by its stable id, or fall back to the
/// host default when `device` is None/empty/not found.
fn resolve_device(device: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    if let Some(id) = device {
        if !id.is_empty() {
            if let Ok(mut devices) = host.input_devices() {
                if let Some(d) = devices.find(|d| d.id().ok().map(|i| i.to_string()) == Some(id.to_string())) {
                    return Ok(d);
                }
            }
            return Err(format!("Input device '{}' not found", id));
        }
    }
    host.default_input_device().ok_or("No input device available".into())
}

#[derive(Clone)]
pub struct AudioRecorder {
    buffer: Arc<Mutex<Vec<f32>>>,
    stream: Arc<Mutex<Option<Stream>>>,
    sample_rate: Arc<Mutex<u32>>,
    /// Latest input RMS amplitude (f32 bits), updated live in the audio callback.
    level: Arc<AtomicU32>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            buffer: Arc::new(Mutex::new(Vec::new())),
            stream: Arc::new(Mutex::new(None)),
            sample_rate: Arc::new(Mutex::new(16000)),
            level: Arc::new(AtomicU32::new(0)),
        }
    }

    /// Current input amplitude (RMS, 0.0..~1.0). 0 when not recording.
    pub fn current_level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }

    pub fn start_recording(&self, device: Option<String>) -> Result<(), String> {
        let device = resolve_device(device.as_deref())?;

        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get input config: {}", e))?;

        // Store the actual device sample rate
        {
            let mut sr = self.sample_rate.lock().unwrap();
            *sr = config.sample_rate();
        }

        // Clear the buffer before starting
        self.buffer.lock().unwrap().clear();
        self.level.store(0, Ordering::Relaxed);

        let buffer_clone = self.buffer.clone();
        let level_clone = self.level.clone();

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => Self::build_stream::<f32>(&device, &config.into(), buffer_clone, level_clone),
            cpal::SampleFormat::I16 => Self::build_stream::<i16>(&device, &config.into(), buffer_clone, level_clone),
            cpal::SampleFormat::U16 => Self::build_stream::<u16>(&device, &config.into(), buffer_clone, level_clone),
            _ => Err("Unsupported sample format".into()),
        }?;

        stream.play().map_err(|e| format!("Failed to play stream: {}", e))?;

        let mut current_stream = self.stream.lock().unwrap();
        *current_stream = Some(stream);

        Ok(())
    }

    pub fn stop_recording(&self) -> Vec<f32> {
        let mut current_stream = self.stream.lock().unwrap();
        *current_stream = None;
        self.level.store(0, Ordering::Relaxed);

        let mut buffer = self.buffer.lock().unwrap();
        let final_buffer = buffer.clone();
        buffer.clear();
        final_buffer
    }

    /// Open the input stream to feed the live level meter without recording
    /// or transcribing. Used by the mic-test preview in settings.
    pub fn start_preview(&self, device: Option<String>) -> Result<(), String> {
        if self.stream.lock().unwrap().is_some() {
            return Ok(());
        }
        let device = resolve_device(device.as_deref())?;
        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get input config: {}", e))?;
        {
            let mut sr = self.sample_rate.lock().unwrap();
            *sr = config.sample_rate();
        }
        self.level.store(0, Ordering::Relaxed);
        // Throwaway buffer; the callback only needs it to update `level`.
        let buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
        let level_clone = self.level.clone();
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => Self::build_stream::<f32>(&device, &config.into(), buf.clone(), level_clone),
            cpal::SampleFormat::I16 => Self::build_stream::<i16>(&device, &config.into(), buf.clone(), level_clone),
            cpal::SampleFormat::U16 => Self::build_stream::<u16>(&device, &config.into(), buf.clone(), level_clone),
            _ => Err("Unsupported sample format".into()),
        }?;
        stream.play().map_err(|e| format!("Failed to play stream: {}", e))?;
        *self.stream.lock().unwrap() = Some(stream);
        Ok(())
    }

    pub fn stop_preview(&self) {
        *self.stream.lock().unwrap() = None;
        self.level.store(0, Ordering::Relaxed);
    }

    pub fn sample_rate(&self) -> u32 {
        *self.sample_rate.lock().unwrap()
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
        let channels = config.channels as usize;
        let err_fn = |err| eprintln!("an error occurred on stream: {}", err);

        let stream = device
            .build_input_stream(
                config.clone(),
                move |data: &[T], _: &_| {
                    let mut b = buffer.lock().unwrap();
                    let mut sum_sq: f32 = 0.0;
                    let mut count: usize = 0;
                    // Downmix to mono if stereo, and convert to f32
                    for frame in data.chunks(channels) {
                        let mut sum: f32 = 0.0;
                        for sample in frame {
                            sum += sample.to_sample::<f32>();
                        }
                        let mono = sum / channels as f32;
                        b.push(mono);
                        sum_sq += mono * mono;
                        count += 1;
                    }
                    // Update the live RMS amplitude for the UI, smoothing toward
                    // the new value so the meter feels responsive but not jittery.
                    if count > 0 {
                        let rms = (sum_sq / count as f32).sqrt();
                        let prev = f32::from_bits(level.load(Ordering::Relaxed));
                        let smoothed = if rms > prev {
                            // rise quickly
                            prev + (rms - prev) * 0.6
                        } else {
                            // fall more gently
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

pub fn save_wav(filename: &str, data: &[f32], sample_rate: u32) -> Result<(), hound::Error> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(filename, spec)?;
    for &sample in data {
        writer.write_sample(sample)?;
    }
    writer.finalize()?;
    Ok(())
}

pub fn load_wav(filename: &str) -> Result<(Vec<f32>, u32), String> {
    let mut reader = hound::WavReader::open(filename).map_err(|e| format!("Failed to open WAV: {}", e))?;
    let spec = reader.spec();
    let sample_rate = spec.sample_rate;
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?,
        hound::SampleFormat::Int => {
            let max = 2i32.pow(spec.bits_per_sample as u32 - 1) as f32;
            reader.samples::<i32>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|s| s as f32 / max)
                .collect()
        }
    };
    Ok((samples, sample_rate))
}

/// Trims leading and trailing silence based on RMS energy windowing.
pub fn trim_silence(samples: &[f32], window_size: usize, threshold: f32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    let mut start_idx = 0;
    let mut end_idx = samples.len();

    // Find start of speech
    for (i, window) in samples.chunks(window_size).enumerate() {
        let rms: f32 = (window.iter().map(|&s| s * s).sum::<f32>() / window.len() as f32).sqrt();
        if rms > threshold {
            start_idx = i * window_size;
            break;
        }
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
