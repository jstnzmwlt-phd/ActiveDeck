# Use the official lightweight Node.js 20 image
FROM node:26.4.0-alpine

# Update packages to resolve security vulnerabilities (like CVE-2026-34180 in openssl/libcrypto3)
RUN apk update && apk upgrade --no-cache

# Set working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker cache layers
COPY package*.json ./

# Install all dependencies (including devDependencies like typescript, vite, tsx)
RUN npm ci

# Copy the rest of the application files
COPY . .

# Compile the frontend React/Vite assets and run lint/type check
RUN npm run build

# Expose port 8080 (standard port for Google Cloud Run)
EXPOSE 8080

# Set environment variables for production
ENV NODE_ENV=production
ENV PORT=8080

# Start the Express server using tsx
CMD ["npx", "tsx", "api/server.ts"]
