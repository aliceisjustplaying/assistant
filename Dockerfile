# Build stage - install dependencies
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy package files first for better caching
COPY package.json bun.lockb* ./

# Install all dependencies (including dev for build)
RUN bun install --frozen-lockfile

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Production stage - smaller image
FROM oven/bun:1-slim AS production
WORKDIR /app

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json bun.lockb* ./

# Install production dependencies only
RUN bun install --frozen-lockfile --production

# Copy source from builder
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./

# Create data directory for SQLite
RUN mkdir -p /app/data

# Run as non-root user for security
USER bun

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the app
CMD ["bun", "run", "src/index.ts"]
