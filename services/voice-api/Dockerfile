# ---- Build (Alpine) ----
FROM golang:1.25.3-alpine AS build
WORKDIR /src

# minimal tools & certs
RUN apk add --no-cache git ca-certificates

# better layer caching
COPY go.mod go.sum* ./
RUN go mod download

# copy app
COPY . .

# reproducible, static binary (no libc needed)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /out/app .

# ---- Runtime (distroless, non-root, includes CA certs) ----
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app"]
