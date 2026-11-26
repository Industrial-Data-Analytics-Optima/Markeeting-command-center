import { useId, useState } from "react";
import type { InputHTMLAttributes } from "react";
export function PasswordInput({
  id,
  revealLabel = "password",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  revealLabel?: string;
}) {
  const generated = useId(),
    inputId = id || generated,
    [visible, setVisible] = useState(false);
  return (
    <span className="password-control">
      <input {...props} id={inputId} type={visible ? "text" : "password"} />
      <button
        type="button"
        aria-controls={inputId}
        aria-label={(visible ? "Hide " : "Show ") + revealLabel}
        aria-pressed={visible}
        disabled={props.disabled}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </span>
  );
}
