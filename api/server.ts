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

app.get('/api/proxy-image', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).send('URL is required');
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch image: ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error) {
    console.error('Proxy image error:', error);
    res.status(500).send('Internal server error');
  }
});

const DEFAULT_TEAMS_WEBHOOK_URL = "https://default2a69c91de8494e34a230cdf8b27e19.64.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/15/workflows/087e3ca325e946a4806f36640e37cdc0/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=INA78p9TCrEZZWREcjKrNxoZ2F_ml9bQXIU50uLPW-Q";

app.post('/api/notify-login', async (req, res) => {
  try {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL || req.body?.webhookUrl || DEFAULT_TEAMS_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn('TEAMS_WEBHOOK_URL is not set; skipping Teams notification.');
      return res.status(200).json({ skipped: true, message: 'No webhook URL configured' });
    }

    const { email, institution, institutionDomain, sessionPin } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const now = new Date();
    const formattedTime = now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      dateStyle: 'full',
      timeStyle: 'medium',
    });

    const facts: Array<{ title: string; value: string }> = [
      { title: 'Faculty Email:', value: String(email) },
      { title: 'Timestamp:', value: `${formattedTime} (CT)` },
    ];

    if (institution) {
      facts.push({ title: 'Institution:', value: String(institution) });
    }
    if (institutionDomain) {
      facts.push({ title: 'Domain:', value: `@${String(institutionDomain)}` });
    }
    if (sessionPin) {
      facts.push({ title: 'Session PIN:', value: String(sessionPin) });
    }

    const cardPayload = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              {
                type: 'TextBlock',
                text: '🎓 ActiveDeck — Faculty Login',
                weight: 'Bolder',
                size: 'Large',
                color: 'Accent'
              },
              {
                type: 'TextBlock',
                text: 'A verified faculty presenter has logged into the ActiveDeck presentation portal.',
                isSubtle: true,
                wrap: true
              },
              {
                type: 'FactSet',
                facts: facts
              }
            ]
          }
        }
      ]
    };

    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cardPayload)
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error(`Teams webhook responded with status ${webhookResponse.status}:`, errorText);
      return res.status(502).json({ error: 'Failed to notify Teams channel', details: errorText });
    }

    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('Error in /api/notify-login:', err);
    return res.status(500).json({ error: 'Internal server error', message: err?.message });
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
