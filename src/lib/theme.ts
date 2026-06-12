/**
 * Apply event theme colors to :root, returning a cleanup that restores the
 * previous values. Use the returned function in a useEffect cleanup so theme
 * customizations don't leak when navigating back to non-event pages.
 */
export function applyEventTheme(theme: {
  primary?: string;
  background?: string;
  text?: string;
}): () => void {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement.style;
  const prev = {
    primary: root.getPropertyValue("--primary"),
    background: root.getPropertyValue("--background"),
    foreground: root.getPropertyValue("--foreground"),
  };
  if (theme.primary) root.setProperty("--primary", theme.primary);
  if (theme.background) root.setProperty("--background", theme.background);
  if (theme.text) root.setProperty("--foreground", theme.text);
  return () => {
    if (prev.primary) root.setProperty("--primary", prev.primary);
    else root.removeProperty("--primary");
    if (prev.background) root.setProperty("--background", prev.background);
    else root.removeProperty("--background");
    if (prev.foreground) root.setProperty("--foreground", prev.foreground);
    else root.removeProperty("--foreground");
  };
}
