from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.llm.catalog import MODELS

router = APIRouter(tags=["models"])


class ModelOut(BaseModel):
    id: str
    label: str


class ModelsResponse(BaseModel):
    provider: str
    default_model: str
    models: list[ModelOut]


@router.get("/models")
def list_models(settings: Annotated[Settings, Depends(get_settings)]) -> ModelsResponse:
    return ModelsResponse(
        provider=settings.llm_provider,
        default_model=settings.llm_default_model,
        models=[ModelOut(id=model.id, label=model.label) for model in MODELS],
    )
