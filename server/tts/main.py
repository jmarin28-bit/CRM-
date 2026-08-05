from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import subprocess
import uuid
import os
import shutil
import re

app = FastAPI(title="IonCore TTS Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OUTPUT_DIR = "generated_audio"

# Ajusta estos modelos cuando tengas descargadas las voces reales de Piper.
# Por ahora quedan como variables fáciles de cambiar.
AXIS_MODEL = os.getenv("PIPER_AXIS_MODEL", "voices/es_MX-claude-high.onnx")
DIRECTOR_MODEL = os.getenv("PIPER_DIRECTOR_MODEL", "voices/es_ES-davefx-medium.onnx")


class TTSRequest(BaseModel):
    texto: str


def ensure_output_dir():
    os.makedirs(OUTPUT_DIR, exist_ok=True)


def clean_text(text: str, max_chars: int = 600) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()

    # Evita audios larguísimos en demo.
    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars].rsplit(" ", 1)[0] + "."

    return cleaned


def piper_available() -> bool:
    return shutil.which("piper") is not None


def model_exists(model_path: str) -> bool:
    return os.path.exists(model_path)


def generate_audio(text: str, model_path: str, agent_name: str) -> str:
    ensure_output_dir()

    cleaned_text = clean_text(text)

    if not cleaned_text:
        raise HTTPException(status_code=400, detail="Texto vacío.")

    if not piper_available():
        raise HTTPException(
            status_code=500,
            detail="Piper no está instalado o no está disponible en PATH.",
        )

    if not model_exists(model_path):
        raise HTTPException(
            status_code=500,
            detail=f"No encontré el modelo de voz para {agent_name}: {model_path}",
        )

    file_name = f"{agent_name}_{uuid.uuid4()}.wav"
    output_path = os.path.join(OUTPUT_DIR, file_name)

    try:
        subprocess.run(
            ["piper", "--model", model_path, "--output_file", output_path],
            input=cleaned_text.encode("utf-8"),
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as error:
        raise HTTPException(
            status_code=500,
            detail=f"Error generando voz con Piper: {error.stderr.decode('utf-8', errors='ignore')}",
        )

    return output_path


@app.get("/")
def health_check():
    return {
        "ok": True,
        "service": "IonCore TTS",
        "piper_available": piper_available(),
        "axis_model": AXIS_MODEL,
        "axis_model_exists": model_exists(AXIS_MODEL),
        "director_model": DIRECTOR_MODEL,
        "director_model_exists": model_exists(DIRECTOR_MODEL),
    }


@app.post("/tts/axis")
def tts_axis(payload: TTSRequest):
    output_path = generate_audio(
        text=payload.texto,
        model_path=AXIS_MODEL,
        agent_name="axis",
    )

    return FileResponse(
        output_path,
        media_type="audio/wav",
        filename="axis.wav",
    )


@app.post("/tts/director")
def tts_director(payload: TTSRequest):
    output_path = generate_audio(
        text=payload.texto,
        model_path=DIRECTOR_MODEL,
        agent_name="director",
    )

    return FileResponse(
        output_path,
        media_type="audio/wav",
        filename="director.wav",
    )