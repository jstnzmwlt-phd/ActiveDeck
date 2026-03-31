import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  app.post("/api/shorten", async (req, res) => {
    const { long_url } = req.body;
    const bitlyToken = process.env.BITLY_ACCESS_TOKEN;

    // Try Bitly first if token is available
    if (bitlyToken) {
      try {
        const response = await fetch('https://api-ssl.bitly.com/v4/shorten', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${bitlyToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ long_url })
        });

        if (response.ok) {
          const data = await response.json();
          return res.json({ link: data.link });
        }
      } catch (error) {
        console.error('Bitly error, falling back:', error);
      }
    }

    // Fallback to CleanURI (No key required)
    try {
      const response = await fetch('https://cleanuri.com/api/v1/shorten', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `url=${encodeURIComponent(long_url)}`
      });

      if (response.ok) {
        const data = await response.json();
        res.json({ link: data.result_url });
      } else {
        res.json({ link: long_url });
      }
    } catch (error) {
      console.error('Shortening error:', error);
      res.json({ link: long_url });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
