from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.health import router as health_router
from app.api.models import router as models_router
from app.api.suggestions import router as suggestions_router
from app.config import Settings, get_settings
from app.llm.factory import ProviderConfigError


async def _provider_config_error(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": str(exc)})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="AI Docs API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.add_exception_handler(ProviderConfigError, _provider_config_error)
    app.include_router(health_router, prefix="/api")
    app.include_router(models_router, prefix="/api")
    app.include_router(suggestions_router, prefix="/api")
    return app


app = create_app()
