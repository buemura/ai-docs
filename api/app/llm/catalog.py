from app.llm.types import ModelInfo

MODELS: tuple[ModelInfo, ...] = (
    ModelInfo(id="claude-sonnet-5-5", label="Claude Sonnet 5.5"),
    ModelInfo(id="claude-haiku-5-5", label="Claude Haiku 5.5"),
)

_MODELS_BY_ID = {model.id: model for model in MODELS}


def get_model(model_id: str) -> ModelInfo | None:
    return _MODELS_BY_ID.get(model_id)
