# Quick Start Guide - EPICS PV Live Plotter

## Table of Contents
- [Docker Deployment](#docker-deployment)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running the Application](#running-the-application)
- [Configuration](#configuration)
- [Usage](#usage)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

## Docker Deployment

The easiest way to run this on a new machine (including a Raspberry Pi) is
with Docker Compose - it builds the frontend and backend and runs both,
with no manual Node/Python setup required.

### Prerequisites
- Docker Engine + the Compose plugin (`docker compose version`)

### Run it
```bash
git clone <this-repo> && cd epics-pv-plotter
docker compose up --build -d
```

The app is served on port 80, and the backend on port 8000.

### Why host networking
`docker-compose.yml` runs both containers with `network_mode: host`. This
is required because EPICS Channel Access discovers PVs via UDP broadcast,
which doesn't reach containers on Docker's default bridge network - host
networking makes the containers see the network exactly like a native
process would. This works on Linux hosts (including Raspberry Pi OS); it
does not work the same way on Docker Desktop for Mac/Windows.

If your IOCs are on a different subnet and broadcast discovery doesn't
reach them, copy `.env.example` to `.env` and set `EPICS_CA_ADDR_LIST`
(and `EPICS_CA_AUTO_ADDR_LIST=NO`) to the IOC addresses directly.

### Persisting configuration
`config.json` (PV aliases, EGUs, thresholds, saved layouts) is bind-mounted
into the backend container, so it persists across rebuilds/restarts and can be
edited directly on the host. It holds user-saved settings, so it is not tracked
by git - create it from the template before the first `docker compose up`
(otherwise Docker creates a directory named `config.json` in its place):
```bash
cp config.example.json config.json
```

### Updating after a code change
```bash
docker compose up --build -d
```

## Prerequisites

### Required Software
- **Node.js** >= 20.11 ([Download](https://nodejs.org/))
- **Python** >= 3.11 ([Download](https://www.python.org/))
- **Git** ([Download](https://git-scm.com/))

### Optional
- **EPICS Base** (for testing with caget/caput)
- **GitHub CLI** (`gh`) for easier workflow

### Verify Installation
```bash
node --version    # Should be >= 20.11
npm --version     # Should be >= 10.0
python3 --version # Should be >= 3.11
git --version
