use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, Stream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone)]
pub struct AudioRecorder {
    // Buffer to store audio chunks (f32 samples)
    buffer: Arc<Mutex<Vec<f32>>>,
    // Optional stream handle, must be kept alive to continue recording
    stream: Arc<Mutex<Option<Stream>>>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            buffer: Arc::new(Mutex::new(Vec::new())),
            stream: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start_recording(&self) -> Result<(), String> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("No input device available")?;

        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get input config: {}", e))?;

        // Clear the buffer before starting
        self.buffer.lock().unwrap().clear();

        let buffer_clone = self.buffer.clone();

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => Self::build_stream::<f32>(&device, &config.into(), buffer_clone),
            cpal::SampleFormat::I16 => Self::build_stream::<i16>(&device, &config.into(), buffer_clone),
            cpal::SampleFormat::U16 => Self::build_stream::<u16>(&device, &config.into(), buffer_clone),
            _ => Err("Unsupported sample format".into()),
        }?;

        stream.play().map_err(|e| format!("Failed to play stream: {}", e))?;

        let mut current_stream = self.stream.lock().unwrap();
        *current_stream = Some(stream);

        Ok(())
    }

    pub fn stop_recording(&self) -> Vec<f32> {
        let mut current_stream = self.stream.lock().unwrap();
        // Dropping the stream stops recording
        *current_stream = None;

        let mut buffer = self.buffer.lock().unwrap();
        let final_buffer = buffer.clone();
        buffer.clear();
        final_buffer
    }

    fn build_stream<T>(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        buffer: Arc<Mutex<Vec<f32>>>,
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
                    // Downmix to mono if stereo, and convert to f32
                    for frame in data.chunks(channels) {
                        let mut sum: f32 = 0.0;
                        for sample in frame {
                            sum += sample.to_sample::<f32>();
                        }
                        b.push(sum / channels as f32);
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
