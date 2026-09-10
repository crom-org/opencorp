import { type Component, type JSX, splitProps, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

export interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "xs" | "sm" | "md" | "lg";
  icon?: any;
  titulo?: string;
  iconSize?: number;
}

export const IconButton: Component<IconButtonProps> = (props) => {
  const [local, rest] = splitProps(props, [
    "variant",
    "size",
    "children",
    "class",
    "disabled",
    "icon",
    "titulo",
    "iconSize",
  ]);

  const variantClasses = () => ({
    primary: "bg-zinc-100 text-zinc-900 hover:bg-white active:bg-zinc-200",
    secondary: "bg-zinc-800 text-zinc-200 hover:bg-zinc-700 active:bg-zinc-800 border border-zinc-700/60",
    ghost: "bg-transparent text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100",
    danger: "bg-transparent text-rose-400 hover:bg-rose-950/40 hover:text-rose-300",
  }[local.variant ?? "ghost"]);

  const sizeClasses = () => ({
    xs: "h-6 w-6 text-xs rounded",
    sm: "h-7 w-7 text-xs rounded-md",
    md: "h-8 w-8 text-sm rounded-md",
    lg: "h-9 w-9 text-base rounded-lg",
  }[local.size ?? "md"]);

  const defaultIconSize = () => {
    if (local.iconSize) return local.iconSize;
    switch (local.size) {
      case "xs": return 12;
      case "sm": return 13;
      case "lg": return 17;
      default: return 15;
    }
  };

  return (
    <button
      {...rest}
      title={local.titulo ?? rest.title}
      aria-label={local.titulo ?? rest["aria-label"] ?? rest.title}
      disabled={local.disabled}
      class={`inline-flex items-center justify-center transition-colors select-none disabled:opacity-40 disabled:pointer-events-none cursor-pointer flex-shrink-0 ${variantClasses()} ${sizeClasses()} ${local.class ?? ""}`}
    >
      <Show when={local.icon} fallback={local.children}>
        {(IconComp) => {
          const s = () => defaultIconSize();
          return <Dynamic component={IconComp()} size={s()} width={s()} height={s()} />;
        }}
      </Show>
    </button>
  );
};
