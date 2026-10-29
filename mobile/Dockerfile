# Estágio de build do bundle estático web do Expo
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx expo export --platform web --output-dir dist

# Estágio final servido por Nginx leve (com proxy /api -> api:3000 e fallback SPA)
FROM nginx:alpine
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n\n  location /api/ {\n    proxy_pass http://api:3000/;\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n  }\n\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

