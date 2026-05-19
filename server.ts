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
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

  // Serve a self-unregistering service worker to force client browser updates
  app.get(['/service-worker.js', '/service_worker.js'], (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
      self.addEventListener('install', function(e) {
        self.skipWaiting();
      });
      self.addEventListener('activate', function(e) {
        self.registration.unregister()
          .then(function() {
            return self.clients.matchAll();
          })
          .then(function(clients) {
            clients.forEach(client => client.navigate(client.url));
          });
      });
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
    // Disable default serving of index.html from static middleware
    app.use(express.static(distPath, { index: false }));
    
    // Catch-all route to serve dynamically hydrated index.html
    app.get('/{*splat}', async (req, res) => {
      try {
        const fs = await import('fs/promises');
        let html = await fs.readFile(path.join(distPath, 'index.html'), 'utf-8');
        
        // Dynamically inject active environment variables directly into index.html
        const configScript = `
    <script id="firebase-env-config">
      window.VITE_FIREBASE_PROJECT_ID = ${JSON.stringify(process.env.VITE_FIREBASE_PROJECT_ID)};
      window.VITE_FIREBASE_APP_ID = ${JSON.stringify(process.env.VITE_FIREBASE_APP_ID)};
      window.VITE_FIREBASE_API_KEY = ${JSON.stringify(process.env.VITE_FIREBASE_API_KEY)};
      window.VITE_FIREBASE_AUTH_DOMAIN = ${JSON.stringify(process.env.VITE_FIREBASE_AUTH_DOMAIN)};
      window.VITE_FIREBASE_STORAGE_BUCKET = ${JSON.stringify(process.env.VITE_FIREBASE_STORAGE_BUCKET)};
      window.VITE_FIREBASE_MESSAGING_SENDER_ID = ${JSON.stringify(process.env.VITE_FIREBASE_MESSAGING_SENDER_ID)};
    </script>
        `;
        
        html = html.replace('</head>', `${configScript}\n</head>`);
        res.send(html);
      } catch (err) {
        console.error('Error serving index.html:', err);
        res.status(500).send('Internal Server Error');
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
