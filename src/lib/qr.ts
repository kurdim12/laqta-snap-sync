// Local QR generation — renders entirely client-side via the bundled `qrcode`
// package. Nothing about the encoded URL (which may be a private /g/CODE
// gallery link) ever leaves the app, unlike the previous api.qrserver.com call.
import QRCode from "qrcode";

// Returns a PNG data URL for `text`, sized to `size` px. Runs in the browser
// (and Node during SSR) with no network access.
export function qrDataUrl(text: string, size = 280): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
}
