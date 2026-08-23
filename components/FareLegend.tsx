import { BRACKETS, BRACKET_COLORS, bracketLabel } from "@/lib/brackets";

export default function FareLegend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {[...BRACKETS.keys(), BRACKETS.length].map((i) => (
        <span key={i} className="flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: BRACKET_COLORS[i] }}
          />
          {bracketLabel(i)}
        </span>
      ))}
    </div>
  );
}
