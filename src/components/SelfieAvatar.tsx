import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const cache = new Map<string, string>();

function initials(name: string): string {
  const clean = (name || "").trim();
  if (!clean) return "·";
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function SelfieAvatar({
  path,
  name,
  size = 48,
  signedUrl,
}: {
  path: string | null | undefined;
  name: string;
  size?: number;
  signedUrl?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(
    () => signedUrl ?? (path ? (cache.get(path) ?? null) : null),
  );

  useEffect(() => {
    let alive = true;
    if (signedUrl) {
      setUrl(signedUrl);
      if (path) cache.set(path, signedUrl);
      return;
    }
    if (!path) {
      setUrl(null);
      return;
    }
    const cached = cache.get(path);
    if (cached) {
      setUrl(cached);
      return;
    }
    (async () => {
      const { data } = await supabase.storage.from("media").createSignedUrl(path, 3600);
      if (!alive || !data) return;
      cache.set(path, data.signedUrl);
      setUrl(data.signedUrl);
    })();
    return () => {
      alive = false;
    };
  }, [path, signedUrl]);

  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.36),
  } as React.CSSProperties;

  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={style}
        className="shrink-0 rounded-full object-cover ring-2 ring-primary/30"
      />
    );
  }
  return (
    <div
      style={style}
      className="grid shrink-0 place-items-center rounded-full bg-primary/20 font-bold text-primary ring-2 ring-primary/30"
    >
      {initials(name)}
    </div>
  );
}
