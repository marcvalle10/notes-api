FROM node:20-slim

WORKDIR /app

# Instalar dependencias primero (mejor cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código
COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
