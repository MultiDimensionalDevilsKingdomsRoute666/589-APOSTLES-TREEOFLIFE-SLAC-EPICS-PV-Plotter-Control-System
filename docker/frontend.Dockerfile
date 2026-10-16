# EPICS PV Plotter - frontend (Vite build served by nginx)
#
# Built from the repo root:
#   docker build -f docker/frontend.Dockerfile -t epics-pv-frontend .

FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
