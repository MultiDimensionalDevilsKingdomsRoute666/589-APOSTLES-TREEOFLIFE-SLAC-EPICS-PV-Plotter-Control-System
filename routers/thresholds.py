# routers/thresholds.py
"""
Threshold API router - handles per-PV alarm thresholds.
Stored in config.json (alongside aliases/egus) so all browsers share them.
"""

import math

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from routers.config import load_config, save_config

router = APIRouter(prefix="/api", tags=["thresholds"])


@router.get("/thresholds")
async def get_thresholds():
    """get all PV thresholds"""
    return load_config().get("thresholds", {})


class ThresholdUpdate(BaseModel):
    pv_name: str
    threshold: float


@router.post("/thresholds")
async def set_threshold(update: ThresholdUpdate):
    """set/update a single PV's threshold"""
    if not math.isfinite(update.threshold):
        raise HTTPException(status_code=422, detail="Threshold must be a finite number")
    config = load_config()
    config.setdefault("thresholds", {})
    config["thresholds"][update.pv_name] = update.threshold
    save_config(config)
    return {"status": "ok", "thresholds": config["thresholds"]}


@router.delete("/thresholds/{pv_name:path}")
async def delete_threshold(pv_name: str):
    """remove a certain PV's threshold"""
    config = load_config()
    config.get("thresholds", {}).pop(pv_name, None)
    save_config(config)
    return {"status": "ok"}
