# routers/config.py
"""
Configuration API router - handles shared aliases and layouts.
Stored in config.json so all browsers share the same settings.
"""

import json
import logging
from pathlib import Path
from typing import Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

log = logging.getLogger(__name__)

# create router, setup prefix and tags
router = APIRouter(prefix="/api", tags=["config"])

# set up the files's path and file name
CONFIG_FILE = Path(__file__).parent.parent / "config.json"

DEFAULT_CONFIG = {
    "aliases": {},
    "layouts": {
        "default": {
            "plots": [],
            "livePVNames": [],
            "globalTimeWindow": 60,
        }
    },
}


def load_config() -> dict:
    if not CONFIG_FILE.exists():
        return DEFAULT_CONFIG.copy()
    try:
        # open config file and load the json data
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        log.warning(f"Failed to read config, using default: {e}")
        return DEFAULT_CONFIG.copy()


def save_config(config: dict) -> None:
    tmp = CONFIG_FILE.with_suffix(".json.tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        tmp.replace(CONFIG_FILE)   # replace the old configuration file
    except IOError as e:
        log.error(f"Failed to save config: {e}")
        raise HTTPException(status_code=500, detail="Failed to save config")


# ---------- complete setup of the router ----------

@router.get("/config")
async def get_config():
    """get the complete configuration"""
    return load_config()


@router.post("/config")
async def update_config(config: Dict[str, Any]):
    """save the configuration"""
    save_config(config)
    return {"status": "ok"}


# ----------alias ----------

@router.get("/aliases")
async def get_aliases():
    """get all the alias projections"""
    return load_config().get("aliases", {})


class AliasUpdate(BaseModel):
    pv_name: str
    alias: str


@router.post("/aliases")
async def set_alias(update: AliasUpdate):
    """set/update single  PV alias"""
    config = load_config()
    config.setdefault("aliases", {})
    config["aliases"][update.pv_name] = update.alias
    save_config(config)
    return {"status": "ok", "aliases": config["aliases"]}


@router.delete("/aliases/{pv_name}")
async def delete_alias(pv_name: str):
    """ remove a certain PV's alias """
    config = load_config()
    config.get("aliases", {}).pop(pv_name, None)
    save_config(config)
    return {"status": "ok"}

@router.get("/egus")
async def get_egus():
    """get all EGU settings"""
    return load_config().get("egus", {})


class EguUpdate(BaseModel):
    pv_name: str
    egu: str


@router.post("/egus")
async def set_egu(update: EguUpdate):
    """set/update a single PV's EGU"""
    config = load_config()
    config.setdefault("egus", {})
    config["egus"][update.pv_name] = update.egu
    save_config(config)
    return {"status": "ok", "egus": config["egus"]}


