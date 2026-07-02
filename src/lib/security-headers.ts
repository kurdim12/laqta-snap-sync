// Security headers applied to every response from the SSR server entry.
//
// The CSP is intentionally tuned to the app's real dependencies so it does not
// break anything:
//   - script-src allows 'unsafe-inline' because TanStack Start injects inline
//     hydration/data scripts. In dev it also allows 'unsafe-eval' + ws: for
//     Vite HMR; those are dropped in production.
//   - style-src allows 'unsafe-inline' (Tailwind/inline style attrs) + Google
//     Fonts stylesheet.
//   - img-src / media-src allow data:, blob: (canvas resize, QR data URLs,
//     object URLs) and the Supabase project domain (signed media URLs).
//   - connect-src allows the Supabase REST + realtime (wss) endpoints.
//   - camera=(self) keeps the guest/staff selfie capture working; mic and
//     geolocation are denied.

function buildCsp(isDev: boolean): string {
  const supabase = "https://*.supabase.co";
  const supabaseWs = "wss://*.supabase.co";
  const fontsCss = "https://fonts.googleapis.com";
  const fontsFiles = "https://fonts.gstatic.com";
  const ogImg = "https://storage.googleapis.com";

  const scriptSrc = ["'self'", "'unsafe-inline'"];
  const connectSrc = ["'self'", supabase, supabaseWs];
  if (isDev) {
    scriptSrc.push("'unsafe-eval'");
    connectSrc.push("ws:", "wss:");
  }

  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `script-src ${scriptSrc.join(" ")}`,
    `style-src 'self' 'unsafe-inline' ${fontsCss}`,
    `font-src 'self' data: ${fontsFiles}`,
    `img-src 'self' data: blob: ${supabase} ${ogImg}`,
    `media-src 'self' blob: ${supabase}`,
    `connect-src ${connectSrc.join(" ")}`,
  ].join("; ");
}

export function withSecurityHeaders(response: Response, isDev: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", buildCsp(isDev));
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=(), browsing-topics=()",
  );
  // Preserve the (possibly streaming) body, status and statusText.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
