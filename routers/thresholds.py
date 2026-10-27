# routers/thresholds.py
"""
Threshold API router - handles per-PV alarm thresholds.
Stored in config.json (alongside aliases/egus) so all browsers share them.

Each PV maps to {"upper": float, "lower": float}; either bound may be omitted.
Legacy entries stored as a plain number are treated as an upper threshold.
"""

import math
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from routers.config import load_config, save_config

router = APIRouter(prefix="/api", tags=["thresholds"])


def _is_finite_number(value) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _normalize(entry) -> dict:
    """convert a stored threshold entry into {"upper"?, "lower"?}"""
    if _is_finite_number(entry):
        return {"upper": entry}
    if isinstance(entry, dict):
        return {
            key: entry[key]
            for key in ("upper", "lower")
            if _is_finite_number(entry.get(key))
        }
    return {}


@router.get("/thresholds")
async def get_thresholds():
    """get all PV thresholds"""
    thresholds = load_config().get("thresholds", {})
    normalized = {pv: _normalize(entry) for pv, entry in thresholds.items()}
    return {pv: entry for pv, entry in normalized.items() if entry}


class ThresholdUpdate(BaseModel):
    pv_name: str
    upper: Optional[float] = None
    lower: Optional[float] = None


@router.post("/thresholds")
async def set_threshold(update: ThresholdUpdate):
    """set/update a single PV's upper and/or lower threshold"""
    if update.upper is None and update.lower is None:
        raise HTTPException(
            status_code=422, detail="At least one of upper/lower is required"
        )
    for value in (update.upper, update.lower):
        if value is not None and not math.isfinite(value):
            raise HTTPException(
                status_code=422, detail="Threshold must be a finite number"
            )
    if (
        update.upper is not None
        and update.lower is not None
        and update.lower > update.upper
    ):
        raise HTTPException(
            status_code=422,
            detail="Lower threshold must not exceed upper threshold",
        )

    entry = {}
    if update.upper is not None:
        entry["upper"] = update.upper
    if update.lower is not None:
        entry["lower"] = update.lower

    config = load_config()
    config.setdefault("thresholds", {})
    config["thresholds"][update.pv_name] = entry
    save_config(config)
    return {"status": "ok", "thresholds": config["thresholds"]}


@router.delete("/thresholds/{pv_name:path}")
async def delete_threshold(pv_name: str):
    """remove a certain PV's threshold"""
    config = load_config()
    config.get("thresholds", {}).pop(pv_name, None)
    save_config(config)
    return {"status": "ok"}
