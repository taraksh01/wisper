interface TranscriptProps {
  text: string;
}

export function Transcript({ text }: TranscriptProps) {
  if (!text) return null;

  return (
    <div className="mt-4 p-3 bg-white/5 rounded-lg max-h-32 overflow-y-auto">
      <p className="text-white/80 text-sm leading-relaxed">{text}</p>
    </div>
  );
}
