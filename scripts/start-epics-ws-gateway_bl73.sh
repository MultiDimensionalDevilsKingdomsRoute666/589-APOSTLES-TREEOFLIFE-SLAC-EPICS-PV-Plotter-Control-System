#!/bin/bash
# Startup script for EPICS WebSocket Gateway

# Set EPICS environment variables
export EPICS_CA_ADDR_LIST='192.168.73.49:5064 192.168.73.50:5064 192.168.73.48:5064 192.168.73.51:5064 192.168.73.35:5084 192.168.73.35:5086 192.168.73.35:5088 192.168.73.35:5090 134.79.46.44:5100'

export EPICS_CA_AUTO_ADDR_LIST=NO
export EPICS_CA_MAX_ARRAY_BYTES=8000000

# PVA settings (can keep these simpler)
export EPICS_PVA_ADDR_LIST="192.168.22.255"
export EPICS_PVA_AUTO_ADDR_LIST=YES



# Use the virtual environment's Python directly
exec /home/b_bluesky/Documents/epics-pv-plotter/venv_prodlx1_py311/bin/python /home/b_bluesky/Documents/epics-pv-plotter/epics_fastapi_gateway.py

