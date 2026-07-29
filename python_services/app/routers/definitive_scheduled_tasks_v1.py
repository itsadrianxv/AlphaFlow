"""C++ worker 调用的确定性评分执行接口。"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.definitive_scheduled_tasks.json_parser import RuleSemanticError, parse_execution_plan
from app.definitive_scheduled_tasks.schemas import DeterministicExecutionPlan, ExecutionRequest
from app.definitive_scheduled_tasks.service import DefinitiveExecutionError, DefinitiveScoringService


router = APIRouter(prefix="/api/v1/definitive-scheduled-tasks", tags=["definitive-scheduled-tasks"])


@router.post("/validate")
def validate(plan: DeterministicExecutionPlan):
    try:
        requirement = parse_execution_plan(plan)
        return {
            "valid": True,
            "normalizedPlan": plan.model_dump(mode="json", by_alias=True),
            "requirements": {
                "timeframes": list(requirement.timeframes),
                "lookbackBars": requirement.lookback_bars,
            },
        }
    except RuleSemanticError as exc:
        return JSONResponse(
            status_code=400,
            content={"valid": False, "code": "INVALID_EXECUTION_PLAN", "message": str(exc)},
        )


@router.post("/execute")
def execute(request: ExecutionRequest):
    try:
        return DefinitiveScoringService().execute(request)
    except (ValidationError, RuleSemanticError, ValueError) as exc:
        return JSONResponse(status_code=400, content={"code": "INVALID_EXECUTION_PLAN", "message": str(exc), "retryable": False, "details": {}})
    except DefinitiveExecutionError as exc:
        return JSONResponse(status_code=503 if exc.retryable else 400, content={"code": exc.code, "message": str(exc), "retryable": exc.retryable, "details": {}})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"code": "EXECUTION_FAILED", "message": str(exc), "retryable": True, "details": {}})
