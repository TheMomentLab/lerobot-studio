from __future__ import annotations

from lestudio._cors import _DEFAULT_CORS_ORIGIN_REGEX, _resolve_cors_settings


def test_resolve_cors_settings_defaults_to_localhost_regex(monkeypatch):
    monkeypatch.delenv("LESTUDIO_CORS_ORIGINS", raising=False)
    monkeypatch.delenv("LESTUDIO_CORS_ORIGIN_REGEX", raising=False)

    origins, origin_regex = _resolve_cors_settings()
    assert origins == []
    assert origin_regex == _DEFAULT_CORS_ORIGIN_REGEX


def test_resolve_cors_settings_uses_explicit_origins(monkeypatch):
    monkeypatch.setenv("LESTUDIO_CORS_ORIGINS", "https://studio.example, http://localhost:7860")
    monkeypatch.delenv("LESTUDIO_CORS_ORIGIN_REGEX", raising=False)

    origins, origin_regex = _resolve_cors_settings()
    assert origins == ["https://studio.example", "http://localhost:7860"]
    assert origin_regex is None


def test_resolve_cors_settings_wildcard_disables_regex(monkeypatch):
    monkeypatch.setenv("LESTUDIO_CORS_ORIGINS", "*")
    monkeypatch.setenv("LESTUDIO_CORS_ORIGIN_REGEX", r"^https://example\.com$")

    origins, origin_regex = _resolve_cors_settings()
    assert origins == ["*"]
    assert origin_regex is None
