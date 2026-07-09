import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Use Helmet to secure HTTP headers (e.g. disabling X-Powered-By) and disable frameguard to allow PowerPoint embedding
app.use(helmet({ contentSecurityPolicy: false, frameguard: false }));

app.use(express.json());

const fileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again after 15 minutes."
});

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
      // Validate that the output strictly matches a secure TinyURL format and enforce plain text content type
      const match = text.match(/^https:\/\/tinyurl\.com\/[a-zA-Z0-9\-]+$/);
      if (match) {
        res.type('text/plain').send(match[0]);
      } else {
        res.status(400).send('Invalid response from URL shortener');
      }
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
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), 'dist');
  // Disable default serving of index.html from static middleware
  app.use(express.static(distPath, { index: false }));
  
  // Catch-all route to serve dynamically hydrated index.html
  app.get('/{*splat}', fileLimiter, async (req, res) => {
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

// Ensure that the server runs app.listen() everywhere EXCEPT inside Vercel's serverless environment
if (!process.env.VERCEL) {
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
