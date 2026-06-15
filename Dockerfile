FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG PUBLIC_ORS_KEY
RUN PUBLIC_ORS_KEY=$PUBLIC_ORS_KEY npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 8080;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' \
    > /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
