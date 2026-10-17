FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && find dist -name "*.map" -delete

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# A template: the image's entrypoint renders it into conf.d at start. The
# filter keeps envsubst off nginx's own $variables, and the empty default
# keeps nginx starting when the Fly secret isn't set (the Worker then sees
# every visitor as one IP).
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=EDGE_SECRET EDGE_SECRET=""
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
