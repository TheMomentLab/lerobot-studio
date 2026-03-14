"""Pydantic request/response models for LeStudio API routes.

Covers the most bounded endpoints where schemas are well-defined.
Large process-start endpoints (train/eval/teleop/record) pass config
dicts directly to CLI command builders and remain as dict for now.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

# ─── Process endpoints ─────────────────────────────────────────────────────


class ProcessCommandRequest(BaseModel):
    """Body for POST /api/process/{name}/command — runs an installer command."""

    command: str = Field(default="", description="Shell command to run (pip/conda allowlist enforced)")


class ProcessInputRequest(BaseModel):
    """Body for POST /api/process/{name}/input — sends stdin to a running process."""

    text: str = Field(default="", description="Text to write to process stdin")


# ─── Camera settings ───────────────────────────────────────────────────────


class CameraSettingsRequest(BaseModel):
    """Body for POST /api/camera_settings — persists camera codec/resolution/fps."""

    codec: str = Field(default="MJPG")
    width: int = Field(default=640, ge=1)
    height: int = Field(default=480, ge=1)
    fps: int = Field(default=30, ge=1, le=120)
    jpeg_quality: int = Field(default=70, ge=1, le=100)


class CameraPathsRequest(BaseModel):
    """Body for POST /api/camera/check_paths — checks if device paths exist."""

    paths: list[str] = Field(default_factory=list)


# ─── HF Token ──────────────────────────────────────────────────────────────


class HfTokenRequest(BaseModel):
    """Body for POST/PUT /api/hf/token — stores a Hugging Face API token."""

    token: str = Field(description="Hugging Face API token (hf_…)")


class DeviceCameraResponse(BaseModel):
    device: str
    path: str = ""
    kernels: str = ""
    symlink: str = ""
    model: str = "Unknown"


class DeviceArmResponse(BaseModel):
    device: str
    path: str = ""
    symlink: str = ""
    serial: str = ""
    kernels: str = ""


class DevicesResponse(BaseModel):
    cameras: list[DeviceCameraResponse] = Field(default_factory=list)
    arms: list[DeviceArmResponse] = Field(default_factory=list)


class DepsStatusResponse(BaseModel):
    ok: bool = True
    huggingface_cli: bool = False
    teleop_antijitter_plugin: bool = False
    rules_needs_root: bool = False
    rules_needs_install: bool = False


class HfWhoamiResponse(BaseModel):
    ok: bool = False
    username: str | None = None
    error: str | None = None


class TrainPreflightResponse(BaseModel):
    ok: bool = False
    reason: str = ""
    action: str = ""
    command: str = ""
