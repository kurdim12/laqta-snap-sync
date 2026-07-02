"""LAQTA face worker (Phase 5.1) — SCAFFOLD.

Self-hosted SCRFD (detection) + ArcFace (embedding) via ONNX Runtime (CPU).
Deployed as a small container (Fly.io / Railway / Hetzner). CPU is sufficient at
event scale. Photos are fetched via short-lived signed URLs and never persisted
here.

This is a scaffold: endpoint shapes, auth, and health are defined; the model
loading + inference is marked TODO so a maintainer can drop in insightface/ONNX
without reworking the interface. Do NOT deploy as-is for production matching.
"""
from __future__ import annotations

import os
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="laqta-face-worker")

FACE_SERVICE_SECRET = os.environ.get("FACE_SERVICE_SECRET", "")


def _auth(secret: str | None) -> None:
    if not FACE_SERVICE_SECRET or secret != FACE_SERVICE_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")


class EmbedRequest(BaseModel):
    image_url: str  # short-lived signed URL


class Face(BaseModel):
    bbox: list[float]     # [x, y, w, h]
    quality: float        # [0, 1]
    embedding: list[float]  # 512-d ArcFace


class EmbedResponse(BaseModel):
    faces: list[Face]


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest, x_face_secret: str | None = Header(default=None)) -> EmbedResponse:
    _auth(x_face_secret)
    # TODO: load SCRFD + ArcFace ONNX models once at startup; fetch req.image_url,
    # detect faces, filter by quality floor, and return 512-d embeddings.
    # from insightface.app import FaceAnalysis
    # app_model = FaceAnalysis(providers=["CPUExecutionProvider"])
    raise HTTPException(status_code=501, detail="embedding not implemented (scaffold)")
