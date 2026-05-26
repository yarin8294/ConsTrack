type ProgressBarProps = {
  value: number;
  label?: string;
  showValue?: boolean;
  color?: "auto" | "accent";
  className?: string;
};

export function ProgressBar({
  value,
  label,
  showValue = true,
  color = "auto",
  className = "",
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));

  const fillClass =
    color === "accent"
      ? "accent"
      : clamped >= 80
      ? "bg-green-500"
      : clamped >= 40
      ? "bg-blue-500"
      : "bg-yellow-400";

  const showHeader = label !== undefined || showValue;

  return (
    <div className={className}>
      {showHeader && (
        <div className="flex justify-between items-center mb-1 text-xs">
          {label !== undefined && <span className="muted">{label}</span>}
          {showValue && <span className="font-medium ml-auto">{clamped}%</span>}
        </div>
      )}
      <div className="h-2 rounded-full surface-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${fillClass}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
