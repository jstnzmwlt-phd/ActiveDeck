# Use the official lightweight Node.js 20 image
FROM node:20-alpine

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

# Expose port 3000 (standard port for the Express server)
EXPOSE 3000

# Set environment variables for production
ENV NODE_ENV=production
ENV PORT=3000

# Start the Express server using tsx
CMD ["npx", "tsx", "server.ts"]
