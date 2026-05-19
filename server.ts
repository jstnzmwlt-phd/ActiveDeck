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

  app.get('/env.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
      window.VITE_FIREBASE_PROJECT_ID = ${JSON.stringify(process.env.VITE_FIREBASE_PROJECT_ID)};
      window.VITE_FIREBASE_APP_ID = ${JSON.stringify(process.env.VITE_FIREBASE_APP_ID)};
      window.VITE_FIREBASE_API_KEY = ${JSON.stringify(process.env.VITE_FIREBASE_API_KEY)};
      window.VITE_FIREBASE_AUTH_DOMAIN = ${JSON.stringify(process.env.VITE_FIREBASE_AUTH_DOMAIN)};
      window.VITE_FIREBASE_STORAGE_BUCKET = ${JSON.stringify(process.env.VITE_FIREBASE_STORAGE_BUCKET)};
      window.VITE_FIREBASE_MESSAGING_SENDER_ID = ${JSON.stringify(process.env.VITE_FIREBASE_MESSAGING_SENDER_ID)};
    `);
  });
  
  app.get('/api/shorten', async (req, res) => {
    const { url } = req.query;
    if (!url) {
      return res.status(400).send('URL is required');
    }
    try {
      const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url as string)}`);
      if (response.ok) {
        const text = await response.text();
        res.send(text);
      } else {
        res.status(response.status).send('Failed to shorten URL');
      }
    } catch (error) {
      console.error('Shorten error:', error);
      res.status(500).send('Internal server error');
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
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
