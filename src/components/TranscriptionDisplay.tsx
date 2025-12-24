interface TranscriptionDisplayProps {
  text: string;
}

export default function TranscriptionDisplay({
  text,
}: TranscriptionDisplayProps) {
  return (
    <div className="flex flex-col" data-no-drag>
      {/* Transcription text only - buttons are in header */}
      <div className="bg-white/5 rounded-lg p-2.5 max-h-[120px] overflow-y-auto">
        <p className="text-white/90 text-sm leading-relaxed break-words">
          {text}
        </p>
      </div>
    </div>
  );
}
