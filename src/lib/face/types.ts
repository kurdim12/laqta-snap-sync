// Provider-abstracted face service contract (Phase 5.1). Two implementations
// will satisfy this behind FACE_PROVIDER: `insightface` (self-hosted SCRFD +
// ArcFace, embeddings in pgvector — the chosen default) and `rekognition`
// (managed AWS Collections). No implementation is wired yet — the InsightFace
// worker (services/face-worker) and calibration are prerequisites.
export type FaceProviderKind = "insightface" | "rekognition";

export interface DetectedFace {
  /** [x, y, w, h] in pixels. */
  bbox: [number, number, number, number];
  /** Detector confidence / face quality in [0, 1]. */
  quality: number;
  /** 512-d ArcFace-class embedding. Treated as biometric data. */
  embedding: number[];
}

export interface GuestMatch {
  guestId: string;
  /** Cosine similarity in [0, 1]. */
  similarity: number;
}

export interface FaceProvider {
  detectAndEmbed(imageUrl: string): Promise<DetectedFace[]>;
  matchGuest(eventId: string, embedding: number[]): Promise<GuestMatch[]>;
}
