# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Pending.

### Changed
- Pending.

### Fixed
- Pending.

## [0.1.0] - 2026-03-03

### Added
- Full web GUI workflow for LeRobot setup and operations:
  Status, Camera Setup, Motor Setup, Calibration, Teleop, Recording, Dataset,
  Training, and Evaluation flows.
- FastAPI backend route modules for process orchestration, devices, udev,
  training, evaluation, dataset listing/curation/hub, and streaming.
- Process lifecycle management with streamed logs and command/input bridging.
- Dataset curation and Hugging Face Hub integration paths.
- Public docs site via MkDocs and bilingual README support.

### Changed
- Package and naming migration from legacy naming to `lestudio`.
- Frontend architecture migration and wireframe/app-shell integration.
- UX refinements across 9-tab workflow and responsive layouts.

### Fixed
- Multiple training/evaluation preflight and blocker UX consistency issues.
- Console and dataset UI polishing and reliability issues.
- Recording/teleop feed and runtime stability fixes.

### Refactored
- Backend typing and request model cleanup with broader route coverage.
- Frontend component extraction for heavy pages and baseline test harness setup.

### Documentation
- Added release checklist, troubleshooting updates, and broader design docs.

---

For detailed release process and validation gates, see `docs/release-checklist.md`.

When documenting user-visible changes for a release, keep `docs_public/feature-spec.md`, `README.md`, and `README.ko.md` synchronized with the shipped product scope.
