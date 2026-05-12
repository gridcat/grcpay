import { Typography, Box, Alert } from '@mui/material';
import React from 'react';
import { CodeBlock } from '@/components/CodeBlock/CodeBlock';

export function ReverseProxy() {
  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h4" component="h2" id="reverse-proxy" sx={{ pb: 2 }}>
        Reverse proxy
      </Typography>
      <Box component="article">
        <Typography gutterBottom variant="body1" component="p">
          GRCpay listens on plain HTTP. Don&apos;t expose port 7001
          directly. Terminate TLS at a reverse proxy on the host and
          forward requests inward. Two common options:
        </Typography>

        <Typography variant="h6" component="h3" sx={{ pt: 2, pb: 1 }}>
          nginx
        </Typography>
        <CodeBlock
          caption="/etc/nginx/sites-available/grcpay.conf"
          language="nginx"
          code={`server {
    listen 443 ssl http2;
    server_name grcpay.example.com;

    ssl_certificate     /etc/letsencrypt/live/grcpay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/grcpay.example.com/privkey.pem;

    # GRCpay's REST surface lives under /api so it can share the
    # hostname with the (optional) docs frontend on /.
    location /api/ {
        # Strip the /api prefix before forwarding — GRCpay routes
        # are mounted at the root (/wallets, /status, /rates, ...).
        rewrite ^/api/(.*)$ /$1 break;

        proxy_pass         http://127.0.0.1:7001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name grcpay.example.com;
    return 301 https://$host$request_uri;
}`}
        />

        <Typography variant="h6" component="h3" sx={{ pt: 3, pb: 1 }}>
          Caddy
        </Typography>
        <Typography gutterBottom variant="body1" component="p">
          If you&apos;d rather not deal with certbot, Caddy provisions
          and renews TLS automatically:
        </Typography>
        <CodeBlock
          caption="Caddyfile"
          language="caddyfile"
          code={`grcpay.example.com {
    handle /api/* {
        uri strip_prefix /api
        reverse_proxy 127.0.0.1:7001
    }
}`}
        />

        <Alert severity="info" variant="outlined" sx={{ my: 2 }}>
          The
          {' '}
          <code>/api</code>
          {' '}
          prefix is a convention, not a requirement. GRCpay&apos;s
          routes are mounted at the root (
          <code>/wallets</code>
          ,
          {' '}
          <code>/status</code>
          ,
          {' '}
          <code>/rates</code>
          ). If you don&apos;t plan to host the docs frontend on the
          same hostname, you can drop the prefix entirely and proxy
          {' '}
          <code>/</code>
          {' '}
          straight to
          {' '}
          <code>127.0.0.1:7001</code>
          .
        </Alert>
      </Box>
    </Box>
  );
}
