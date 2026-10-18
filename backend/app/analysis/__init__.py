"""Deterministic, non-executing repository analysis pipeline."""

from .engine import AnalysisConfig, analyze_files, discover_files

__all__ = ["AnalysisConfig", "analyze_files", "discover_files"]
