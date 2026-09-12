from .audio_engine import AudioEngine  # type: ignore

# Initialize the engine for the CV subsystem to interact with
engine = AudioEngine()
engine.initialize()

__all__ = ["engine", "AudioEngine"]
