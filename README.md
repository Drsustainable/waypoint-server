# Waypoint Server

Simple REST API for the Waypoint travel app. Stores trips as JSON, parses bookings with Claude AI.

## Deploy to Railway

1. Push this repo to GitHub
2. Connect Railway to the GitHub repo
3. Add environment variable: `CLAUDE_API_KEY=sk-ant-...`
4. Railway auto-deploys on every push

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /trips | Get all trips |
| POST | /trips | Create trip |
| PUT | /trips/:id | Update trip |
| DELETE | /trips/:id | Delete trip |
| POST | /trips/:id/segments | Add segments to trip |
| DELETE | /trips/:id/segments/:segId | Remove segment |
| POST | /parse | Parse booking text with Claude |
| POST | /parse-pdf | Parse PDF (base64) with Claude |

## Local development

```
npm install
CLAUDE_API_KEY=your-key node index.js
```
