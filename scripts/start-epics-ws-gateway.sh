#!/bin/bash
# Startup script for EPICS WebSocket Gateway

# Set EPICS environment variables
export EPICS_CA_ADDR_LIST='192.168.22.26:5064 192.168.22.49:5064 192.168.22.4 192.168.22.5:5074 192.168.22.5:5076 192.168.22.5:5078 192.168.22.5:5080 spearca1:5100 192.168.22.5:5174'
export EPICS_CA_AUTO_ADDR_LIST=NO
export EPICS_CA_MAX_ARRAY_BYTES=8000000

# PVA settings (can keep these simpler)
export EPICS_PVA_ADDR_LIST="192.168.22.255"
export EPICS_PVA_AUTO_ADDR_LIST=YES



# Use the virtual environment's Python directly
exec /home/b_bluesky/Documents/epics-pv-plotter/venv_prodlx1_py311/bin/python /home/b_bluesky/Documents/epics-pv-plotter/epics_fastapi_gateway.py

#exec /home/b_bluesky/Documents/epics-pv-plotter/venv_prodlx1_py311/bin/python /home/b_bluesky/Documents/epics-pv-plotter/epics-ws-gateway-caproto-sec.py
#exec /home/b_bluesky/Documents/epics-pv-plotter/venv/bin/python /home/b_bluesky/Documents/epics-pv-plotter/epics-ws-gateway.py
