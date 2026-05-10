import HttpStatus from 'http-status-codes';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import methodOverride from 'method-override';
import morgan from 'morgan';
import { config } from './config';
import { ErrorModel } from './models/Error';
import { statusRouter } from './routes/status';
import { walletsRouter } from './routes/wallets';
import { ratesRouter } from './routes/rates';
import packageJson from '../package.json';
import { log } from './lib/log';

export const app = express();

// Trust the configured number of proxy hops so req.ip reflects the
// real client when grcpay is deployed behind nginx / a load balancer,
// which the per-IP rate limiters rely on. Default 1 (single upstream,
// matching the usual nginx-in-front deployment). Set TRUST_PROXY_HOPS=0
// when running grcpay on a directly-exposed port to prevent forged
// X-Forwarded-For from bypassing rate limits.
app.set('trust proxy', config.TRUST_PROXY_HOPS);

// Set up port
app.set('port', config.PORT);

// Set up middleware

// Standard hardening headers. grcpay is JSON-only, so the HTML-side
// CSP/frameguard defaults are mostly inert; narrow them if an endpoint
// ever starts serving HTML.
app.use(helmet());

// Set up body parser in order to get post values
app.use(express.json({ type: 'application/vnd.api+json' }));
app.use(express.json());

// Disable x-powered by
app.disable('x-powered-by');

// Allow to override PUT and DELETE methods using custom header
app.use(methodOverride('X-HTTP-Method-Override'));

// Access logs
if (!config.isTesting) {
  app.use(morgan('combined'));
}

// Set up default content type
app.use((req, res, next) => {
  res.header('Content-Type', 'application/vnd.api+json; charset=utf-8');
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH');
  res.header(
    'Access-Control-Allow-Headers',
    'x-forwarded-proto,Accept,DNT,X-CustomHeader,Keep-Alive,User-Agent,'
    + 'X-Requested-With,If-Modified-Since,Cache-Control,Content-Type',
  );
  next();
});

// Routers

/**
 * URL path: /status
 *
 * just the usual status call for this service
 */
// Rate limits are now applied per-route inside each router (see
// routes/wallets.ts and routes/rates.ts) so write and read endpoints
// can have independent budgets — previously a single blanket limit
// on /wallets meant normal plugin polling shared a bucket with
// wallet creation and started 429-ing under legitimate traffic.
app.use('/status', statusRouter);
app.use('/wallets', walletsRouter);
app.use('/rates', ratesRouter);

// Not found error handling
app.use((req, res) => {
  log.warn(`Not found URL: ${req.url}`);
  res
    .status(HttpStatus.NOT_FOUND)
    .send({
      errors: [
        new ErrorModel(HttpStatus.NOT_FOUND, HttpStatus.getStatusText(HttpStatus.NOT_FOUND)),
      ],
    });
});

// 500 error handling
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  log.error(`Internal server error: ${err}`);
  res
    .status(HttpStatus.INTERNAL_SERVER_ERROR)
    .send({
      errors: [
        new ErrorModel(
          HttpStatus.INTERNAL_SERVER_ERROR,
          HttpStatus.getStatusText(HttpStatus.INTERNAL_SERVER_ERROR),
        ),
      ],
    });
});

// Start the listener. Called from index.ts AFTER migrations have run
// so the first inbound request can never hit a table that doesn't
// exist yet. Tests don't call this — supertest binds to `app`
// directly without opening a port.
export function startServer(): void {
  app.listen(app.get('port'), () => {
    log.info(`${packageJson.name} is running on port ${app.get('port')}`);
  });
}
