FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG PUBLIC_ORS_KEY
RUN PUBLIC_ORS_KEY=$PUBLIC_ORS_KEY npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 8080;\n  port_in_redirect off;\n  root /usr/share/nginx/html;\n  index index.html;\n\n  gzip on;\n  gzip_vary on;\n  gzip_min_length 256;\n  gzip_types text/plain text/css application/javascript application/json image/svg+xml font/woff2;\n\n  location ~* \\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|ico)$ {\n    expires 1y;\n    add_header Cache-Control "public, immutable";\n  }\n\n  location = /index.html {\n    add_header Cache-Control "no-cache";\n  }\n\n  location / { try_files $uri $uri/ /index.html; }\n}\n' \
    > /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
