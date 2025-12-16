.PHONY: up down logs rebuild

up:
\tdocker compose up --build -d

down:
\tdocker compose down -v

logs:
\tdocker compose logs -f --tail=200

rebuild:
\tdocker compose build --no-cache
