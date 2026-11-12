# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_APP_NAME="Speakora"
ENV VITE_APP_NAME=$VITE_APP_NAME
# Public address of the signed release APK (see docs/DEPLOYMENT.md, Android app download). Empty hides the download button.
ARG VITE_ANDROID_DOWNLOAD_URL=""
ENV VITE_ANDROID_DOWNLOAD_URL=$VITE_ANDROID_DOWNLOAD_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q --spider http://localhost/ || exit 1
